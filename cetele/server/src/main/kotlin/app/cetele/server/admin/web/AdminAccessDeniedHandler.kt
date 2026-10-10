package app.cetele.server.admin.web

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.web.access.AccessDeniedHandler
import org.springframework.security.web.csrf.CsrfException
import org.springframework.web.servlet.ViewResolver
import java.util.Locale

/** Texts of the 403 console page. */
object AdminDenied {
    const val NO_PERMISSION = "Bu sayfa veya işlem için yetkiniz yok."
    const val CSRF_FAILED = "Form geçersiz veya süresi dolmuş. Sayfayı yenileyip yeniden deneyin."
}

/**
 * Renders the 403 console page for a role that lacks the route and for a missing or invalid CSRF
 * token, straight from the security chain (no forward, no state change).
 */
class AdminAccessDeniedHandler(
    private val views: ViewResolver,
) : AccessDeniedHandler {
    override fun handle(
        request: HttpServletRequest,
        response: HttpServletResponse,
        accessDeniedException: AccessDeniedException,
    ) {
        val csrf = accessDeniedException is CsrfException
        val model =
            AdminModel.common(request) +
                mapOf(
                    "title" to if (csrf) "Form süresi doldu" else "Yetkiniz yok",
                    "text" to if (csrf) AdminDenied.CSRF_FAILED else AdminDenied.NO_PERMISSION,
                )
        response.status = HttpServletResponse.SC_FORBIDDEN
        val view = checkNotNull(views.resolveViewName("admin/message", TURKISH)) { "admin/message view is missing" }
        view.render(model, request, response)
    }

    private companion object {
        val TURKISH: Locale = Locale.forLanguageTag("tr-TR")
    }
}
