package app.cetele.server.security

/**
 * Every action the server authorizes. The [code] is the stable name used in
 * `docs/security/authorization-matrix.md` and in `@PreAuthorize` expressions.
 */
sealed class Permission(
    val code: String,
) {
    data object ShopRead : Permission("SHOP_READ")

    data object ShopManage : Permission("SHOP_MANAGE")

    data object MembersManage : Permission("MEMBERS_MANAGE")

    data object CustomerRead : Permission("CUSTOMER_READ")

    data object CustomerWrite : Permission("CUSTOMER_WRITE")

    data object CustomerDelete : Permission("CUSTOMER_DELETE")

    data object LedgerRead : Permission("LEDGER_READ")

    data object LedgerWrite : Permission("LEDGER_WRITE")

    data object ReminderSend : Permission("REMINDER_SEND")

    data object ExportAll : Permission("EXPORT_ALL")

    data object StatementLinkCreate : Permission("STATEMENT_LINK_CREATE")

    data object MediaPresign : Permission("MEDIA_PRESIGN")

    data object BillingManage : Permission("BILLING_MANAGE")

    companion object {
        // Lazy, so that touching a single permission object first never sees a half-initialised list.
        val all: List<Permission> by lazy {
            listOf(
                ShopRead,
                ShopManage,
                MembersManage,
                CustomerRead,
                CustomerWrite,
                CustomerDelete,
                LedgerRead,
                LedgerWrite,
                ReminderSend,
                ExportAll,
                StatementLinkCreate,
                MediaPresign,
                BillingManage,
            )
        }

        fun fromCode(code: String): Permission? = all.firstOrNull { it.code == code }
    }
}

/** A role that can be granted permissions: a shop membership role or a platform admin role. */
sealed interface Role {
    val code: String
}

/** Role inside one shop, stored in `memberships.role`. */
enum class ShopRole : Role {
    OWNER,
    STAFF,
    ;

    override val code: String get() = name
}

/** Platform operator role, stored in `admin_users.role` (separate from shop users). */
enum class PlatformRole : Role {
    ADMIN,
    SUPPORT,
    ;

    override val code: String get() = name
}
