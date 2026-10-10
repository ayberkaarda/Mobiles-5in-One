package app.cetele.server.billing

import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import org.hibernate.annotations.UuidGenerator
import java.time.Duration
import java.time.Instant
import java.util.UUID

/** `subscriptions.state`: the Play state plus three sticky states of our own (ADR-0031). */
enum class SubscriptionState {
    PENDING,
    ACTIVE,
    IN_GRACE_PERIOD,
    ON_HOLD,
    PAUSED,
    CANCELED,
    EXPIRED,
    REVOKED,
    REPLACED,
    ORPHANED,
    ;

    /** Refunded, replaced and orphaned rows never change state again, whatever Play says later. */
    val sticky: Boolean get() = this == REVOKED || this == REPLACED || this == ORPHANED

    companion object {
        /** Maps `subscriptionsv2.subscriptionState`; `UNSPECIFIED` and unknown values are `null` (not stored). */
        fun fromPlay(state: String): SubscriptionState? =
            when (state) {
                PlaySubscriptionPurchase.STATE_PENDING -> PENDING
                PlaySubscriptionPurchase.STATE_ACTIVE -> ACTIVE
                PlaySubscriptionPurchase.STATE_IN_GRACE_PERIOD -> IN_GRACE_PERIOD
                PlaySubscriptionPurchase.STATE_ON_HOLD -> ON_HOLD
                PlaySubscriptionPurchase.STATE_PAUSED -> PAUSED
                PlaySubscriptionPurchase.STATE_CANCELED -> CANCELED
                PlaySubscriptionPurchase.STATE_EXPIRED -> EXPIRED
                PlaySubscriptionPurchase.STATE_PENDING_PURCHASE_CANCELED -> EXPIRED
                else -> null
            }
    }
}

/** Whether a state and expiry grant `PRO` at an instant (the table of ADR-0031). */
object Entitlement {
    /** Covers a renewal whose notification is late; the server adds no grace of its own beyond this. */
    val RENEWAL_LEEWAY: Duration = Duration.ofHours(1)

    fun entitles(
        state: SubscriptionState,
        expiresAt: Instant?,
        now: Instant,
    ): Boolean =
        when (state) {
            SubscriptionState.ACTIVE, SubscriptionState.IN_GRACE_PERIOD -> expiresAt != null && now.isBefore(expiresAt.plus(RENEWAL_LEEWAY))
            SubscriptionState.CANCELED -> expiresAt != null && now.isBefore(expiresAt)
            else -> false
        }
}

/**
 * One purchase token bound to one shop for ever. [boundShopId] is `null` only after the shop was
 * deleted (`ON DELETE SET NULL`); such rows are reached through [SubscriptionIndex] only and
 * become `ORPHANED`. The raw token is kept encrypted for re-verification and acknowledgement.
 */
@Entity
@Table(name = "subscriptions")
class Subscription(
    @Column(name = "shop_id")
    var boundShopId: UUID?,
    @Column(name = "purchase_token_hash", nullable = false, updatable = false)
    val purchaseTokenHash: String,
    @Column(name = "purchase_token_enc")
    var purchaseTokenEnc: ByteArray?,
    @Column(name = "product_id", nullable = false, updatable = false)
    val productId: String,
    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    var state: SubscriptionState,
    @Column(name = "linked_by")
    var linkedBy: UUID?,
    @Column(name = "linked_at", nullable = false, updatable = false)
    val linkedAt: Instant,
    @Column(name = "last_verified_at", nullable = false)
    var lastVerifiedAt: Instant,
) : TenantScoped {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null
        protected set

    @Column(name = "base_plan_id")
    var basePlanId: String? = null

    @Column(name = "expires_at")
    var expiresAt: Instant? = null

    @Column(name = "auto_renewing", nullable = false)
    var autoRenewing: Boolean = false

    @Column(name = "test_purchase", nullable = false)
    var testPurchase: Boolean = false

    @Column(name = "acknowledged_at")
    var acknowledgedAt: Instant? = null

    @Column(name = "last_notification_type")
    var lastNotificationType: Int? = null

    @Column(name = "revoked_at")
    var revokedAt: Instant? = null

    @Column(name = "superseded_at")
    var supersededAt: Instant? = null

    @Column(name = "replaced_by")
    var replacedBy: UUID? = null

    @Column(name = "created_at", nullable = false, updatable = false)
    var createdAt: Instant = linkedAt
        protected set

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = linkedAt

    @get:Transient
    override val shopId: UUID
        get() = checkNotNull(boundShopId) { "subscription of a deleted shop" }

    @get:Transient
    val subscriptionId: UUID
        get() = checkNotNull(id) { "subscription is not saved yet" }

    fun entitles(now: Instant): Boolean = supersededAt == null && Entitlement.entitles(state, expiresAt, now)

    /**
     * Copies what Play says onto this row. A sticky state stays; `UNSPECIFIED` keeps the stored
     * state. Returns `true` when the state changed.
     */
    fun apply(
        purchase: PlaySubscriptionPurchase,
        now: Instant,
    ): Boolean {
        val before = state
        val item = purchase.lineItemFor(productId)
        if (!state.sticky) {
            SubscriptionState.fromPlay(purchase.subscriptionState)?.let { state = it }
            if (item != null) {
                expiresAt = item.expiryTime
                basePlanId = item.basePlanId?.take(MAX_ID)
                autoRenewing = item.autoRenewEnabled
            }
            testPurchase = purchase.testPurchase
        }
        if (acknowledgedAt == null && purchase.acknowledgementState == PlaySubscriptionPurchase.ACKNOWLEDGED) acknowledgedAt = now
        lastVerifiedAt = now
        updatedAt = now
        return before != state
    }

    fun revoke(now: Instant) {
        if (state == SubscriptionState.REVOKED) return
        state = SubscriptionState.REVOKED
        revokedAt = now
        updatedAt = now
    }

    /**
     * Leaves the current slot of the shop. A [replaced] row becomes `REPLACED`; its [replacedBy] is
     * set once the newer row exists (the partial unique index needs this row flushed first).
     */
    fun supersede(
        now: Instant,
        replaced: Boolean,
    ) {
        supersededAt = now
        if (replaced) state = SubscriptionState.REPLACED
        updatedAt = now
    }

    companion object {
        const val MAX_ID = 100
    }
}
