package app.cetele.server.auth.user

import app.cetele.server.account.AccountService
import app.cetele.server.account.DeletionStatus
import app.cetele.server.auth.UserStore
import app.cetele.server.config.logging.Masking
import app.cetele.server.security.CurrentUser
import app.cetele.server.tenancy.MembershipQuery
import app.cetele.server.tenancy.MembershipSummary
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** The caller's own profile as `GET /v1/me` returns it; the phone is masked. */
data class Me(
    val id: UUID,
    val phone: String,
    val displayName: String?,
    val memberships: List<MembershipSummary>,
    val deletion: DeletionStatus?,
)

@Service
class MeService(
    private val users: UserStore,
    private val memberships: MembershipQuery,
    private val accounts: AccountService,
) {
    @Transactional(readOnly = true)
    fun me(caller: CurrentUser): Me {
        val user = users.findById(caller.userId)?.takeIf { it.active } ?: throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED)
        return Me(user.id, Masking.phone(user.phoneE164), user.displayName, memberships.membershipsOf(user.id), accounts.deletion(user.id))
    }

    @Transactional
    fun rename(
        caller: CurrentUser,
        displayName: String,
    ): Me {
        if (users.updateDisplayName(caller.userId, displayName) == 0) throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED)
        return me(caller)
    }
}
