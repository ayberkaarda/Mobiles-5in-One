package app.cetele.server.config

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * S3-compatible object storage settings (Cloudflare R2 in production, MinIO locally).
 *
 * Values come from the `CETELE_S3_*` environment variables through `application.yml`.
 * The media bucket is private; objects are only reached through presigned URLs.
 */
@ConfigurationProperties(prefix = "cetele.s3")
data class StorageProperties(
    val endpoint: String = "",
    val region: String = "auto",
    val accessKey: String = "",
    val secretKey: String = "",
    val bucketMedia: String = "cetele-media",
    val pathStyle: Boolean = true,
) {
    /** True when credentials and an endpoint are present, so a storage client can be created. */
    val isConfigured: Boolean
        get() = endpoint.isNotBlank() && accessKey.isNotBlank() && secretKey.isNotBlank()

    override fun toString(): String =
        "StorageProperties(endpoint=$endpoint, region=$region, bucketMedia=$bucketMedia, pathStyle=$pathStyle, credentials=<masked>)"
}
