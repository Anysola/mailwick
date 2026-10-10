# Security policy

Mailwick handles mail passwords and untrusted HTML, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub's
[private vulnerability reporting](../../security/advisories/new) ("Report a vulnerability" on the Security tab).

Include the affected version or commit, steps to reproduce and the impact you expect. We aim to acknowledge reports within a few days and will credit you in the release notes unless you prefer otherwise.

## Supported versions

Security fixes are made on the latest release.

## Scope notes

- Mail HTML is sanitized and rendered in a sandboxed, script-less iframe. Any way to run script or escape that sandbox is in scope.
- Session passwords are encrypted in Redis with a key derived from `SESSION_SECRET` and the cookie's session ID.
- Deployments must use HTTPS. Running over plain HTTP in production is not supported.
