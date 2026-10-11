package app.cetele.server.sync

import app.cetele.server.auth.web.MePatchBody
import app.cetele.server.tenancy.shop.ShopType
import app.cetele.server.tenancy.web.CreateShopRequest
import app.cetele.server.tenancy.web.UpdateShopRequest
import app.cetele.server.web.problem.ProblemFieldError
import app.cetele.server.web.validation.containsBidiControl
import jakarta.validation.Validation
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.LocalDate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BidiValidationTest {
    private val controls = listOf('\u200E', '\u200F', '\u061C') + ('\u202A'..'\u202E') + ('\u2066'..'\u2069')

    @Test
    fun `predicate rejects every bidi control and accepts Turkish and joined emoji`() {
        controls.forEach { assertTrue(containsBidiControl("a${it}b")) }
        listOf("", "Çağrı Şişçi", "👩\u200D💻", "satır\nsonu", "a\u200Cb").forEach {
            assertFalse(containsBidiControl(it))
        }
    }

    @Test
    fun `sync text fields return their existing format errors for every bidi control`() {
        Validation.buildDefaultValidatorFactory().use { factory ->
            val validation = SyncValidation(factory.validator, Clock.systemUTC())
            val shopId = UUID.randomUUID()
            controls.forEach { control ->
                val text = "a${control}b"
                val customer = CustomerInput(UUID.randomUUID(), text, note = text, tag = text, smsConsent = false)
                val op = SyncOperation(UUID.randomUUID(), 1, OperationKind.CUSTOMER_UPSERT, customer = customer)
                assertEquals(
                    listOf("customer.name", "customer.note", "customer.tag").map { ProblemFieldError(it, "invalid_format") },
                    validation.fields(shopId, op),
                )
                val entry = EntryInput(UUID.randomUUID(), customer.id, "DEBT", 1, LocalDate.now(), note = text)
                assertEquals(
                    listOf(ProblemFieldError("entry.note", "invalid_format")),
                    validation.fields(shopId, SyncOperation(UUID.randomUUID(), 1, OperationKind.ENTRY_CREATE, entry = entry)),
                )
            }
            listOf("Çağrı Şişçi", "👩\u200D💻").forEach { text ->
                val customer = CustomerInput(UUID.randomUUID(), text, note = "$text\n", tag = text, smsConsent = false)
                val op = SyncOperation(UUID.randomUUID(), 1, OperationKind.CUSTOMER_UPSERT, customer = customer)
                assertEquals(emptyList(), validation.fields(shopId, op))
            }
        }
    }

    @Test
    fun `shop and display name constraints reject bidi controls with the existing code`() {
        Validation.buildDefaultValidatorFactory().use { factory ->
            controls.forEach { control ->
                val text = "a${control}b"
                val bodies =
                    listOf(
                        CreateShopRequest(text, ShopType.BAKKAL, text, text),
                        UpdateShopRequest(name = text),
                        MePatchBody(text),
                    )
                bodies.forEach { body ->
                    val violations = factory.validator.validate(body)
                    assertTrue(violations.isNotEmpty())
                    assertTrue(violations.all { it.message == "invalid_format" })
                }
            }
            listOf("Çağrı Şişçi", "👩\u200D💻").forEach { text ->
                assertTrue(factory.validator.validate(CreateShopRequest(text, ShopType.BAKKAL, text, text)).isEmpty())
                assertTrue(factory.validator.validate(MePatchBody(text)).isEmpty())
            }
        }
    }
}
