package app.cetele.archfixtures.media.web

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping

class MediaUnguarded {
    @GetMapping("/fixture")
    fun upload() = Unit
}

class MediaGuarded {
    @GetMapping("/fixture")
    @PreAuthorize("@perm.can(#shopId, 'MEDIA_PRESIGN')")
    fun upload() = Unit
}
