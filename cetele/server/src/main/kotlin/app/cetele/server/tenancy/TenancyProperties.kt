package app.cetele.server.tenancy

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "cetele.tenancy")
data class TenancyProperties(
    val maxOwnedShops: Int = 3,
) {
    init {
        require(maxOwnedShops > 0) { "cetele.tenancy.max-owned-shops must be positive" }
    }
}
