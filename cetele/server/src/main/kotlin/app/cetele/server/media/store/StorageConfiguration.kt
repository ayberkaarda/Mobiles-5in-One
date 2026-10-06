package app.cetele.server.media.store

import app.cetele.server.config.StorageProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import java.net.URI

@Configuration(proxyBeanMethods = false)
class StorageConfiguration {
    @Bean(destroyMethod = "close")
    fun s3Client(properties: StorageProperties): S3Client {
        require(properties.isConfigured) { "S3 storage requires endpoint and credentials" }
        return S3Client
            .builder()
            .endpointOverride(URI.create(properties.endpoint))
            .region(Region.of(properties.region))
            .credentialsProvider(credentials(properties))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyle).build())
            .httpClientBuilder(UrlConnectionHttpClient.builder())
            .build()
    }

    @Bean(destroyMethod = "close")
    fun s3Presigner(properties: StorageProperties): S3Presigner {
        require(properties.isConfigured) { "S3 storage requires endpoint and credentials" }
        return S3Presigner
            .builder()
            .endpointOverride(URI.create(properties.endpoint))
            .region(Region.of(properties.region))
            .credentialsProvider(credentials(properties))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyle).build())
            .build()
    }

    private fun credentials(properties: StorageProperties) =
        StaticCredentialsProvider.create(AwsBasicCredentials.create(properties.accessKey, properties.secretKey))
}
