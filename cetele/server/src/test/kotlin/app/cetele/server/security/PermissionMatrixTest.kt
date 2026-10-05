package app.cetele.server.security

import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Table-driven check of every role x action cell. The expected grid is written out by hand
 * (Y = allowed, - = denied) so that a change in [PermissionMatrix] must be mirrored here and in
 * docs/security/authorization-matrix.md.
 */
class PermissionMatrixTest {
    @ParameterizedTest(name = "{0} {1} -> {2}")
    @MethodSource("cells")
    fun `every role x action cell matches the expected grid`(
        role: Role,
        permission: Permission,
        expected: Boolean,
    ) {
        assertEquals(expected, PermissionMatrix.isAllowed(role, permission))
    }

    @Test
    fun `the expected grid covers every role and every action exactly once`() {
        assertEquals(PermissionMatrix.roles.map { it.code }, ROLE_COLUMNS)
        assertEquals(Permission.all.map { it.code }, GRID.map { it.first })
        assertEquals(Permission.all.size, Permission.all.toSet().size)
        GRID.forEach { (_, cells) -> assertEquals(ROLE_COLUMNS.size, cells.length) }
    }

    @Test
    fun `codes round-trip`() {
        Permission.all.forEach { permission ->
            assertEquals(permission, assertNotNull(Permission.fromCode(permission.code)))
        }
        assertEquals(null, Permission.fromCode("LEDGER_DELETE"))
    }

    @Test
    fun `owner holds every action and nobody else holds destructive ones`() {
        assertEquals(Permission.all.toSet(), PermissionMatrix.permissionsOf(ShopRole.OWNER))
        val ownerOnly =
            setOf(
                Permission.ShopManage,
                Permission.MembersManage,
                Permission.CustomerDelete,
                Permission.ExportAll,
                Permission.BillingManage,
            )
        PermissionMatrix.roles.filter { it != ShopRole.OWNER }.forEach { role ->
            assertEquals(emptySet(), PermissionMatrix.permissionsOf(role).intersect(ownerOnly), "role ${role.code}")
        }
    }

    companion object {
        private val ROLE_COLUMNS = listOf("OWNER", "STAFF", "ADMIN", "SUPPORT")

        // Columns: OWNER STAFF ADMIN SUPPORT
        private val GRID =
            listOf(
                "SHOP_READ" to "YYYY",
                "SHOP_MANAGE" to "Y---",
                "MEMBERS_MANAGE" to "Y---",
                "CUSTOMER_READ" to "YY--",
                "CUSTOMER_WRITE" to "YY--",
                "CUSTOMER_DELETE" to "Y---",
                "LEDGER_READ" to "YY--",
                "LEDGER_WRITE" to "YY--",
                "REMINDER_SEND" to "YY--",
                "EXPORT_ALL" to "Y---",
                "STATEMENT_LINK_CREATE" to "YY--",
                "MEDIA_PRESIGN" to "YY--",
                "BILLING_MANAGE" to "Y---",
            )

        private fun roleOf(code: String): Role = PermissionMatrix.roles.single { it.code == code }

        @JvmStatic
        fun cells(): List<Arguments> =
            GRID.flatMap { (action, row) ->
                val permission = requireNotNull(Permission.fromCode(action)) { "unknown action $action" }
                ROLE_COLUMNS.mapIndexed { index, roleCode ->
                    Arguments.of(roleOf(roleCode), permission, row[index] == 'Y')
                }
            }
    }
}
