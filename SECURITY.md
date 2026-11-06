# Security policy

EV Waitlist handles sign-in for administrators, payment provider keys, payment links, and drivers' personal details (names, contact details, plate and permit numbers).

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use the repository's private vulnerability reporting (a GitHub security advisory), if it is enabled. If it is not, contact the maintainer directly and say that you have a security report.

Include what you found, how to reproduce it, and the version or commit you tested. We will acknowledge the report, work on a fix, and agree with you when to publish.

## Supported versions

Only the latest release on the main branch receives fixes.

## Operators

If you run EV Waitlist, see the [operator checklist](docs/operator-checklist.md) for the settings that matter for security: HTTPS, backups of the secrets file, multi-factor sign-in for administrators, and least-privilege roles.
