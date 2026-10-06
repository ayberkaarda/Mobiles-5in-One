package app.cetele.archfixtures.account.web

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping

class AccountUnguarded {
    @GetMapping("/fixture")
    fun me() = Unit
}

class AccountGuarded {
    @GetMapping("/fixture")
    @PreAuthorize("isAuthenticated()")
    fun me() = Unit
}
