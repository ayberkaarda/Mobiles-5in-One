package app.cetele.server

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration

// No in-memory user store: shop users sign in with OTP, platform admins have their own store.
@SpringBootApplication(exclude = [UserDetailsServiceAutoConfiguration::class])
@ConfigurationPropertiesScan
class CeteleServerApplication

fun main(args: Array<String>) {
    runApplication<CeteleServerApplication>(*args)
}
