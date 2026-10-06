package app.cetele.server.media.store

import app.cetele.server.config.StorageProperties
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Component
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.model.S3Exception
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import java.time.Duration

@Component
class S3MediaStore(
    private val client: S3Client,
    private val signer: S3Presigner,
    private val properties: StorageProperties,
) : MediaStore {
    override fun presignPut(
        key: String,
        contentType: String,
        contentLength: Long,
        ttl: Duration,
    ): PresignedUpload {
        val request =
            PutObjectRequest
                .builder()
                .bucket(properties.bucketMedia)
                .key(key)
                .contentType(contentType)
                .contentLength(contentLength)
                .build()
        val signed = signer.presignPutObject { it.signatureDuration(ttl).putObjectRequest(request) }
        check(signed.signedHeaders().keys.any { it.equals("content-length", true) }) { "Upload length must be signed" }
        check(signed.signedHeaders().keys.any { it.equals("content-type", true) }) { "Upload type must be signed" }
        return PresignedUpload(signed.url(), headers = mapOf("Content-Type" to contentType, "Content-Length" to contentLength.toString()))
    }

    override fun presignGet(
        key: String,
        ttl: Duration,
    ) = signer
        .presignGetObject {
            it.signatureDuration(ttl).getObjectRequest(
                GetObjectRequest
                    .builder()
                    .bucket(properties.bucketMedia)
                    .key(key)
                    .build(),
            )
        }.url()

    override fun head(key: String): ObjectInfo? =
        try {
            val response = client.headObject { it.bucket(properties.bucketMedia).key(key) }
            ObjectInfo(response.contentLength(), response.contentType())
        } catch (exception: S3Exception) {
            if (exception.statusCode() == 404) null else throw exception
        }

    override fun get(key: String): ByteArray =
        client.getObject { it.bucket(properties.bucketMedia).key(key) }.use { stream ->
            if (stream.response().contentLength() > MediaStore.MAX_BYTES) throw ProblemException(ProblemCode.MEDIA_TOO_LARGE)
            val bytes = stream.readNBytes(MediaStore.MAX_BYTES + 1)
            if (bytes.size > MediaStore.MAX_BYTES) throw ProblemException(ProblemCode.MEDIA_TOO_LARGE)
            bytes
        }

    override fun put(
        key: String,
        bytes: ByteArray,
        contentType: String,
    ) {
        client.putObject(
            PutObjectRequest
                .builder()
                .bucket(properties.bucketMedia)
                .key(key)
                .contentType(contentType)
                .build(),
            RequestBody.fromBytes(bytes),
        )
    }

    override fun delete(key: String) {
        client.deleteObject { it.bucket(properties.bucketMedia).key(key) }
    }

    override fun deletePrefix(prefix: String) {
        require(prefix.isNotBlank() && prefix.endsWith('/')) { "A directory prefix is required" }
        var cursor: String? = null
        do {
            val page = client.listObjectsV2 { it.bucket(properties.bucketMedia).prefix(prefix).continuationToken(cursor) }
            page.contents().forEach { delete(it.key()) }
            cursor = page.nextContinuationToken()
        } while (cursor != null)
    }
}
