package app.cetele.android.quality

import io.gitlab.arturbosch.detekt.api.CodeSmell
import io.gitlab.arturbosch.detekt.api.Config
import io.gitlab.arturbosch.detekt.api.Debt
import io.gitlab.arturbosch.detekt.api.Entity
import io.gitlab.arturbosch.detekt.api.Issue
import io.gitlab.arturbosch.detekt.api.Rule
import io.gitlab.arturbosch.detekt.api.RuleSet
import io.gitlab.arturbosch.detekt.api.RuleSetProvider
import io.gitlab.arturbosch.detekt.api.Severity
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtParameter
import org.jetbrains.kotlin.psi.KtProperty

class MoneyRuleSetProvider : RuleSetProvider {
    override val ruleSetId = "cetele"

    override fun instance(config: Config): RuleSet = RuleSet(ruleSetId, listOf(MonetaryDouble(config)))
}

class MonetaryDouble(
    config: Config = Config.empty,
) : Rule(config) {
    override val issue =
        Issue(
            "MonetaryDouble",
            Severity.Defect,
            "Monetary values must use integral minor units.",
            Debt.FIVE_MINS,
        )

    override fun visitProperty(property: KtProperty) {
        super.visitProperty(property)
        checkType(property, property.typeReference?.text, property.initializer?.text)
    }

    override fun visitParameter(parameter: KtParameter) {
        super.visitParameter(parameter)
        checkType(parameter, parameter.typeReference?.text, parameter.defaultValue?.text)
    }

    override fun visitNamedFunction(function: KtNamedFunction) {
        super.visitNamedFunction(function)
        checkType(function, function.typeReference?.text, null)
    }

    private fun checkType(
        declaration: KtNamedDeclaration,
        type: String?,
        initializer: String?,
    ) {
        val name = declaration.name ?: return
        if (!MONETARY_NAME.containsMatchIn(name)) return
        val usesDouble =
            type?.contains("Double") == true || type?.contains("Float") == true ||
                (type == null && initializer?.matches(FLOATING_LITERAL) == true)
        if (usesDouble) report(CodeSmell(issue, Entity.from(declaration), "Use Long minor units for $name."))
    }

    private companion object {
        val MONETARY_NAME = Regex("amount|balance|money|minor|receivable|debt|payment", RegexOption.IGNORE_CASE)
        val FLOATING_LITERAL = Regex("[+-]?[0-9][0-9_]*(\\.[0-9_]+([eE][+-]?[0-9]+)?|[eE][+-]?[0-9]+)[fF]?")
    }
}
