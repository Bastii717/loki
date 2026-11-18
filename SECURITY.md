# Security policy

Loki is a private, team-internal application behind single sign-on, but it is still exposed to the internet by the teams that run it. Security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead: open the repository's **Security** tab and choose **Report a vulnerability**. That creates a private advisory that only the maintainer can see.

Include what you can: the affected version or image tag, steps to reproduce, and what an attacker could gain. You will get an acknowledgement as soon as the report is read; Loki is maintained by one person, so allow a few days.

## Supported versions

Only the latest release receives fixes. Operators should follow the `latest` image tag or the newest `vX.Y.Z` and update regularly (`docker compose pull && docker compose up -d`).

## What is in scope

- Authentication and authorisation (the OIDC login, group-based roles, the central request guard)
- Access to media (every file is served through the app; the bucket is never public)
- Moderation and admin functions
- The container image, the backup job and the deployment guidance in `docs/deployment.md`

Rate limiting, resource exhaustion and findings that require a compromised identity provider are out of scope.

## Supply chain

Published images are built by GitHub Actions and signed with cosign (keyless, Sigstore). The verification command is in `docs/deployment.md` under "Image signatures". Dependencies are updated weekly by Dependabot, and every push and pull request is scanned for secrets.
