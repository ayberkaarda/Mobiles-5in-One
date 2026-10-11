package app.cetele.server.web.site.content

import app.cetele.server.web.site.PageKind
import app.cetele.server.web.site.SiteProperties
import app.cetele.server.web.site.SiteRoute
import app.cetele.server.web.site.SiteRoutes
import org.slf4j.LoggerFactory
import org.springframework.core.io.ResourceLoader
import org.springframework.stereotype.Component
import java.time.LocalDate

/**
 * Every content file named by [SiteRoutes], read and checked once at startup. A missing file, a
 * front matter error, a title over 60 or a description over 155 characters, or an FAQ page
 * without questions stops the application with one message that lists every problem, so a broken
 * page can never be deployed.
 */
@Component
class SiteContent(
    properties: SiteProperties,
    resources: ResourceLoader,
) {
    private val log = LoggerFactory.getLogger(SiteContent::class.java)

    private val pages: Map<String, ContentPage>

    init {
        val problems = mutableListOf<String>()
        val loaded = mutableMapOf<String, ContentPage>()
        SiteRoutes.all.forEach { route ->
            val ref = route.content ?: return@forEach
            val resource = resources.getResource(properties.contentLocation + ref.file)
            if (!resource.exists()) {
                problems += "${ref.file}: missing (route ${route.path})"
                return@forEach
            }
            try {
                val text = resource.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                val page = ContentParser.parse(ref.file, ref.slug, text)
                if (route.kind == PageKind.FAQ && page.faq.isEmpty()) {
                    problems += "${ref.file}: the faq list is empty"
                } else {
                    loaded[route.path] = page
                }
            } catch (exception: ContentException) {
                problems += exception.message.orEmpty()
            }
        }
        check(problems.isEmpty()) {
            "Site content at ${properties.contentLocation} is incomplete:\n" + problems.joinToString("\n")
        }
        pages = loaded
        log.info("Site content outcome=loaded pages={} location={}", pages.size, properties.contentLocation)
    }

    /** The content of [route]; every route with a content reference has one after startup. */
    fun of(route: SiteRoute): ContentPage = pages.getValue(route.path)

    fun of(path: String): ContentPage = pages.getValue(path)

    fun all(): Map<String, ContentPage> = pages

    /** The date a route last changed: its file's `updated`, or for the guide index the newest guide. */
    fun lastModified(route: SiteRoute): LocalDate =
        if (route.content != null) {
            of(route).updated
        } else {
            SiteRoutes.guides.maxOf { of(it).updated }
        }
}
