package app.cetele.server.media

import app.cetele.server.config.CeteleTime
import app.cetele.server.media.store.MediaStore
import app.cetele.server.tenancy.PlanLimits
import app.cetele.server.tenancy.ShopLocks
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.FieldErrorCodes
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemFieldError
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

data class MediaPresignRequest(
    val contentType: String,
    val contentLength: Int,
)

data class MediaUploadView(
    val mediaId: UUID,
    val uploadUrl: String,
    val method: String,
    val headers: Map<String, String>,
    val expiresAt: Instant,
    val photoKey: String,
)

data class MediaReadyView(
    val mediaId: UUID,
    val photoKey: String,
    val status: MediaStatus,
    val width: Int,
    val height: Int,
    val bytes: Int,
)

data class MediaDownloadView(
    val mediaId: UUID,
    val status: MediaStatus,
    val photoKey: String,
    val downloadUrl: String,
    val expiresAt: Instant,
)

@Service
class MediaService(
    private val repository: MediaObjectRepository,
    private val shops: ShopRepository,
    private val locks: ShopLocks,
    private val store: MediaStore,
    private val processor: MediaProcessor,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(transactionManager)
    private val log = LoggerFactory.getLogger(MediaService::class.java)

    fun presign(
        shopId: UUID,
        userId: UUID,
        request: MediaPresignRequest,
    ): MediaUploadView {
        val errors =
            buildList {
                if (request.contentType !in
                    setOf("image/jpeg", "image/webp")
                ) {
                    add(ProblemFieldError("contentType", FieldErrorCodes.INVALID_FORMAT))
                }
                if (request.contentLength !in 1..MediaStore.MAX_BYTES) add(ProblemFieldError("contentLength", FieldErrorCodes.OUT_OF_RANGE))
            }
        if (errors.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, errors = errors)
        return checkNotNull(
            tx.execute {
                locks.mediaQuota(shopId)
                val shop = shops.findActive(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
                val now = clock.instant()
                val start =
                    now
                        .atZone(CeteleTime.ZONE)
                        .toLocalDate()
                        .withDayOfMonth(1)
                        .atStartOfDay(CeteleTime.ZONE)
                        .toInstant()
                if (repository.countReserved(shopId, start) >=
                    PlanLimits.of(shop.plan).photosPerMonth
                ) {
                    throw ProblemException(ProblemCode.PLAN_PHOTO_LIMIT)
                }
                val row = repository.save(MediaObject(shopId, request.contentType, request.contentLength, userId, now, now.plus(TTL)))
                val id = checkNotNull(row.id)
                row.uploadKey = "uploads/$shopId/$id"
                row.photoKey = "media/$shopId/$id.jpg"
                val upload = store.presignPut(row.uploadKey, request.contentType, request.contentLength.toLong(), TTL)
                log.info("Media shopId={} mediaId={} outcome=pending", shopId, id)
                MediaUploadView(id, upload.url.toString(), upload.method, upload.headers, row.uploadExpiresAt, checkNotNull(row.photoKey))
            },
        )
    }

    fun complete(
        shopId: UUID,
        mediaId: UUID,
    ): MediaReadyView {
        var rejection: ProblemCode? = null
        val result =
            tx.execute {
                // Same lock as the deletion executor, taken first and held through storage writes and commit.
                locks.deletion(shopId)
                val row = repository.lock(shopId, mediaId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
                if (row.status == MediaStatus.READY) return@execute ready(row)
                if (row.status != MediaStatus.PENDING) throw ProblemException(ProblemCode.NOT_FOUND)
                val info = store.head(row.uploadKey) ?: throw ProblemException(ProblemCode.MEDIA_NOT_UPLOADED)
                try {
                    if (info.length > row.declaredLength ||
                        info.length > MediaStore.MAX_BYTES
                    ) {
                        throw ProblemException(ProblemCode.MEDIA_TOO_LARGE)
                    }
                    val bytes = store.get(row.uploadKey)
                    if (bytes.size > row.declaredLength) throw ProblemException(ProblemCode.MEDIA_TOO_LARGE)
                    val image = processor.process(bytes)
                    store.put(checkNotNull(row.photoKey), image.bytes, "image/jpeg")
                    store.delete(row.uploadKey)
                    row.width = image.width
                    row.height = image.height
                    row.bytes = image.bytes.size
                    row.readyAt = clock.instant()
                    row.status = MediaStatus.READY
                    log.info("Media shopId={} mediaId={} outcome=ready", shopId, mediaId)
                    ready(row)
                } catch (exception: ProblemException) {
                    if (exception.code !in setOf(ProblemCode.MEDIA_INVALID, ProblemCode.MEDIA_TOO_LARGE)) throw exception
                    store.delete(row.uploadKey)
                    row.status = MediaStatus.FAILED
                    row.failureCode = exception.code.code
                    rejection = exception.code
                    log.info("Media shopId={} mediaId={} outcome=failed", shopId, mediaId)
                    null
                }
            }
        rejection?.let { throw ProblemException(it) }
        return checkNotNull(result)
    }

    fun download(
        shopId: UUID,
        mediaId: UUID,
    ): MediaDownloadView =
        checkNotNull(
            tx.execute {
                val row = repository.findByShopIdAndId(shopId, mediaId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
                if (row.status != MediaStatus.READY) throw ProblemException(ProblemCode.MEDIA_NOT_READY)
                val key = checkNotNull(row.photoKey)
                MediaDownloadView(mediaId, row.status, key, store.presignGet(key, TTL).toString(), clock.instant().plus(TTL))
            },
        )

    private fun ready(row: MediaObject) =
        MediaReadyView(
            checkNotNull(row.id),
            checkNotNull(row.photoKey),
            row.status,
            checkNotNull(row.width),
            checkNotNull(row.height),
            checkNotNull(row.bytes),
        )

    companion object {
        val TTL: Duration = Duration.ofMinutes(10)
    }
}
