package app.cetele.server.admin

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.Authentication
import org.springframework.security.core.authority.SimpleGrantedAuthority
import java.io.Serializable
import java.util.UUID

/** The signed-in admin, kept in the console session. Holds no secret. */
data class AdminPrincipal(
    val id: UUID,
    val email: String,
    val role: AdminRole,
) : Serializable {
    val isAdmin: Boolean get() = role == AdminRole.ADMIN

    fun authentication(): Authentication =
        UsernamePasswordAuthenticationToken.authenticated(this, null, listOf(SimpleGrantedAuthority(role.authority)))

    companion object {
        private const val serialVersionUID = 1L

        fun of(authentication: Authentication?): AdminPrincipal? = authentication?.principal as? AdminPrincipal
    }
}

/** A console page for a missing row (404). */
class AdminNotFoundException : RuntimeException("admin console target not found")

/** A console action refused by a rule (409); [messageTr] is the Turkish text shown. */
class AdminConflictException(
    val messageTr: String,
) : RuntimeException("admin console action refused")
