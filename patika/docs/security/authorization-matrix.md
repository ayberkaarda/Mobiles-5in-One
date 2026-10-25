# Authorization matrix (draft)

This draft maps the roles and endpoint families in the product specification. Every decision is enforced by the server, including ownership and resource state. Anonymous browsing is limited to public records. `Trusted` users are volunteers with at least 25 verified feedings. Moderator and admin routes require TOTP step-up.

Legend: **Allow** = generally permitted; **Own** = only the caller's resource or relationship; **Public** = published/public records only; **Moderate** = moderation permissions; **Admin** = administrator only; **—** = not permitted. Resource-specific authorization and validation still apply.

| Endpoint/action | Guest | User | Trusted | Moderator | Admin |
| --- | --- | --- | --- | --- | --- |
| `POST auth/register`, `login`, `apple`, `refresh`, `logout`, `verify-email`, `forgot`, `reset` | Allow | Allow | Allow | Allow | Allow |
| `GET me`, `PATCH me`, `DELETE me`, `PUT me/device-token`, `PUT me/urgent-settings` | — | Own | Own | Own | Own |
| `GET stations` | Public | Public | Public | Public | Public |
| `POST stations` | — | Allow | Allow | Allow | Allow |
| `GET stations/{id}` | Public | Public | Public | Public | Public |
| `PATCH stations/{id}` | — | Own | Own or any station | Moderate | Admin |
| `POST stations/{id}/feedings`, `needs-refill` | — | Allow | Allow | Allow | Allow |
| `GET animals` | Public | Public | Public | Public | Public |
| `POST animals`, `POST animals/{id}/photos`, `sightings` | — | Allow | Allow | Allow | Allow |
| `GET animals/{id}` | Public | Public | Public | Public | Public |
| `PATCH animals/{id}` | — | Own | Own | Moderate | Admin |
| `PUT|DELETE animals/{id}/follow` | — | Own | Own | Own | Own |
| `GET adoptions` and `GET adoptions/{id}` | Public | Public | Public | Public | Public |
| `POST animals/{id}/adoption` | — | Own animal | Own animal | Moderate | Admin |
| `PATCH adoptions/{id}` (owner close) | — | Own | Own | Moderate | Admin |
| `POST adoptions/{id}/requests` | — | Allow | Allow | Allow | Allow |
| `GET adoptions/{id}/requests` | — | Owner | Owner | Moderate | Admin |
| `PATCH adoptions/{id}/requests/{rid}` | — | Post owner/request owner, permitted fields only | Post owner/request owner, permitted fields only | Moderate | Admin |
| `GET urgent` | Public | Public | Public | Public | Public |
| `POST urgent` | — | Allow | Allow | Allow | Allow |
| `PATCH urgent/{id}` | — | Own, permitted state change | Own, permitted state change | Moderate | Admin |
| `GET care-places` | Public | Public | Public | Public | Public |
| `POST uploads/presign` | — | Allow, quota and ownership checks | Allow, quota and ownership checks | Allow, moderation flow | Allow |
| `POST reports` | — | Allow | Allow | Allow | Allow |
| `POST subscriptions/verify` | — | Own | Own | — | Admin review only |
| `POST webhooks/appstore` | Service signature | Service signature | Service signature | Service signature | Service signature |
| `GET|POST|PATCH admin/**` | — | — | — | Moderate | Admin |

Additional constraints: moderators can review adoption, urgent, photo, and report queues and verify care places; moderators cannot manage user roles, delete users, or read user email addresses. Only admins manage roles, perform care-place imports, and take administrative user actions. A user may only edit owned resources except that `Trusted` users may edit any station under the trusted-station policy. Webhook authorization uses signature and environment validation rather than an interactive role.
