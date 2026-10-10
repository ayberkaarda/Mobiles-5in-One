package app.cetele.server.admin.web

import app.cetele.server.admin.AdminConflictException
import app.cetele.server.admin.AdminNotFoundException
import app.cetele.server.admin.AdminPrincipal
import app.cetele.server.security.CspNonceFilter
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpHeaders
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.ui.Model
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.ModelAttribute
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.servlet.ModelAndView

/** Model attributes of every console page: the CSP nonce and the signed-in admin (or `null`). */
object AdminModel {
    const val NONCE = "cspNonce"
    const val CURRENT = "currentAdmin"

    fun common(request: HttpServletRequest): Map<String, Any?> =
        mapOf(
            NONCE to request.getAttribute(CspNonceFilter.ATTRIBUTE),
            CURRENT to AdminPrincipal.of(SecurityContextHolder.getContext().authentication),
        )

    /** The generic console message page with [status]. */
    fun message(
        request: HttpServletRequest,
        response: HttpServletResponse,
        status: Int,
        title: String,
        text: String,
    ): ModelAndView {
        response.status = status
        return ModelAndView("admin/message", common(request) + mapOf("title" to title, "text" to text))
    }
}

/**
 * Error pages of the console: HTML in Turkish instead of the API's problem documents. Ordered
 * before the API's `ProblemHandler`, and limited to the console controllers.
 */
@ControllerAdvice(basePackages = ["app.cetele.server.admin.web"])
@Order(Ordered.HIGHEST_PRECEDENCE)
class AdminWebAdvice {
    private val log = LoggerFactory.getLogger(AdminWebAdvice::class.java)

    @ModelAttribute
    fun common(
        request: HttpServletRequest,
        model: Model,
    ) {
        model.addAllAttributes(AdminModel.common(request))
    }

    @ExceptionHandler(AdminNotFoundException::class, MethodArgumentTypeMismatchException::class)
    fun notFound(
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ModelAndView = AdminModel.message(request, response, 404, "Bulunamadı", "Aradığınız kayıt bulunamadı.")

    @ExceptionHandler(AdminConflictException::class)
    fun conflict(
        exception: AdminConflictException,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ModelAndView = AdminModel.message(request, response, 409, "İşlem yapılamadı", exception.messageTr)

    @ExceptionHandler(AccessDeniedException::class)
    fun denied(
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ModelAndView = AdminModel.message(request, response, 403, "Yetkiniz yok", AdminDenied.NO_PERMISSION)

    @ExceptionHandler(MissingServletRequestParameterException::class)
    fun badRequest(
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ModelAndView = AdminModel.message(request, response, 400, "Eksik bilgi", "Formdaki zorunlu alanları doldurun.")

    @ExceptionHandler(ProblemException::class)
    fun problem(
        exception: ProblemException,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ModelAndView {
        if (exception.code == ProblemCode.RATE_LIMITED) {
            exception.headers[HttpHeaders.RETRY_AFTER]?.let { response.setHeader(HttpHeaders.RETRY_AFTER, it) }
            return AdminModel.message(
                request,
                response,
                429,
                "Çok fazla deneme",
                "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra yeniden deneyin.",
            )
        }
        log.warn("Admin console outcome=problem code={}", exception.code.code)
        return AdminModel.message(request, response, exception.code.status.value(), "İşlem yapılamadı", "İstek işlenemedi.")
    }

    @ExceptionHandler(Exception::class)
    fun unexpected(
        exception: Exception,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ModelAndView {
        log.error("Admin console outcome=error type={}", exception.javaClass.simpleName, exception)
        return AdminModel.message(request, response, 500, "Beklenmeyen hata", "Beklenmeyen bir hata oluştu. Lütfen yeniden deneyin.")
    }
}
