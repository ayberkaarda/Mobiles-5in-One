package app.cetele.server.security

import java.util.UUID

/**
 * The authenticated caller, taken from a verified access token. It is the `principal` of the
 * Spring Security authentication; controllers receive it with `@AuthenticationPrincipal`.
 *
 * It deliberately carries no roles: shop memberships are read from the database on every
 * request, so a removed member loses access immediately.
 */
data class CurrentUser(
    val userId: UUID,
    val deviceId: UUID,
)
