package app.cetele.server.admin.console

import app.cetele.server.admin.AdminNotFoundException
import app.cetele.server.admin.AdminPrincipal
import app.cetele.server.admin.audit.AuditAction
import app.cetele.server.admin.audit.AuditActorType
import app.cetele.server.admin.audit.AuditLogService
import app.cetele.server.admin.audit.AuditTargetType
import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.config.CeteleTime
import app.cetele.server.config.logging.Masking
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import jakarta.persistence.Tuple
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Reads and user actions of the console (ADR-0033). Every read goes through the JPQL count and
 * projection queries below, which select only the columns a page may show: no ledger note, amount
 * or photo key, no customer name, phone, note or tag, no token of any kind. Each audited call writes
 * its `audit_logs` row in the same transaction.
 */
@Service
class AdminConsoleService(
    private val audit: AuditLogService,
    private val refreshTokens: RefreshTokenService,
    private val clock: Clock,
) {
    @PersistenceContext
    private lateinit var em: EntityManager

    @Transactional(readOnly = true)
    fun dashboard(): DashboardView =
        DashboardView(
            shops = count("SELECT count(s) FROM Shop s WHERE s.deletedAt IS NULL"),
            users = count("SELECT count(u) FROM ConsoleUser u WHERE u.deactivatedAt IS NULL"),
            proShops =
                count(
                    "SELECT count(s) FROM Shop s WHERE s.deletedAt IS NULL AND s.plan = app.cetele.server.tenancy.shop.ShopPlan.PRO",
                ),
        )

    /** Shops whose name contains [query] (case-insensitive), newest first, at most 50. */
    @Transactional
    fun searchShops(
        admin: AdminPrincipal,
        query: String,
    ): List<ShopRowView> {
        val pattern = "%" + escapeLike(query.trim().take(MAX_QUERY_LENGTH)) + "%"
        val rows =
            em
                .createQuery(
                    "SELECT s.id AS id, s.name AS name, s.type AS type, s.il AS il, s.ilce AS ilce, s.plan AS plan, " +
                        "s.createdAt AS createdAt, s.deletedAt AS deletedAt FROM Shop s " +
                        "WHERE lower(s.name) LIKE lower(:pattern) ESCAPE '!' ORDER BY s.createdAt DESC, s.id",
                    Tuple::class.java,
                ).setParameter("pattern", pattern)
                .setMaxResults(MAX_RESULTS)
                .resultList
                .map(::shopRow)
        audit.record(AuditActorType.ADMIN, admin.id, AuditAction.SHOP_SEARCHED, metadata = mapOf("results" to rows.size))
        return rows
    }

    @Transactional
    fun shop(
        admin: AdminPrincipal,
        shopId: UUID,
    ): ShopDetailView {
        val shop =
            em
                .createQuery(
                    "SELECT s.id AS id, s.name AS name, s.type AS type, s.il AS il, s.ilce AS ilce, s.plan AS plan, " +
                        "s.createdAt AS createdAt, s.deletedAt AS deletedAt FROM Shop s WHERE s.id = :shopId",
                    Tuple::class.java,
                ).setParameter("shopId", shopId)
                .resultList
                .firstOrNull()
                ?.let(::shopRow) ?: throw AdminNotFoundException()
        val deletion =
            em
                .createQuery(
                    "SELECT d.requestedAt AS requestedAt, d.graceUntil AS graceUntil FROM DeletionRequest d " +
                        "WHERE d.shopId = :shopId AND d.kind = app.cetele.server.account.deletion.DeletionKind.SHOP " +
                        "AND d.completedAt IS NULL AND d.cancelledAt IS NULL",
                    Tuple::class.java,
                ).setParameter("shopId", shopId)
                .resultList
                .firstOrNull()
        val members =
            em
                .createQuery(
                    "SELECT m.userId AS userId, m.role AS role, u.phoneE164 AS phone, u.deactivatedAt AS deactivatedAt " +
                        "FROM Membership m, ConsoleUser u WHERE u.id = m.userId AND m.shopId = :shopId ORDER BY m.role, m.createdAt",
                    Tuple::class.java,
                ).setParameter("shopId", shopId)
                .resultList
                .map {
                    MemberView(
                        userId = it.get("userId", UUID::class.java),
                        role = it.get("role").toString(),
                        maskedPhone = Masking.phone(it.get("phone", String::class.java)),
                        deactivated = it.get("deactivatedAt") != null,
                    )
                }
        val month = CeteleTime.monthStart(clock)
        val view =
            ShopDetailView(
                shop = shop,
                deletionRequestedAt = deletion?.let { ConsoleFormat.time(it.get("requestedAt", Instant::class.java)) },
                deletionGraceUntil = deletion?.let { ConsoleFormat.time(it.get("graceUntil", Instant::class.java)) },
                members = members,
                liveCustomers = count("SELECT count(c) FROM Customer c WHERE c.shopId = :shopId AND c.deletedAt IS NULL", shopId),
                entries = count("SELECT count(e) FROM LedgerEntry e WHERE e.shopId = :shopId", shopId),
                readyPhotos =
                    count(
                        "SELECT count(m) FROM MediaObject m WHERE m.shopId = :shopId AND m.status = app.cetele.server.media.MediaStatus.READY",
                        shopId,
                    ),
                smsMonth = month.format(MONTH),
                smsUsed = smsUsed(shopId, month),
                ownerDeactivated = members.any { it.role == "OWNER" && it.deactivated },
                subscription = currentSubscription(shopId),
            )
        audit.record(AuditActorType.ADMIN, admin.id, AuditAction.SHOP_VIEWED, AuditTargetType.SHOP, shopId)
        return view
    }

    /** Users with exactly this E.164 number (zero or one). The number is never audited. */
    @Transactional
    fun searchUsers(
        admin: AdminPrincipal,
        phoneE164: String,
    ): List<UserRowView> {
        val rows =
            em
                .createQuery(USER_SELECT + " WHERE u.phoneE164 = :phone", Tuple::class.java)
                .setParameter("phone", phoneE164)
                .setMaxResults(MAX_RESULTS)
                .resultList
                .map(::userRow)
        audit.record(AuditActorType.ADMIN, admin.id, AuditAction.USER_SEARCHED, metadata = mapOf("results" to rows.size))
        return rows
    }

    @Transactional
    fun user(
        admin: AdminPrincipal,
        userId: UUID,
    ): UserDetailView {
        val user = findUser(userId) ?: throw AdminNotFoundException()
        val memberships =
            em
                .createQuery(
                    "SELECT s.id AS shopId, s.name AS shopName, m.role AS role, s.deletedAt AS deletedAt " +
                        "FROM Membership m, Shop s WHERE s.id = m.shopId AND m.userId = :userId ORDER BY m.createdAt",
                    Tuple::class.java,
                ).setParameter("userId", userId)
                .resultList
                .map {
                    UserMembershipView(
                        shopId = it.get("shopId", UUID::class.java),
                        shopName = it.get("shopName", String::class.java),
                        role = it.get("role").toString(),
                        shopDeleted = it.get("deletedAt") != null,
                    )
                }
        val now = clock.instant()
        val liveByDevice =
            em
                .createQuery(
                    "SELECT t.deviceId AS deviceId, count(t) AS live FROM RefreshToken t " +
                        "WHERE t.userId = :userId AND t.revokedAt IS NULL AND t.expiresAt > :now GROUP BY t.deviceId",
                    Tuple::class.java,
                ).setParameter("userId", userId)
                .setParameter("now", now)
                .resultList
                .associate { it.get("deviceId", UUID::class.java) to (it.get("live") as Number).toLong() }
        val devices =
            em
                .createQuery(
                    "SELECT d.id AS id, d.deviceId AS deviceId, d.model AS model, d.appVersion AS appVersion, " +
                        "d.lastSeenAt AS lastSeenAt, d.integrityVerifiedAt AS integrityVerifiedAt FROM Device d " +
                        "WHERE d.userId = :userId ORDER BY d.lastSeenAt DESC",
                    Tuple::class.java,
                ).setParameter("userId", userId)
                .resultList
                .map {
                    DeviceView(
                        id = it.get("id", UUID::class.java),
                        model = it.get("model", String::class.java),
                        appVersion = it.get("appVersion", String::class.java),
                        lastSeenAt = ConsoleFormat.time(it.get("lastSeenAt", Instant::class.java)),
                        integrityVerifiedAt = ConsoleFormat.time(it.get("integrityVerifiedAt", Instant::class.java)),
                        liveSessions = liveByDevice[it.get("deviceId", UUID::class.java)] ?: 0L,
                    )
                }
        audit.record(AuditActorType.ADMIN, admin.id, AuditAction.USER_VIEWED, AuditTargetType.USER, userId)
        return UserDetailView(user, memberships, devices)
    }

    /**
     * Sets `users.deactivated_at` and revokes every refresh token of the user through the auth
     * module's service; the access token stops at the next API request.
     */
    @Transactional
    fun deactivateUser(
        admin: AdminPrincipal,
        userId: UUID,
    ): Int {
        findUser(userId) ?: throw AdminNotFoundException()
        val now = clock.instant()
        em
            .createQuery("UPDATE ConsoleUser u SET u.deactivatedAt = :now WHERE u.id = :id AND u.deactivatedAt IS NULL")
            .setParameter("now", now)
            .setParameter("id", userId)
            .executeUpdate()
        val devices =
            em
                .createQuery(
                    "SELECT DISTINCT t.deviceId FROM RefreshToken t WHERE t.userId = :userId AND t.revokedAt IS NULL",
                    UUID::class.java,
                ).setParameter("userId", userId)
                .resultList
        val revoked = devices.sumOf { refreshTokens.revokeDevice(userId, it, now) }
        audit.record(
            AuditActorType.ADMIN,
            admin.id,
            AuditAction.USER_DEACTIVATED,
            AuditTargetType.USER,
            userId,
            mapOf("revokedSessions" to revoked),
        )
        return revoked
    }

    @Transactional
    fun reactivateUser(
        admin: AdminPrincipal,
        userId: UUID,
    ) {
        findUser(userId) ?: throw AdminNotFoundException()
        em
            .createQuery("UPDATE ConsoleUser u SET u.deactivatedAt = NULL WHERE u.id = :id")
            .setParameter("id", userId)
            .executeUpdate()
        audit.record(AuditActorType.ADMIN, admin.id, AuditAction.USER_REACTIVATED, AuditTargetType.USER, userId)
    }

    /** Revokes the refresh tokens of one `(user_id, device_id)`; [deviceRowId] is `devices.id`. */
    @Transactional
    fun revokeDevice(
        admin: AdminPrincipal,
        userId: UUID,
        deviceRowId: UUID,
    ): Int {
        val deviceId =
            em
                .createQuery("SELECT d.deviceId FROM Device d WHERE d.id = :id AND d.userId = :userId", UUID::class.java)
                .setParameter("id", deviceRowId)
                .setParameter("userId", userId)
                .resultList
                .firstOrNull() ?: throw AdminNotFoundException()
        val revoked = refreshTokens.revokeDevice(userId, deviceId, clock.instant())
        audit.record(
            AuditActorType.ADMIN,
            admin.id,
            AuditAction.DEVICE_REVOKED,
            AuditTargetType.DEVICE,
            deviceRowId,
            mapOf("revokedSessions" to revoked),
        )
        return revoked
    }

    private fun findUser(userId: UUID): UserRowView? =
        em
            .createQuery("$USER_SELECT WHERE u.id = :id", Tuple::class.java)
            .setParameter("id", userId)
            .resultList
            .firstOrNull()
            ?.let(::userRow)

    /** The shop's current subscription row; the projection never selects the token, its ciphertext or its hash. */
    private fun currentSubscription(shopId: UUID): ShopSubscriptionView? =
        em
            .createQuery(
                "SELECT s.productId AS productId, s.basePlanId AS basePlanId, s.state AS state, s.expiresAt AS expiresAt, " +
                    "s.testPurchase AS testPurchase FROM Subscription s WHERE s.boundShopId = :shopId AND s.supersededAt IS NULL",
                Tuple::class.java,
            ).setParameter("shopId", shopId)
            .resultList
            .firstOrNull()
            ?.let {
                ShopSubscriptionView(
                    productId = it.get("productId", String::class.java),
                    basePlanId = it.get("basePlanId", String::class.java),
                    state = it.get("state").toString(),
                    expiresAt = ConsoleFormat.time(it.get("expiresAt", Instant::class.java)),
                    testPurchase = it.get("testPurchase", Boolean::class.javaObjectType),
                )
            }

    private fun smsUsed(
        shopId: UUID,
        month: LocalDate,
    ): Int =
        em
            .createQuery("SELECT q.used FROM SmsQuota q WHERE q.shopId = :shopId AND q.month = :month", Int::class.javaObjectType)
            .setParameter("shopId", shopId)
            .setParameter("month", month)
            .resultList
            .firstOrNull()
            ?: 0

    private fun count(
        jpql: String,
        shopId: UUID? = null,
    ): Long {
        val query = em.createQuery(jpql, Long::class.javaObjectType)
        if (shopId != null) query.setParameter("shopId", shopId)
        return query.singleResult
    }

    private fun shopRow(tuple: Tuple): ShopRowView =
        ShopRowView(
            id = tuple.get("id", UUID::class.java),
            name = tuple.get("name", String::class.java),
            type = tuple.get("type").toString(),
            il = tuple.get("il", String::class.java),
            ilce = tuple.get("ilce", String::class.java),
            plan = tuple.get("plan").toString(),
            createdAt = ConsoleFormat.time(tuple.get("createdAt", Instant::class.java)),
            deletedAt = tuple.get("deletedAt", Instant::class.java)?.let { ConsoleFormat.time(it) },
        )

    private fun userRow(tuple: Tuple): UserRowView =
        UserRowView(
            id = tuple.get("id", UUID::class.java),
            maskedPhone = Masking.phone(tuple.get("phone", String::class.java)),
            displayName = tuple.get("displayName", String::class.java),
            createdAt = ConsoleFormat.time(tuple.get("createdAt", Instant::class.java)),
            deactivatedAt = tuple.get("deactivatedAt", Instant::class.java)?.let { ConsoleFormat.time(it) },
        )

    companion object {
        const val MAX_RESULTS = 50
        const val MAX_QUERY_LENGTH = 80
        private val MONTH: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM")
        private const val USER_SELECT =
            "SELECT u.id AS id, u.phoneE164 AS phone, u.displayName AS displayName, u.createdAt AS createdAt, " +
                "u.deactivatedAt AS deactivatedAt FROM ConsoleUser u"

        fun escapeLike(value: String): String = value.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    }
}
