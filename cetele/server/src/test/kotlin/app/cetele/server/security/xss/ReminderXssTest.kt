package app.cetele.server.security.xss

import app.cetele.server.config.CeteleTime
import app.cetele.server.ledger.money.MoneyFormat
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.reminders.template.ReminderTemplates
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.sync.CustomerInput
import app.cetele.server.sync.EntryInput
import app.cetele.server.sync.OperationKind
import app.cetele.server.sync.OperationStatus
import app.cetele.server.sync.PushRequest
import app.cetele.server.sync.PushResponse
import app.cetele.server.sync.SyncOperation
import app.cetele.server.tenancy.TenancyFixtures
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Item 16 on the SMS reminder text: names are plain text with control and format characters
 * (bidi overrides, zero-width marks, BOM) removed, nothing in a name is ever expanded as a
 * template, and a name cannot add a second link or change the amount.
 */
@IntegrationTest
class ReminderXssTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val clock: Clock,
    @Autowired private val gateway: SmsGateway,
) {
    private val url = "https://cetele.app/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE"

    private fun assertPlain(
        text: String,
        balanceMinor: Long,
        where: String,
    ) {
        assertFalse(
            text.any { Character.isISOControl(it) || Character.getType(it) == Character.FORMAT.toInt() },
            "$where: invisible characters",
        )
        assertFalse(text.contains(XssCorpus.EVAL_MARKER), "$where: expression evaluated")
        assertEquals(1, Regex("Hesap dökümü: ").findAll(text).count(), "$where: one link")
        assertTrue(
            Regex("""Hesap dökümü: https?://\S+/s/[A-Za-z0-9_-]+$""").containsMatchIn(text),
            "$where: the statement link ends the text: $text",
        )
        assertTrue(text.contains("güncel borcunuz ${MoneyFormat.format(balanceMinor)}."), "$where: amount")
        val names = text.substringBefore(" defterinizdeki ").removePrefix("Sayın ").split(", ")
        assertEquals(2, names.size, "$where: two names")
        names.forEach { name ->
            assertTrue(name.isNotBlank(), "$where: neutral fallback")
            assertTrue(name.codePointCount(0, name.length) <= NAME_LIMIT, "$where: bounded name")
            assertTrue(
                name.codePoints().allMatch { Character.isLetterOrDigit(it) || it in " '&-".map(Char::code) },
                "$where: permitted characters only",
            )
            assertTrue(name.codePoints().filter { Character.isDigit(it) }.count() < 7, "$where: no phone number")
        }
    }

    @Test
    fun `template filters every corpus payload and strips invisible characters`() {
        XssCorpus.all.forEach { payload ->
            val text = ReminderTemplates.balance(payload, payload, 12_500L, url)
            assertPlain(text, 12_500L, "template [$payload]")
            assertTrue(text.endsWith("Hesap dökümü: $url"))
        }
    }

    @Test
    fun `reminder sent through the api carries stored payloads as plain text`() {
        SENT.forEach { payload ->
            val world = TenancyFixtures(mvc, auth, jdbc).world()
            val renamed =
                mvc
                    .patch("/v1/shops/${world.shopId}") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = mapper.writeValueAsString(mapOf("name" to payload))
                    }.andReturn()
                    .response
            assertEquals(200, renamed.status, renamed.contentAsString)
            val phone = TestUsers.phone()
            val customerId = TraceIdFilter.uuidV7()
            val operations =
                listOf(
                    SyncOperation(
                        TraceIdFilter.uuidV7(),
                        1,
                        OperationKind.CUSTOMER_UPSERT,
                        customer =
                            CustomerInput(
                                customerId,
                                payload,
                                phone = phone,
                                note = payload,
                                smsConsent = true,
                                smsConsentAt = clock.instant(),
                                smsConsentSource = "IN_PERSON",
                            ),
                    ),
                    SyncOperation(
                        TraceIdFilter.uuidV7(),
                        2,
                        OperationKind.ENTRY_CREATE,
                        entry = EntryInput(TraceIdFilter.uuidV7(), customerId, "DEBT", 12_500L, CeteleTime.today(clock), note = payload),
                    ),
                )
            val pushed =
                mvc
                    .post("/v1/shops/${world.shopId}/sync/push") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = mapper.writeValueAsString(PushRequest(operations))
                    }.andReturn()
                    .response
            assertEquals(200, pushed.status, pushed.contentAsString)
            val results = mapper.readValue(pushed.contentAsString, PushResponse::class.java).results
            assertEquals(listOf(OperationStatus.APPLIED, OperationStatus.APPLIED), results.map { it.status }, results.toString())
            val sent =
                mvc
                    .post("/v1/shops/${world.shopId}/reminders") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = """{"customerId":"$customerId","channel":"SMS","template":"BALANCE"}"""
                    }.andReturn()
                    .response
            assertEquals(201, sent.status, sent.contentAsString)
            val message = (gateway as FakeSmsGateway).lastMessageTo(phone)!!
            assertPlain(message.text, 12_500L, "sms [$payload]")
        }
    }

    private companion object {
        const val NAME_LIMIT = 40

        /** One payload per family; the monthly SMS quota of a free shop is per shop, every payload gets its own shop. */
        val SENT =
            listOf(
                XssCorpus.markup[0],
                XssCorpus.markup[11],
                XssCorpus.urls[2],
                XssCorpus.expressions[0],
                XssCorpus.expressions[9],
                XssCorpus.encodings[0],
                XssCorpus.unicode[3],
                XssCorpus.unicode[2],
                XssCorpus.unicode[4],
                XssCorpus.csv[0],
            )
    }
}
