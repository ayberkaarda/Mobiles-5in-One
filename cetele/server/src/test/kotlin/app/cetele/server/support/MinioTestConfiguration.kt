package app.cetele.server.support

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.test.context.DynamicPropertyRegistrar
import org.testcontainers.containers.MinIOContainer
import org.testcontainers.utility.DockerImageName
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import java.net.URI
import java.util.UUID

@TestConfiguration(proxyBeanMethods = false)
class MinioTestConfiguration {
    @Bean
    fun minioContainer(): MinIOContainer =
        MinIOContainer(
            DockerImageName.parse("pgsty/minio:RELEASE.2026-08-04T00-00-00Z").asCompatibleSubstituteFor("minio/minio"),
        ).withUserName("test" + UUID.randomUUID().toString().take(8))
            .withPassword(UUID.randomUUID().toString())

    @Bean
    fun minioProperties(container: MinIOContainer): DynamicPropertyRegistrar =
        DynamicPropertyRegistrar { registry ->
            // Registrars run before application beans, so the bucket exists before the storage client.
            if (!container.isRunning) container.start()
            S3Client
                .builder()
                .endpointOverride(URI.create(container.s3URL))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(container.userName, container.password)))
                .forcePathStyle(true)
                .httpClientBuilder(UrlConnectionHttpClient.builder())
                .build()
                .use { client -> client.createBucket { it.bucket(BUCKET) } }
            // The region keeps its default ("auto"), as in the compose stack.
            registry.add("cetele.s3.endpoint", container::getS3URL)
            registry.add("cetele.s3.access-key", container::getUserName)
            registry.add("cetele.s3.secret-key", container::getPassword)
            registry.add("cetele.s3.bucket-media") { BUCKET }
            registry.add("cetele.s3.path-style") { true }
        }

    companion object {
        const val BUCKET = "cetele-media"
    }
}
