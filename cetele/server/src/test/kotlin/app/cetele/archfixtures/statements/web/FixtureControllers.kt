package app.cetele.archfixtures.statements.web

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping

class StatementUnguarded {
    @GetMapping("/fixture")
    fun page() = Unit
}

class StatementGuarded {
    @GetMapping("/fixture")
    @PreAuthorize("permitAll()")
    fun page() = Unit
}
