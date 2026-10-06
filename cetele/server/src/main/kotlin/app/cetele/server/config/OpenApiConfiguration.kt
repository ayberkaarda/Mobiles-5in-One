package app.cetele.server.config

import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import io.swagger.v3.oas.models.servers.Server
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * OpenAPI description of `/v1`. The document is served at `/v3/api-docs` only in the `local`
 * and `test` profiles (`springdoc.api-docs.enabled`); the build exports it to
 * `build/openapi/openapi.json` during the test run.
 */
@Configuration(proxyBeanMethods = false)
class OpenApiConfiguration {
    @Bean
    fun ceteleOpenApi(): OpenAPI =
        OpenAPI()
            .info(
                Info()
                    .title("Cetele API")
                    .version("v1")
                    .description("Shop ledger API. Errors are RFC 9457 problem documents with a stable `code`."),
            )
            // A fixed server entry keeps the exported document stable across machines.
            .servers(listOf(Server().url(PUBLIC_API_URL).description("Production")))
            .components(
                Components().addSecuritySchemes(
                    BEARER_SCHEME,
                    SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT"),
                ),
            ).addSecurityItem(SecurityRequirement().addList(BEARER_SCHEME))

    companion object {
        const val BEARER_SCHEME = "bearerAuth"
        const val PUBLIC_API_URL = "https://cetele.app"
    }
}
