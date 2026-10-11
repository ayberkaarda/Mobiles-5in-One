package app.cetele.server.web.site

import org.springframework.stereotype.Component
import org.thymeleaf.context.ITemplateContext
import org.thymeleaf.dialect.AbstractProcessorDialect
import org.thymeleaf.engine.AttributeName
import org.thymeleaf.model.AttributeValueQuotes
import org.thymeleaf.model.IProcessableElementTag
import org.thymeleaf.processor.IProcessor
import org.thymeleaf.processor.element.AbstractAttributeTagProcessor
import org.thymeleaf.processor.element.IElementTagStructureHandler
import org.thymeleaf.standard.expression.StandardExpressions
import org.thymeleaf.standard.processor.StandardXmlNsTagProcessor
import org.thymeleaf.templatemode.TemplateMode

/**
 * Two attributes for the public site, in place of `th:utext` and inline script blocks (both
 * banned from every template by `TemplateScanTest`):
 *
 * - `site:html="${...}"` writes a [SafeHtml] value as the element body;
 * - `site:jsonld="${...}"` replaces its element with `<script type="application/ld+json">` holding
 *   a [JsonLd] value.
 *
 * Any other value type fails the render, so a plain string can never reach the page unescaped.
 */
@Component
class SiteDialect : AbstractProcessorDialect(NAME, PREFIX, PRECEDENCE) {
    override fun getProcessors(dialectPrefix: String): Set<IProcessor> =
        setOf(HtmlProcessor(dialectPrefix), JsonLdProcessor(dialectPrefix), StandardXmlNsTagProcessor(TemplateMode.HTML, dialectPrefix))

    private class HtmlProcessor(
        prefix: String,
    ) : AbstractAttributeTagProcessor(TemplateMode.HTML, prefix, null, false, "html", true, PRECEDENCE, true) {
        override fun doProcess(
            context: ITemplateContext,
            tag: IProcessableElementTag,
            attributeName: AttributeName,
            attributeValue: String,
            structureHandler: IElementTagStructureHandler,
        ) {
            val value = evaluate(context, attributeValue)
            val html = value as? SafeHtml ?: throw IllegalArgumentException("site:html accepts SafeHtml only")
            structureHandler.setBody(html.value, false)
        }
    }

    private class JsonLdProcessor(
        prefix: String,
    ) : AbstractAttributeTagProcessor(TemplateMode.HTML, prefix, null, false, "jsonld", true, PRECEDENCE, true) {
        override fun doProcess(
            context: ITemplateContext,
            tag: IProcessableElementTag,
            attributeName: AttributeName,
            attributeValue: String,
            structureHandler: IElementTagStructureHandler,
        ) {
            val value = evaluate(context, attributeValue)
            val json = value as? JsonLd ?: throw IllegalArgumentException("site:jsonld accepts JsonLd only")
            val factory = context.modelFactory
            val model = factory.createModel()
            model.add(factory.createOpenElementTag("script", mapOf("type" to "application/ld+json"), AttributeValueQuotes.DOUBLE, false))
            model.add(factory.createText(json.value))
            model.add(factory.createCloseElementTag("script"))
            structureHandler.replaceWith(model, false)
        }
    }

    companion object {
        const val NAME = "Cetele site"
        const val PREFIX = "site"
        const val PRECEDENCE = 1300

        private fun evaluate(
            context: ITemplateContext,
            expression: String,
        ): Any? = StandardExpressions.getExpressionParser(context.configuration).parseExpression(context, expression).execute(context)
    }
}
