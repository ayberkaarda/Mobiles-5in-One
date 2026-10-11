package app.cetele.server.web.site

import app.cetele.server.web.site.seo.SiteFiles
import io.swagger.v3.oas.annotations.Hidden
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import java.time.Duration

/**
 * The public pages and files (ADR-0039). Every path resolves through [SiteRoutes]; an unknown
 * trade or guide slug gets the 404 page. GET only (HEAD follows GET); the site chain answers
 * every other method with 405 before a handler runs. Not part of the API document.
 */
@Hidden
@Controller
class SiteController(
    private val pages: SitePages,
    private val files: SiteFiles,
) {
    @GetMapping(
        "/",
        "/ozellikler",
        "/fiyatlandirma",
        "/rehber",
        "/sss",
        "/hakkinda",
        "/gizlilik",
        "/kvkk-aydinlatma",
        "/hesap-silme",
        "/iletisim",
    )
    fun page(
        request: HttpServletRequest,
        response: HttpServletResponse,
        model: Model,
    ): String = render(request.requestURI.removePrefix(request.contextPath), response, model)

    @GetMapping("/esnaf-icin/{slug}")
    fun trade(
        @PathVariable slug: String,
        response: HttpServletResponse,
        model: Model,
    ): String = render(SiteRoutes.TRADES_PREFIX + slug, response, model)

    @GetMapping("/rehber/{slug}")
    fun guide(
        @PathVariable slug: String,
        response: HttpServletResponse,
        model: Model,
    ): String = render(SiteRoutes.GUIDES_PREFIX + slug, response, model)

    @GetMapping("/sitemap.xml")
    fun sitemap(): ResponseEntity<String> = text(files.sitemap, MediaType("application", "xml", Charsets.UTF_8))

    @GetMapping("/robots.txt")
    fun robots(): ResponseEntity<String> = text(files.robots, PLAIN)

    @GetMapping("/llms.txt")
    fun llms(): ResponseEntity<String> = text(files.llms, PLAIN)

    @GetMapping("/llms-full.txt")
    fun llmsFull(): ResponseEntity<String> = text(files.llmsFull, PLAIN)

    @GetMapping("/.well-known/assetlinks.json")
    fun assetLinks(): ResponseEntity<String> {
        val body = files.assetLinks ?: return ResponseEntity.notFound().cacheControl(CacheControl.noStore()).build()
        return text(body, MediaType.APPLICATION_JSON)
    }

    private fun render(
        path: String,
        response: HttpServletResponse,
        model: Model,
    ): String {
        val route = SiteRoutes.find(path)
        response.contentType = HTML
        if (route == null) {
            response.status = HttpServletResponse.SC_NOT_FOUND
            response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().headerValue)
            response.setHeader(ROBOTS_HEADER, SitePages.NOINDEX)
            model.addAttribute(MODEL, pages.notFound(path))
            return VIEW
        }
        response.setHeader(HttpHeaders.CACHE_CONTROL, PAGE_CACHE.headerValue)
        model.addAttribute(MODEL, pages.view(route))
        return VIEW
    }

    private fun text(
        body: String,
        type: MediaType,
    ): ResponseEntity<String> =
        ResponseEntity
            .ok()
            .contentType(type)
            .cacheControl(FILE_CACHE)
            .body(body)

    companion object {
        const val VIEW = "site/page"
        const val MODEL = "page"
        const val HTML = "text/html; charset=utf-8"
        const val ROBOTS_HEADER = "X-Robots-Tag"
        val PLAIN = MediaType("text", "plain", Charsets.UTF_8)

        /** Pages change only with a deployment: five minutes in any cache, then revalidated by ETag. */
        val PAGE_CACHE: CacheControl = CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic()

        /** Sitemap, robots, llms and asset links: one hour. */
        val FILE_CACHE: CacheControl = CacheControl.maxAge(Duration.ofHours(1)).cachePublic()
    }
}
