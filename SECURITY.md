# Security Policy

## Supported Versions

Liche has not published a public stable release yet. Before the first public v1 release, security fixes apply to the current default branch and the release-candidate branch being prepared.

After v1 is published, supported versions are:

| Version line | Status |
|---|---|
| `0.2.x` pre-v1 packages | Development support only |
| `1.x` | Supported after first v1 release |

## Reporting a Vulnerability

Report suspected vulnerabilities privately to the repository maintainers through the project's private repository security channel. Do not open a public issue for a live exploit, credential leak, package compromise, or supply-chain finding.

Every report should include:

- affected package or generated artifact
- impacted version or commit
- reproduction steps
- whether secrets, release artifacts, package credentials, or generated manifests are involved

Maintainers should acknowledge a valid report within two business days, preserve logs and artifacts needed for investigation, and coordinate disclosure after a fix or mitigation is available.

## Release Security Requirements

Before a public release:

- `bun run release:check` must pass.
- `bun run --silent release:names` must be run near publication time.
- package artifacts must be produced from verified final binaries.
- release manifests and package records must include sha256 and size for binaries and package artifacts.
- registry publishing must use trusted publishing/OIDC when configured, or explicit short-lived release credentials when OIDC is unavailable.
- package metadata must not contain placeholder repository, homepage, funding, or support URLs.
