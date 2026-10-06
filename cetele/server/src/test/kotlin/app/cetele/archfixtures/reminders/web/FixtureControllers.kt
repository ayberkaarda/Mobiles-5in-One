package app.cetele.archfixtures.reminders.web

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping

class ReminderUnguarded {
    @GetMapping("/fixture")
    fun send() = Unit
}

class ReminderGuarded {
    @GetMapping("/fixture")
    @PreAuthorize("@perm.can(#shopId, 'REMINDER_SEND')")
    fun send() = Unit
}
