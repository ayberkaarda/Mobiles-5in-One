# Handoff web → teams 001

- From: `apps/web` uploads endpoints (ADR-0030)
- To: owners of `apps/web/lib/server/teams`, `lib/server/auth/profile.ts`, `lib/server/calls` and
  `lib/server/matches` projections
- Status: open

## Real `badgeUrl` / `avatarUrl`

Every image URL in API responses is still `null`. The shared helper now exists:
`apps/web/lib/server/uploads/urls.ts`

```ts
mediaUrl(baseUrl: string | undefined, key: string | null): string | null
mediaUrlBuilder(env: Pick<WebEnv, 'MEDIA_PUBLIC_BASE_URL'>): (key: string | null) => string | null
```

It joins `MEDIA_PUBLIC_BASE_URL` (new optional web key, required outside local) with a stored key
and returns `null` for no key, no configured base URL, or any value the upload worker never writes
(only `avatars/{uuid}/{uuid}.webp` and `badges/{uuid}/{uuid}.webp` are accepted).

Call sites to switch (none were edited by the uploads change):

| File                                                                      | Today                               | Change                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `lib/server/teams/projections.ts` `publicMediaUrl()`                      | returns `null`                      | delegate to `mediaUrl(runtime.env.MEDIA_PUBLIC_BASE_URL, key)`; the function needs the env (or a builder) passed in |
| `lib/server/teams/projections.ts` lines building `badgeUrl` / `avatarUrl` | `publicMediaUrl(row.…Key)`          | unchanged once the helper above is wired                                                                            |
| `lib/server/teams/invites.ts` (`badgeUrl`)                                | imports `publicMediaUrl`            | same                                                                                                                |
| `lib/server/calls/projections.ts` (`avatarUrl`)                           | imports `publicMediaUrl` from teams | same                                                                                                                |
| `lib/server/matches/projections.ts` (`avatarUrl`, tombstones stay `null`) | imports `publicMediaUrl` from teams | same                                                                                                                |
| `lib/server/auth/profile.ts` `toMeResponse()`                             | `avatarUrl: null`                   | `mediaUrl(env.MEDIA_PUBLIC_BASE_URL, user.avatarKey)`; `toMeResponse` is also used by sign-in responses             |

`GET uploads/:id` already returns the public URL of a `ready` upload through the same helper, so
both paths agree on the format.
