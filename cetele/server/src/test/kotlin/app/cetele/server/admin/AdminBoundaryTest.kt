package app.cetele.server.admin

import app.cetele.server.ledger.LedgerFixtures
import app.cetele.server.ledger.customer.CustomerRepository
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures
import com.tngtech.archunit.base.DescribedPredicate
import com.tngtech.archunit.core.domain.JavaClass
import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import com.tngtech.archunit.lang.ArchRule
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Deliberately violating class: proves that the boundary rule is not vacuous. */
class LeakyAdminFixture(
    val customers: CustomerRepository,
)

/**
 * The console never sees ledger content, photos, customers, statement links or reminder texts
 * (ADR-0033): an architecture rule on the admin package and a rendering test over every page.
 */
@IntegrationTest
class AdminBoundaryTest : AdminIntegrationTest() {
    @Test
    fun `the admin package does not depend on ledger, media, statement or reminder template classes`() {
        val production =
            ClassFileImporter()
                .withImportOption(
                    ImportOption.Predefined.DO_NOT_INCLUDE_TESTS,
                ).importPackages("app.cetele.server")
        assertTrue(production.any { it.packageName.startsWith("app.cetele.server.admin") })
        boundary.check(production)
        val violation = boundary.evaluate(ClassFileImporter().importClasses(LeakyAdminFixture::class.java))
        assertTrue(violation.hasViolation(), "the rule flags a console class that reads customers")
    }

    @Test
    fun `no console page shows customer names, notes, amounts or photos`() {
        val fixtures = TenancyFixtures(mvc, auth, jdbc)
        val owner = fixtures.actor()
        val shopName = "[ÖRNEK] Sınır Bakkalı " + UUID.randomUUID().toString().take(6)
        val shopId = fixtures.shop(owner, shopName)
        val staff = fixtures.addStaff(shopId)
        val ledger = LedgerFixtures(jdbc)
        val customerPhone = "+905" + (100_000_000 + (Math.random() * 800_000_000).toLong()).toString()
        val customerId = ledger.customer(shopId, name = CUSTOMER_NAME, phone = customerPhone)
        jdbc.update("UPDATE customers SET note = ?, tag = ? WHERE id = ?", SECRET_NOTE, "GIZLI-ETIKET", customerId)
        val photoKey = "media/$shopId/${UUID.randomUUID()}.jpg"
        jdbc.update(
            "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, photo_key, " +
                "ready_at, upload_expires_at) VALUES (?, ?, 'READY', 'image/jpeg', 1000, ?, ?, now(), now())",
            TraceIdFilter.uuidV7(),
            shopId,
            "uploads/$shopId/${UUID.randomUUID()}",
            photoKey,
        )
        ledger.entry(shopId, customerId, amountMinor = 98_765L, note = SECRET_NOTE, photoKey = photoKey)
        jdbc.update(
            "INSERT INTO devices (id, user_id, device_id, model, app_version, last_seen_at) VALUES (?, ?, ?, 'Pixel 8', '1.4.0', now())",
            TraceIdFilter.uuidV7(),
            owner.id,
            UUID.randomUUID(),
        )

        val forbidden = listOf(CUSTOMER_NAME, "Gizli Müşteri", SECRET_NOTE, "GIZLI-ETIKET", photoKey, customerPhone, owner.phone, "987,65")
        listOf(AdminRole.ADMIN, AdminRole.SUPPORT).forEach { role ->
            val (_, session) = admins.signedIn(role)
            val pages =
                listOf(
                    "/admin",
                    "/admin/shops?q=" + shopName.takeLast(6),
                    "/admin/shops/$shopId",
                    "/admin/users?phone=" + owner.phone,
                    "/admin/users/${owner.id}",
                    "/admin/users/${staff.id}",
                    "/admin/audit",
                    "/admin/admins",
                    "/admin/account/password",
                )
            pages.forEach { path ->
                val response = page(path, session).response
                val html = response.contentAsString
                if (response.status == 200) {
                    forbidden.forEach { value -> assertFalse(html.contains(value), "$role page $path shows a forbidden value") }
                } else {
                    assertEquals(403, response.status, "$role page $path")
                }
            }
            val shopPage = page("/admin/shops/$shopId", session).response.contentAsString
            assertTrue(shopPage.contains(shopName))
            assertTrue(shopPage.contains("Kayıtlı müşteri"))
            assertTrue(Regex(">\\s*1\\s*</strong>").findAll(shopPage).count() >= 3, "counts of customers, entries and photos")
            assertTrue(page("/admin/users/${owner.id}", session).response.contentAsString.contains(owner.phone.takeLast(2)))
        }
    }

    companion object {
        const val CUSTOMER_NAME = "[ÖRNEK] Gizli Müşteri"
        const val SECRET_NOTE = "GIZLI-NOT"

        private val FORBIDDEN_TYPES =
            setOf(
                "app.cetele.server.media.store.MediaStore",
                "app.cetele.server.media.store.S3MediaStore",
                "app.cetele.server.ledger.entry.LedgerEntryRepository",
                "app.cetele.server.ledger.customer.CustomerRepository",
                "app.cetele.server.statements.link.StatementLinkService",
                "app.cetele.server.statements.link.StatementLinkRepository",
            )

        val boundary: ArchRule =
            noClasses()
                .that()
                .resideInAPackage("app.cetele.server.admin..")
                .should()
                .dependOnClassesThat(
                    DescribedPredicate.describe("read ledger content, photos, statement links or reminder texts") { type: JavaClass ->
                        type.name in FORBIDDEN_TYPES || type.packageName.startsWith("app.cetele.server.reminders.template")
                    },
                ).because("the console shows counts and metadata only (ADR-0033)")
    }
}
