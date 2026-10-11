package app.cetele.server.monitoring

import app.cetele.server.config.SmsLimitsProperties
import app.cetele.server.media.MediaFixtures
import app.cetele.server.media.MediaPresignRequest
import app.cetele.server.media.MediaService
import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals

/**
 * The hard cost caps of spec item 22 that had no test of their own: the monthly presign quota holds
 * under concurrent requests (the binding of `CETELE_SMS_DAILY_CAP` is in `MonitoringConfigurationTest`). The per-shop monthly SMS quota (FREE 30, PRO 500, concurrent
 * reservations) and the daily cap enforcement are covered by `SmsQuotaServiceTest`, `DailyCapTest`
 * and `ReminderFlowTest`.
 */
@IntegrationTest
class HardCapsTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
    @Autowired private val media: MediaService,
    @Autowired private val limits: SmsLimitsProperties,
) {
    @Test
    fun `the application binds the default daily SMS cap`() {
        assertEquals(1000, limits.dailyCap)
    }

    @Test
    fun `concurrent presigns at the monthly photo quota reserve only the free slots`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        repeat(197) {
            val id = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, photo_key, upload_expires_at, ready_at) VALUES (?, ?, 'READY', 'image/jpeg', 100, ?, ?, now() + interval '10 minutes', now())",
                id,
                f.shopId,
                f.uploadKey(id),
                "media/${f.shopId}/$id.jpg",
            )
        }
        val executor = Executors.newFixedThreadPool(12)
        try {
            val results =
                executor
                    .invokeAll(
                        (1..24).map {
                            Callable {
                                try {
                                    media.presign(f.shopId, f.owner.id, MediaPresignRequest("image/jpeg", 100))
                                    true
                                } catch (failure: ProblemException) {
                                    assertEquals(ProblemCode.PLAN_PHOTO_LIMIT, failure.code)
                                    false
                                }
                            }
                        },
                    ).map { it.get(60, TimeUnit.SECONDS) }
            assertEquals(3, results.count { it })
            assertEquals(21, results.count { !it })
            assertEquals(200, jdbc.queryForObject("SELECT count(*) FROM media_objects WHERE shop_id = ?", Int::class.java, f.shopId))
        } finally {
            executor.shutdownNow()
        }
    }
}
