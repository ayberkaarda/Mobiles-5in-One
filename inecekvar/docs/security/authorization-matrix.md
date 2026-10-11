# Authorization matrix draft

Roles are anonymous, contributor, moderator and admin. All cells are planned and require API enforcement with ownership checks where applicable. Public reads remain available to anonymous callers. Moderator and admin actions must prevent self-approval; destructive moderation and admin operations require the specified step-up and audit controls.

| API resource or action | Anonymous | Contributor | Moderator | Admin |
| --- | --- | --- | --- | --- |
| Public cities, lines, versions, stops, nearby stops and exports | planned | planned | planned | planned |
| Register, login, magic-link, refresh, logout and CSRF | planned | planned | planned | planned |
| Read or update own profile; accept licence; delete own account | planned | planned | planned | planned |
| Download city pack | planned | planned | planned | planned |
| Submit trace; read or delete own trace | planned | planned | planned | planned |
| Read another owner's trace | planned | planned | planned | planned |
| Submit edit or media presign | planned | planned | planned | planned |
| Read own edits | planned | planned | planned | planned |
| Read another author's edit | planned | planned | planned | planned |
| Read moderation queue | planned | planned | planned | planned |
| Approve or reject an edit | planned | planned | planned | planned |
| Roll back a line version or retire a line | planned | planned | planned | planned |
| Read, add or remove own favorites | planned | planned | planned | planned |
| RevenueCat or Resend webhook | planned | planned | planned | planned |
| Admin API | planned | planned | planned | planned |
| Export administrative data | planned | planned | planned | planned |
