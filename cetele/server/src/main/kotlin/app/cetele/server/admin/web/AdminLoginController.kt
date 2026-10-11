package app.cetele.server.admin.web

import app.cetele.server.admin.AdminLoginService
import app.cetele.server.admin.AdminManagementService
import app.cetele.server.admin.AdminPrincipal
import app.cetele.server.admin.AdminSecurityConfig
import app.cetele.server.admin.AdminSessionPolicy
import app.cetele.server.admin.LoginStage
import app.cetele.server.admin.LoginStepResult
import app.cetele.server.admin.PasswordChangeResult
import app.cetele.server.admin.totp.TotpService
import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.config.ClientIp
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import java.io.Serializable
import java.time.Clock
import java.time.Instant
import java.util.UUID

/** The pre-authentication state kept in the session between login steps; it grants no role. */
data class PendingLogin(
    val adminId: UUID,
    val email: String,
    val stage: LoginStage,
    val enrollSecret: String? = null,
    val startedAt: Instant,
) : Serializable {
    companion object {
        private const val serialVersionUID = 1L
    }
}

/** Session changes of the login steps: new id after the password, again when the role is granted. */
internal object AdminSessions {
    fun pending(request: HttpServletRequest): PendingLogin? =
        request.getSession(false)?.getAttribute(AdminSessionPolicy.PENDING) as? PendingLogin

    fun pending(
        request: HttpServletRequest,
        stage: LoginStage,
    ): PendingLogin? = pending(request)?.takeIf { it.stage == stage }

    fun setPending(
        request: HttpServletRequest,
        pending: PendingLogin,
    ) {
        request.getSession(true).setAttribute(AdminSessionPolicy.PENDING, pending)
    }

    fun end(request: HttpServletRequest) {
        request.getSession(false)?.invalidate()
        SecurityContextHolder.clearContext()
    }

    /**
     * Drops any login state but keeps the session and its CSRF token, so the login form rendered
     * in the same response stays valid.
     */
    fun reset(request: HttpServletRequest) {
        request.getSession(false)?.let { session ->
            listOf(
                AdminSessionPolicy.PENDING,
                AdminSessionPolicy.STARTED_AT,
                AdminSessionPolicy.LAST_SEEN_AT,
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
            ).forEach(session::removeAttribute)
        }
        SecurityContextHolder.clearContext()
    }

    fun path(stage: LoginStage): String =
        when (stage) {
            LoginStage.TOTP_VERIFY -> "/admin/login/totp"
            LoginStage.TOTP_ENROLL -> "/admin/totp/enroll"
            LoginStage.PASSWORD_CHANGE -> "/admin/account/password"
            LoginStage.DONE -> "/admin"
        }
}

@Controller
class AdminLoginController(
    private val login: AdminLoginService,
    private val limits: RateLimiter,
    private val totp: TotpService,
    private val contextRepository: HttpSessionSecurityContextRepository,
    private val clock: Clock,
    private val management: AdminManagementService,
) {
    @GetMapping("/admin/login")
    fun loginPage(): String {
        if (AdminPrincipal.of(SecurityContextHolder.getContext().authentication) != null) return "redirect:/admin"
        return LOGIN_VIEW
    }

    @PostMapping("/admin/login")
    fun login(
        @RequestParam(defaultValue = "") email: String,
        @RequestParam(defaultValue = "") password: String,
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String {
        limits.consume(RateLimit.ADMIN_LOGIN_IP, ClientIp.of(request))
        val result = login.passwordStep(email.take(MAX_EMAIL), password)
        if (result !is LoginStepResult.Accepted) return failedLogin(request, response, model)
        AdminSessions.end(request)
        val session = request.getSession(true)
        AdminSessionPolicy.start(session, clock.instant())
        AdminSessions.setPending(
            request,
            PendingLogin(result.adminId, result.email, result.next, startedAt = checkNotNull(result.startedAt)),
        )
        return "redirect:" + AdminSessions.path(result.next)
    }

    @GetMapping("/admin/login/totp")
    fun totpPage(request: HttpServletRequest): String {
        currentPending(request, LoginStage.TOTP_VERIFY) ?: return "redirect:" + AdminSecurityConfig.LOGIN_PATH
        return TOTP_VIEW
    }

    @PostMapping("/admin/login/totp")
    fun totp(
        @RequestParam(defaultValue = "") code: String,
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String {
        val pending = currentPending(request, LoginStage.TOTP_VERIFY) ?: return "redirect:" + AdminSecurityConfig.LOGIN_PATH
        limits.consume(RateLimit.ADMIN_LOGIN_IP, ClientIp.of(request))
        val result = login.totpStep(pending.adminId, code.take(MAX_CODE), pending.startedAt)
        return next(result, pending, request, response, model, TOTP_VIEW)
    }

    @GetMapping("/admin/totp/enroll")
    fun enrollPage(
        request: HttpServletRequest,
        model: Model,
    ): String {
        val pending = currentPending(request, LoginStage.TOTP_ENROLL) ?: return "redirect:" + AdminSecurityConfig.LOGIN_PATH
        addEnrollment(request, pending, model)
        return ENROLL_VIEW
    }

    @PostMapping("/admin/totp/enroll")
    fun enroll(
        @RequestParam(defaultValue = "") code: String,
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String {
        val pending = currentPending(request, LoginStage.TOTP_ENROLL) ?: return "redirect:" + AdminSecurityConfig.LOGIN_PATH
        val secret = pending.enrollSecret ?: return "redirect:/admin/totp/enroll"
        limits.consume(RateLimit.ADMIN_LOGIN_IP, ClientIp.of(request))
        val result = login.enrollStep(pending.adminId, secret, code.take(MAX_CODE), pending.startedAt)
        if (result is LoginStepResult.Rejected && !result.restart) addEnrollment(request, pending, model)
        return next(result, pending, request, response, model, ENROLL_VIEW)
    }

    @GetMapping("/admin/account/password")
    fun passwordPage(
        request: HttpServletRequest,
        model: Model,
    ): String {
        val forced = currentPending(request, LoginStage.PASSWORD_CHANGE) != null
        if (!forced && signedIn() == null) return "redirect:" + AdminSecurityConfig.LOGIN_PATH
        model.addAttribute("forced", forced)
        return PASSWORD_VIEW
    }

    @PostMapping("/admin/account/password")
    fun changePassword(
        @RequestParam(defaultValue = "") currentPassword: String,
        @RequestParam(defaultValue = "") newPassword: String,
        @RequestParam(defaultValue = "") confirmPassword: String,
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String {
        val pending = currentPending(request, LoginStage.PASSWORD_CHANGE)
        val admin = signedIn()
        if (pending == null && admin == null) return "redirect:" + AdminSecurityConfig.LOGIN_PATH
        model.addAttribute("forced", pending != null)
        if (newPassword != confirmPassword) return invalid(response, model, "Yeni parola ile tekrarı aynı değil.")
        val result =
            if (pending != null) {
                login.forcedPasswordChange(pending.adminId, newPassword, pending.startedAt)
            } else {
                login.changePassword(checkNotNull(admin).id, currentPassword, newPassword)
            }
        return when (result) {
            is PasswordChangeResult.Invalid -> {
                invalid(response, model, result.messageTr)
            }

            PasswordChangeResult.Restart -> {
                AdminSessions.end(request)
                "redirect:" + AdminSecurityConfig.LOGIN_PATH
            }

            is PasswordChangeResult.Changed -> {
                val principal = result.principal
                if (principal != null) {
                    grant(principal, request, response)
                } else {
                    model.addAttribute("notice", "Parolanız değiştirildi.")
                    PASSWORD_VIEW
                }
            }
        }
    }

    @PostMapping("/admin/logout")
    fun logout(request: HttpServletRequest): String {
        signedIn()?.let { login.recordLogout(it.id) }
        AdminSessions.end(request)
        return "redirect:" + AdminSecurityConfig.LOGIN_PATH
    }

    private fun next(
        result: LoginStepResult,
        pending: PendingLogin,
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
        view: String,
    ): String =
        when (result) {
            is LoginStepResult.Rejected -> {
                if (result.restart) {
                    failedLogin(request, response, model)
                } else {
                    response.status = HttpServletResponse.SC_UNAUTHORIZED
                    model.addAttribute("error", CODE_FAILED)
                    view
                }
            }

            is LoginStepResult.Accepted -> {
                when (result.next) {
                    LoginStage.DONE -> {
                        grant(checkNotNull(result.principal), request, response)
                    }

                    else -> {
                        request.changeSessionId()
                        AdminSessions.setPending(request, pending.copy(stage = result.next, enrollSecret = null))
                        "redirect:" + AdminSessions.path(result.next)
                    }
                }
            }
        }

    /** The last step: a new session id, no pending marker, and the role in the security context. */
    private fun grant(
        principal: AdminPrincipal,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): String {
        request.changeSessionId()
        request.getSession(true).removeAttribute(AdminSessionPolicy.PENDING)
        val context = SecurityContextHolder.createEmptyContext().apply { authentication = principal.authentication() }
        SecurityContextHolder.setContext(context)
        contextRepository.saveContext(context, request, response)
        return "redirect:/admin"
    }

    private fun addEnrollment(
        request: HttpServletRequest,
        pending: PendingLogin,
        model: Model,
    ) {
        val secret = pending.enrollSecret ?: totp.newSecret().also { AdminSessions.setPending(request, pending.copy(enrollSecret = it)) }
        model.addAttribute("enrollment", totp.enrollment(secret, pending.email))
    }

    /** Every failure shows the same text; the pre-authentication, if any, is dropped. */
    private fun failedLogin(
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String {
        AdminSessions.reset(request)
        response.status = HttpServletResponse.SC_UNAUTHORIZED
        model.addAttribute("error", LOGIN_FAILED)
        model.addAttribute(AdminModel.CURRENT, null)
        return LOGIN_VIEW
    }

    private fun invalid(
        response: HttpServletResponse,
        model: Model,
        message: String,
    ): String {
        response.status = HttpServletResponse.SC_BAD_REQUEST
        model.addAttribute("error", message)
        return PASSWORD_VIEW
    }

    private fun currentPending(
        request: HttpServletRequest,
        stage: LoginStage,
    ): PendingLogin? {
        val pending = AdminSessions.pending(request, stage) ?: return null
        if (management.isPendingCurrent(pending.adminId, pending.startedAt)) return pending
        AdminSessions.end(request)
        return null
    }

    private fun signedIn(): AdminPrincipal? = AdminPrincipal.of(SecurityContextHolder.getContext().authentication)

    companion object {
        const val LOGIN_VIEW = "admin/login"
        const val TOTP_VIEW = "admin/totp"
        const val ENROLL_VIEW = "admin/enroll"
        const val PASSWORD_VIEW = "admin/password"
        const val LOGIN_FAILED = "E-posta, parola veya doğrulama kodu hatalı ya da hesap kullanılamıyor."
        const val CODE_FAILED = "Doğrulama kodu kabul edilmedi. Uygulamadaki güncel kodu girin."
        private const val MAX_EMAIL = 320
        private const val MAX_CODE = 16
    }
}
