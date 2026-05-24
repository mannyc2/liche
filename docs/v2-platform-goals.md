# V2 platform goals

V2 is the hosted service and platform layer for liche. It must consume the V1 contracts and artifacts; it must not replace the local package workflow or become necessary for generating, compiling, packaging, publishing, or running a CLI.

## V2 thesis

V1 proves the toolchain:

```txt
Product contract -> generated surfaces -> compiled binary -> release manifest -> package/publish artifacts
```

V2 operates that toolchain at team and company scale:

```txt
release records -> hosted visibility -> policy -> audit -> team workflows
```

The product should feel like an operating layer for CLIs, not a required build server. A user who never adopts the hosted service should still be able to use the V1 packages end to end.

## Goals

### Hosted release control plane

Provide a hosted view over release manifests, package artifacts, provenance, receipts, channels, yanks, and rollback plans.

Required capabilities:

- ingest V1 release manifests and publisher receipts
- show artifact integrity, target coverage, package-manager status, provenance, and attestations
- manage channels, yanked versions, and rollback plans without editing per-ecosystem scripts by hand
- expose release history and audit trails for human review
- keep registry mutation explicit; the hosted service may coordinate publishing, but should not hide package-manager state from operators

V2 is not required to host binaries on day one. GitHub Releases, package managers, and customer-owned storage can remain the artifact origins while the platform owns metadata, policy, and visibility.

### Hosted telemetry and observability

Turn the V1 opt-in telemetry contract into a hosted observability product.

Required capabilities:

- ingest only events allowed by the V1 telemetry schema
- enforce redaction and retention policy at ingestion
- distinguish `cli`, `ci`, `agent`, and `mcp` invocation paths
- show command adoption, failure rates, auth/session failures, install/update issues, agent-readiness failures, and version/channel adoption
- provide export APIs so customers can send events to their own observability stack

Telemetry must remain opt-in. V2 should not make telemetry a hidden requirement for generated CLIs.

### Hosted catalog and discovery

Provide a registry for versioned capability catalogs and generated surfaces.

Required capabilities:

- index V1 capability catalogs, command manifests, MCP tool manifests, docs/reference artifacts, and release metadata
- show which CLI versions expose which capabilities and policies
- expose agent-safe discovery endpoints without revealing secrets, env values, selected local contexts, or local paths
- support private catalogs for teams and public catalogs for developer-facing CLIs

The hosted catalog is discovery and governance infrastructure. The local catalog remains the source of truth for generation.

### Policy, governance, and audit

Add organization-level controls that are impossible or awkward in a local-only package.

Required capabilities:

- team and role model for release and policy operations
- policy defaults for destructive commands, auth requirements, telemetry posture, supported channels, and release approvals
- audit logs for release actions, policy changes, yanks, rollback plans, and hosted catalog changes
- review workflows for high-risk releases and destructive capability exposure

Policy should compile down to V1-readable metadata where possible. Hosted policy must not create a second hidden command contract.

### Team administration and commercial surface

Provide the SaaS shape only after V1 artifacts are stable.

Required capabilities:

- organizations, teams, roles, invitations, and service accounts
- billing and plan limits
- API keys and machine credentials for hosted APIs
- retention controls for telemetry, audit, and release records
- export/delete flows for customer data

These concerns are V2 because they introduce uptime, security, compliance, support, and billing commitments that do not help prove the local toolchain.

## Non-goals

- V2 must not require users to build generated CLIs on liche-hosted infrastructure.
- V2 must not replace package-manager registries as the default distribution path.
- V2 must not make hosted telemetry mandatory.
- V2 must not store local session files, access tokens, refresh tokens, env var values, selected local contexts, or raw authorization headers.
- V2 must not introduce a second schema format that competes with the V1 Product contract, release manifest, or generated catalog.

## Prerequisites from V1

V2 depends on these V1 outputs being stable:

- Product capability catalog with effects, policy, examples, auth requirements, and generated surface membership
- generated CLI/MCP/docs/agent/discovery artifacts with drift checks
- auth/session metadata that is useful without exposing credentials
- telemetry event schema, redaction policy, sink contract, and release-manifest disclosure
- diagnostics output for install, auth, session, update, release, and agent-readiness failures
- release manifest, package artifact records, publisher receipts, provenance, channels, yanks, and rollback plans
- external package-consumer stability for all public packages

If those contracts are not stable, V2 becomes a dashboard over unstable internals. That is the wrong order.

## Suggested phases

### V2A: read-only release visibility

Ingest V1 release manifests and receipts, then show release history, artifact integrity, package-manager status, channels, and yanked versions.

Success criteria:

- no hosted publishing yet
- no hosted telemetry yet
- no org policy enforcement yet
- users can answer what shipped, where it shipped, and whether artifacts still match the recorded hashes

### V2B: hosted telemetry

Ingest V1 telemetry events into a hosted store with strict redaction and retention controls.

Success criteria:

- telemetry is opt-in and schema-validated
- dashboards distinguish human, CI, agent, and MCP usage
- failures link back to command ids, release versions, and diagnostics categories
- customer export is available before broad rollout

### V2C: catalog and policy

Index catalogs and enforce organization policy for releases and generated surfaces.

Success criteria:

- private catalog registry works for teams
- policy changes are audited
- destructive capability exposure and release approvals have review workflows
- hosted policy exports machine-readable metadata that V1 tooling can understand

### V2D: coordinated publishing and rollback

Coordinate package-manager publishing and rollback workflows from hosted release records.

Success criteria:

- registry mutation remains explicit and auditable
- hosted execution re-verifies artifact hashes before mutation
- rollback and yank flows produce receipts
- local V1 publishing remains supported for users who do not adopt the hosted service

### V2E: enterprise administration

Add the commercial and administrative surface.

Success criteria:

- org/team/role model is complete
- billing, retention, export, and deletion policies are documented
- service accounts and API keys are scoped and auditable
- support and compliance posture are explicit
