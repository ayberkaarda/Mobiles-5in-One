package app.cetele.server.admin.web

import app.cetele.server.admin.AdminConflictException
import app.cetele.server.admin.AdminManagementService
import app.cetele.server.admin.AdminRole
import app.cetele.server.admin.audit.AuditLogService
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.servlet.mvc.support.RedirectAttributes
import java.util.UUID

/** The audit log and the management of `admin_users`: `ADMIN` only (D-9). */
@Controller
class AdminManagementController(
    private val management: AdminManagementService,
    private val audit: AuditLogService,
) {
    @GetMapping("/admin/audit")
    @PreAuthorize("hasRole('ADMIN')")
    fun auditLog(
        @RequestParam(defaultValue = "0") page: Int,
        model: Model,
    ): String {
        model.addAttribute("audit", audit.view(currentAdmin().id, page))
        return "admin/audit"
    }

    @GetMapping("/admin/admins")
    @PreAuthorize("hasRole('ADMIN')")
    fun admins(model: Model): String {
        model.addAttribute("admins", management.list())
        model.addAttribute("roles", AdminRole.entries.map { it.name })
        return "admin/admins"
    }

    @GetMapping("/admin/admins/new")
    @PreAuthorize("hasRole('ADMIN')")
    fun newAdminForm(model: Model): String {
        model.addAttribute("roles", AdminRole.entries.map { it.name })
        return "admin/admin-new"
    }

    /** Shows the one-time password once, in this response only (never stored, never redirected). */
    @PostMapping("/admin/admins/new")
    @PreAuthorize("hasRole('ADMIN')")
    fun createAdmin(
        @RequestParam(defaultValue = "") email: String,
        @RequestParam(defaultValue = "") role: String,
        model: Model,
    ): String {
        model.addAttribute("created", management.create(currentAdmin(), email.take(MAX_EMAIL), role(role)))
        return "admin/admin-created"
    }

    @PostMapping("/admin/admins/{adminId}/role")
    @PreAuthorize("hasRole('ADMIN')")
    fun changeRole(
        @PathVariable adminId: UUID,
        @RequestParam(defaultValue = "") role: String,
        redirect: RedirectAttributes,
    ): String {
        management.changeRole(currentAdmin(), adminId, role(role))
        redirect.addFlashAttribute("notice", "Rol güncellendi.")
        return "redirect:/admin/admins"
    }

    @PostMapping("/admin/admins/{adminId}/disable")
    @PreAuthorize("hasRole('ADMIN')")
    fun disable(
        @PathVariable adminId: UUID,
        redirect: RedirectAttributes,
    ): String {
        management.disable(currentAdmin(), adminId)
        redirect.addFlashAttribute("notice", "Yönetici hesabı devre dışı bırakıldı.")
        return "redirect:/admin/admins"
    }

    @PostMapping("/admin/admins/{adminId}/enable")
    @PreAuthorize("hasRole('ADMIN')")
    fun enable(
        @PathVariable adminId: UUID,
        redirect: RedirectAttributes,
    ): String {
        management.enable(currentAdmin(), adminId)
        redirect.addFlashAttribute("notice", "Yönetici hesabı etkinleştirildi.")
        return "redirect:/admin/admins"
    }

    @PostMapping("/admin/admins/{adminId}/totp-reset")
    @PreAuthorize("hasRole('ADMIN')")
    fun resetTotp(
        @PathVariable adminId: UUID,
        redirect: RedirectAttributes,
    ): String {
        management.resetTotp(currentAdmin(), adminId)
        redirect.addFlashAttribute("notice", "Doğrulama uygulaması sıfırlandı; yönetici bir sonraki girişte yeniden kurar.")
        return "redirect:/admin/admins"
    }

    private fun role(value: String): AdminRole =
        AdminRole.entries.firstOrNull { it.name == value } ?: throw AdminConflictException("Geçerli bir rol seçin.")

    companion object {
        private const val MAX_EMAIL = 320
    }
}
