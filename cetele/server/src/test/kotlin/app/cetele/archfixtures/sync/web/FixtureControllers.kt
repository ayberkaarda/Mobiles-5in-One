package app.cetele.archfixtures.sync.web

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping

class SyncUnguarded {
    @GetMapping("/fixture")
    fun list() = Unit
}

class SyncGuarded {
    @GetMapping("/fixture")
    @PreAuthorize("@perm.can(#shopId, 'SHOP_READ')")
    fun list() = Unit
}
