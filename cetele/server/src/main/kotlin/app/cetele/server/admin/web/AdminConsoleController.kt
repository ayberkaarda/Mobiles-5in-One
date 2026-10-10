package app.cetele.server.admin.web

import app.cetele.server.admin.AdminPrincipal
import app.cetele.server.admin.console.AdminConsoleService
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.servlet.mvc.support.RedirectAttributes
import java.util.UUID

/** The signed-in admin of the current request (the security chain guarantees one on these routes). */
internal fun currentAdmin(): AdminPrincipal =
    AdminPrincipal.of(SecurityContextHolder.getContext().authentication) ?: throw AccessDeniedException("no admin session")

/** Shop and user lookup (ADMIN and SUPPORT) and the user actions (ADMIN only). */
@Controller
class AdminConsoleController(
    private val console: AdminConsoleService,
) {
    @GetMapping("/admin")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPPORT')")
    fun dashboard(model: Model): String {
        model.addAttribute("dashboard", console.dashboard())
        return "admin/dashboard"
    }

    @GetMapping("/admin/shops")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPPORT')")
    fun shops(
        @RequestParam(required = false) q: String?,
        model: Model,
    ): String {
        val query = q?.trim().orEmpty()
        model.addAttribute("q", query.take(AdminConsoleService.MAX_QUERY_LENGTH))
        if (query.isNotEmpty()) model.addAttribute("results", console.searchShops(currentAdmin(), query))
        return "admin/shops"
    }

    @GetMapping("/admin/shops/{shopId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPPORT')")
    fun shop(
        @PathVariable shopId: UUID,
        model: Model,
    ): String {
        model.addAttribute("detail", console.shop(currentAdmin(), shopId))
        return "admin/shop"
    }

    @GetMapping("/admin/users")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPPORT')")
    fun users(
        @RequestParam(required = false) phone: String?,
        model: Model,
    ): String {
        // The searched number is not echoed back: the page shows masked numbers only.
        val value = phone?.trim().orEmpty()
        if (value.isEmpty()) return "admin/users"
        if (!E164.matches(value)) {
            model.addAttribute("error", "Telefon numarasını +90 ile başlayan, boşluksuz biçimde girin.")
            return "admin/users"
        }
        model.addAttribute("results", console.searchUsers(currentAdmin(), value))
        return "admin/users"
    }

    @GetMapping("/admin/users/{userId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'SUPPORT')")
    fun user(
        @PathVariable userId: UUID,
        model: Model,
    ): String {
        model.addAttribute("detail", console.user(currentAdmin(), userId))
        return "admin/user"
    }

    @PostMapping("/admin/users/{userId}/deactivate")
    @PreAuthorize("hasRole('ADMIN')")
    fun deactivate(
        @PathVariable userId: UUID,
        redirect: RedirectAttributes,
    ): String {
        val revoked = console.deactivateUser(currentAdmin(), userId)
        redirect.addFlashAttribute("notice", "Kullanıcı devre dışı bırakıldı; $revoked oturum kapatıldı.")
        return "redirect:/admin/users/$userId"
    }

    @PostMapping("/admin/users/{userId}/reactivate")
    @PreAuthorize("hasRole('ADMIN')")
    fun reactivate(
        @PathVariable userId: UUID,
        redirect: RedirectAttributes,
    ): String {
        console.reactivateUser(currentAdmin(), userId)
        redirect.addFlashAttribute("notice", "Kullanıcı yeniden etkinleştirildi; uygulamada SMS koduyla tekrar giriş yapabilir.")
        return "redirect:/admin/users/$userId"
    }

    @PostMapping("/admin/users/{userId}/devices/{deviceRowId}/revoke")
    @PreAuthorize("hasRole('ADMIN')")
    fun revokeDevice(
        @PathVariable userId: UUID,
        @PathVariable deviceRowId: UUID,
        redirect: RedirectAttributes,
    ): String {
        val revoked = console.revokeDevice(currentAdmin(), userId, deviceRowId)
        redirect.addFlashAttribute("notice", "Cihazın oturumları kapatıldı ($revoked).")
        return "redirect:/admin/users/$userId"
    }

    companion object {
        private val E164 = Regex("^\\+[1-9][0-9]{7,14}$")
    }
}
