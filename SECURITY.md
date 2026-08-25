# Security policy

## Supported versions

Security fixes are provided for the latest released version.

## Reporting a vulnerability

Use GitHub Private Vulnerability Reporting from the repository Security tab. If it is unavailable, contact the maintainer privately through the address on the repository profile.

Include the affected version, impact, reproduction steps using synthetic data, and any suggested mitigation. Reports should not contain credentials, secrets, production Registry exports, or sensitive generated files.

## Product boundary

Endpoint Registry Studio processes Workspace and Registry data in the browser. Operators must protect the hosting origin and review generated PowerShell before deployment. See [Security and privacy architecture](docs/SECURITY.md) for details.
