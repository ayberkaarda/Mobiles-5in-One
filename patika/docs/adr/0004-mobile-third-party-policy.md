# ADR-0004: Mobile third-party package policy

- Status: Accepted
- Date: 2026-10-25

## Context

The .NET MAUI Android client handles authentication, volunteer-created content, location, photos, maps, and push notifications. Runtime packages can increase supply-chain, privacy, maintenance, and application-size risks.

## Decision

Keep third-party runtime packages in the MAUI application to a minimum. The initially approved packages are `CommunityToolkit.Mvvm` and `Microsoft.Maui.Controls.Maps`, in addition to the .NET and MAUI platform libraries. Any new third-party runtime package requires a separate ADR before adoption, covering purpose, alternatives, maintenance, license, data access, and update policy. Development-only tools and test dependencies are tracked separately and do not become runtime dependencies.

## Consequences

The app favors platform and framework capabilities and keeps the shipped dependency surface small. Feature teams must justify additional packages and maintain a current dependency inventory. Approved package versions are pinned centrally where supported and checked for vulnerabilities during CI.
