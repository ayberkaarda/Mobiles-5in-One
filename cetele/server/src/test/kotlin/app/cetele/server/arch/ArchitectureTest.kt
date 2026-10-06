package app.cetele.server.arch

import com.tngtech.archunit.base.DescribedPredicate
import com.tngtech.archunit.core.domain.JavaClass
import com.tngtech.archunit.core.domain.JavaClasses
import com.tngtech.archunit.core.domain.JavaMethod
import com.tngtech.archunit.core.domain.JavaMethodCall
import com.tngtech.archunit.core.domain.JavaParameterizedType
import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import com.tngtech.archunit.lang.ArchCondition
import com.tngtech.archunit.lang.ArchRule
import com.tngtech.archunit.lang.ConditionEvents
import com.tngtech.archunit.lang.SimpleConditionEvent
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses
import org.junit.jupiter.api.Test
import org.springframework.data.jpa.repository.Query
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.RequestMapping
import kotlin.reflect.jvm.kotlinFunction
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Architecture rules (spec section 6 items 4 and 15). Each rule runs against the production
 * classes and, to prove it is not vacuous, against fixtures in `app.cetele.archfixtures` with
 * one violating and one compliant example.
 *
 * Tenant types are matched by simple name (`TenantScoped`, `TenantRepository`), so the rules
 * apply as soon as the tenancy module introduces them.
 */
class ArchitectureTest {
    private val production: JavaClasses =
        ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("app.cetele.server")

    private val fixtures: JavaClasses = ClassFileImporter().importPackages("app.cetele.archfixtures")

    @Test
    fun `production classes follow every rule`() {
        CeteleArchitectureRules.all.forEach { it.check(production) }
    }

    @Test
    fun `rule 1 tenant scoped types are only stored through tenant repositories`() {
        assertViolations(
            CeteleArchitectureRules.tenantScopedOnlyThroughTenantRepository,
            flagged = listOf("BadLedgerRepository"),
            accepted = listOf("GoodLedgerRepository", "PlainRepository", "NativeQueries"),
        )
    }

    @Test
    fun `rule 2 tenant repository methods take shopId`() {
        assertViolations(
            CeteleArchitectureRules.tenantRepositoryMethodsTakeShopId,
            flagged = listOf("LeakyLedgerRepository.findByLabel"),
            accepted = listOf("GoodLedgerRepository"),
        )
    }

    @Test
    fun `rule 3 native queries are confined to the allowlist`() {
        assertViolations(
            CeteleArchitectureRules.noNativeQueryCalls,
            flagged = listOf("NativeCaller.count"),
            accepted = listOf("NativeQueries", "SyncNativeCaller", "AccountNativeCaller"),
        )
        assertViolations(
            CeteleArchitectureRules.noNativeQueryAnnotations,
            flagged = listOf("NativeQueries.everything"),
            accepted = listOf("NativeQueries.jpql", "SyncNativeRepository", "AccountNativeRepository"),
        )
    }

    @Test
    fun `rule 4 tenancy handlers carry PreAuthorize`() {
        assertViolations(
            CeteleArchitectureRules.tenancyHandlersArePreAuthorized,
            flagged =
                listOf(
                    "UnguardedController.members",
                    "SyncUnguarded.list",
                    "StatementUnguarded.page",
                    "ReminderUnguarded.send",
                    "MediaUnguarded.upload",
                    "AccountUnguarded.me",
                ),
            accepted =
                listOf(
                    "GuardedController",
                    "SyncGuarded",
                    "StatementGuarded",
                    "ReminderGuarded",
                    "MediaGuarded",
                    "AccountGuarded",
                ),
        )
    }

    @Test
    fun `rule 5 web classes do not use repositories directly`() {
        assertViolations(
            CeteleArchitectureRules.webDoesNotUseRepositories,
            flagged = listOf("LeakyController"),
            accepted = listOf("CleanController"),
        )
    }

    @Test
    fun `rule 6 only config reads the environment`() {
        assertViolations(CeteleArchitectureRules.onlyConfigReadsEnvironment, flagged = listOf("EnvReader."), accepted = listOf("EnvConfig"))
    }

    @Test
    fun `rule 7 plain JDBC is confined to the allowlist`() {
        assertViolations(
            CeteleArchitectureRules.plainJdbcIsConfined,
            flagged = listOf("RawJdbcCaller"),
            accepted = listOf("AccountJdbcCaller"),
        )
    }

    private fun assertViolations(
        rule: ArchRule,
        flagged: List<String>,
        accepted: List<String>,
    ) {
        val result = rule.evaluate(fixtures)
        assertTrue(result.hasViolation(), "rule did not flag the violating fixture: ${rule.description}")
        val details = result.failureReport.details
        flagged.forEach { name -> assertTrue(details.any { it.contains(name) }, "expected a violation for $name in $details") }
        accepted.forEach { name ->
            assertFalse(
                details.any { it.contains("$name.") || it.contains("$name>") || it.contains("$name ") },
                "$name was flagged: $details",
            )
        }
    }
}

/** The rule set run by `check`. Native SQL is restricted to sync and account operations. */
object CeteleArchitectureRules {
    val NATIVE_QUERY_ALLOWED_PACKAGES: Array<String> = arrayOf("..sync..", "..account..")

    /** Packages that may use `JdbcClient` and `JdbcTemplate` (hard delete and retention). */
    val PLAIN_JDBC_ALLOWED_PACKAGES: Array<String> = arrayOf("..account..")

    /**
     * Classes that may use `JdbcClient` and `JdbcTemplate` with bound parameters: the four
     * Phase 1 classes of ADR-0012 and the advisory lock helpers of Phase 2.
     */
    val PLAIN_JDBC_ALLOWED_CLASSES: List<String> =
        listOf(
            "app.cetele.server.auth.AuthLocks",
            "app.cetele.server.auth.UserStore",
            "app.cetele.server.tenancy.UserDirectory",
            "app.cetele.server.config.SecurityConfig",
            "app.cetele.server.config.JobLocks",
            "app.cetele.server.tenancy.ShopLocks",
        )

    private const val TENANT_SCOPED = "TenantScoped"
    private const val TENANT_REPOSITORY = "TenantRepository"
    private const val SPRING_DATA_REPOSITORY = "org.springframework.data.repository.Repository"

    val tenantScopedOnlyThroughTenantRepository: ArchRule =
        classes()
            .that(springDataRepositories)
            .should(onlyManageTenantScopedTypesAsTenantRepository())
            .allowEmptyShould(true)
            .because("tenant rows are read and written only through repositories that require a shopId")

    val tenantRepositoryMethodsTakeShopId: ArchRule =
        methods()
            .that()
            .areDeclaredInClassesThat(tenantRepositories)
            .should(haveParameterNamed("shopId"))
            .allowEmptyShould(true)
            .because("every tenant query is scoped by the caller's shop")

    val noNativeQueryCalls: ArchRule =
        noClasses()
            .that()
            .resideOutsideOfPackages(*NATIVE_QUERY_ALLOWED_PACKAGES)
            .should()
            .callMethodWhere(
                DescribedPredicate.describe("a createNativeQuery method") { call: JavaMethodCall -> call.name == "createNativeQuery" },
            ).because("SQL is written as JPQL or derived queries with bound parameters")

    val noNativeQueryAnnotations: ArchRule =
        methods()
            .that()
            .areDeclaredInClassesThat()
            .resideOutsideOfPackages(*NATIVE_QUERY_ALLOWED_PACKAGES)
            .should(notDeclareNativeQueries())
            .allowEmptyShould(true)
            .because("native SQL is confined to the allowlisted packages")

    val tenancyHandlersArePreAuthorized: ArchRule =
        methods()
            .that()
            .areDeclaredInClassesThat()
            .resideInAnyPackage(
                "..tenancy.web..",
                "..sync.web..",
                "..statements.web..",
                "..reminders.web..",
                "..media.web..",
                "..account.web..",
            ).and()
            .areMetaAnnotatedWith(RequestMapping::class.java)
            .should()
            .beAnnotatedWith(PreAuthorize::class.java)
            .allowEmptyShould(true)
            .because("every tenant endpoint states its permission")

    val webDoesNotUseRepositories: ArchRule =
        noClasses()
            .that()
            .resideInAPackage("..web..")
            .should()
            .dependOnClassesThat(dataAccessTypes)
            .because("controllers call services; services own data access")

    val onlyConfigReadsEnvironment: ArchRule =
        noClasses()
            .that()
            .resideOutsideOfPackage("..config..")
            .should()
            .callMethodWhere(
                DescribedPredicate.describe("System.getenv") { call: JavaMethodCall ->
                    call.targetOwner.isEquivalentTo(System::class.java) && call.name == "getenv"
                },
            ).because("environment values are bound once, in configuration properties")

    val plainJdbcIsConfined: ArchRule =
        noClasses()
            .that()
            .resideOutsideOfPackages(*PLAIN_JDBC_ALLOWED_PACKAGES)
            .and(
                DescribedPredicate.not(
                    DescribedPredicate.describe("are allowlisted JDBC classes") { javaClass: JavaClass ->
                        PLAIN_JDBC_ALLOWED_CLASSES.any { javaClass.name == it || javaClass.name.startsWith("$it$") }
                    },
                ),
            ).should()
            .dependOnClassesThat()
            .resideInAPackage("org.springframework.jdbc.core..")
            .because("plain SQL is reviewed per class; new use outside the allowlist needs a decision")

    val all: List<ArchRule> =
        listOf(
            tenantScopedOnlyThroughTenantRepository,
            tenantRepositoryMethodsTakeShopId,
            noNativeQueryCalls,
            noNativeQueryAnnotations,
            tenancyHandlersArePreAuthorized,
            webDoesNotUseRepositories,
            onlyConfigReadsEnvironment,
            plainJdbcIsConfined,
        )

    private fun hasSupertypeNamed(
        javaClass: JavaClass,
        simpleName: String,
    ): Boolean =
        (javaClass.allRawInterfaces + javaClass.allRawSuperclasses)
            .any { it.simpleName == simpleName && it != javaClass }

    private val springDataRepositories: DescribedPredicate<JavaClass>
        get() =
            DescribedPredicate.describe("are Spring Data repositories") { javaClass: JavaClass ->
                javaClass.isInterface && javaClass.isAssignableTo(SPRING_DATA_REPOSITORY) && javaClass.simpleName != TENANT_REPOSITORY
            }

    private val tenantRepositories: DescribedPredicate<JavaClass>
        get() =
            DescribedPredicate.describe("are tenant repositories") { javaClass: JavaClass ->
                javaClass.simpleName != TENANT_REPOSITORY && hasSupertypeNamed(javaClass, TENANT_REPOSITORY)
            }

    private val dataAccessTypes: DescribedPredicate<JavaClass>
        get() =
            DescribedPredicate.describe("are repositories") { javaClass: JavaClass ->
                javaClass.packageName.split('.').contains("repository") ||
                    javaClass.isAssignableTo(SPRING_DATA_REPOSITORY) ||
                    javaClass.isAnnotatedWith(org.springframework.stereotype.Repository::class.java)
            }

    private fun isTenantScoped(javaClass: JavaClass): Boolean =
        javaClass.simpleName != TENANT_SCOPED && hasSupertypeNamed(javaClass, TENANT_SCOPED)

    private fun onlyManageTenantScopedTypesAsTenantRepository(): ArchCondition<JavaClass> =
        object : ArchCondition<JavaClass>("manage TenantScoped types only as a TenantRepository") {
            override fun check(
                item: JavaClass,
                events: ConditionEvents,
            ) {
                val domainTypes =
                    item.interfaces
                        .filterIsInstance<JavaParameterizedType>()
                        .flatMap { it.actualTypeArguments }
                        .map { it.toErasure() }
                val tenantTypes = domainTypes.filter { isTenantScoped(it) }
                if (tenantTypes.isNotEmpty() && !hasSupertypeNamed(item, TENANT_REPOSITORY)) {
                    val names = tenantTypes.joinToString { it.simpleName }
                    events.add(SimpleConditionEvent.violated(item, "${item.name} manages $names without extending TenantRepository"))
                }
            }
        }

    private fun haveParameterNamed(name: String): ArchCondition<JavaMethod> =
        object : ArchCondition<JavaMethod>("have a parameter named $name") {
            override fun check(
                item: JavaMethod,
                events: ConditionEvents,
            ) {
                if (item.modifiers.contains(com.tngtech.archunit.core.domain.JavaModifier.SYNTHETIC)) return
                val method = item.reflect()
                val names =
                    method.kotlinFunction
                        ?.parameters
                        ?.mapNotNull { it.name }
                        ?: method.parameters.filter { it.isNamePresent }.map { it.name }
                if (name !in names) {
                    events.add(SimpleConditionEvent.violated(item, "${item.fullName} has no parameter named $name"))
                }
            }
        }

    private fun notDeclareNativeQueries(): ArchCondition<JavaMethod> =
        object : ArchCondition<JavaMethod>("not declare native SQL") {
            override fun check(
                item: JavaMethod,
                events: ConditionEvents,
            ) {
                val nativeQuery = item.tryGetAnnotationOfType(Query::class.java).map { it.nativeQuery }.orElse(false)
                val nativeAnnotation = item.annotations.any { it.rawType.simpleName == "NativeQuery" }
                if (nativeQuery || nativeAnnotation) {
                    events.add(SimpleConditionEvent.violated(item, "${item.fullName} declares a native query"))
                }
            }
        }
}
