# OrionDesk single sign-on: product requirements

Status: Draft for product, engineering, security, and design review  
Owner: Product  
Last updated: 2026-10-09

## Problem

OrionDesk tenants authenticate with passwords or emailed magic links today; no SSO capability has shipped. Large prospective tenants need centralized authentication, but OrionDesk must add it without weakening tenant isolation or workspace-level authorization. Aspen Labs has asked for SAML 2.0 with Okta for its pilot, while another prospect can use OIDC with Entra ID. No contract or launch date is committed. [Product overview](docs/product.md) · [SSO-14](collab://jira/SSO-14) · [Current authentication architecture](collab://docs/auth-architecture)

The load-bearing product decision is still open: whether the first release supports SAML, OIDC, or both. Security proposes OIDC authorization code flow with PKCE first, but that does not meet the recorded Aspen requirement. This PRD defines protocol-neutral outcomes and marks protocol-specific delivery as blocked until Product, Security, and Engineering decide the first-release protocol after reviewing the Aspen addendum. [Identity protocol review](collab://docs/identity-review) · [SSO-14](collab://jira/SSO-14)

The spring roadmap is historical, not current authority. Its proposed email-only account linking conflicts with the mandatory security baseline and must not be implemented. [Historical spring roadmap](docs/old-roadmap.md) · [Security baseline](docs/security-baseline.md)

## Outcome and how we would know

| Outcome | Measure | Observable with | Baseline |
|---|---|---|---|
| A tenant admin can configure and validate a supported identity provider before affecting members. | A valid configuration passes a test login; invalid issuer, audience, signature, expiry, redirect URI, or replay checks fail without enabling enforcement. | Integration tests and admin acceptance test using the selected protocol and supported IdP. | No SSO is shipped. |
| Eligible members can authenticate through their tenant's identity provider without crossing tenant boundaries or changing workspace authorization. | Successful sign-in resolves one verified federated identity to one stable OrionDesk user and an explicit membership in the requested tenant; negative tests cannot authenticate a user into another tenant. | End-to-end tests covering one user in multiple workspaces, changed email, removed membership, and issuer/subject collisions. | Password and magic-link authentication only; memberships and roles are tenant-scoped. |
| An admin can enforce SSO without locking out the final tenant owner. | Enforcement cannot activate until a tested, audited break-glass owner path exists; the final owner can recover access in a test exercise. | Enforcement preflight and recovery drill. | No enforced SSO exists. |
| Removing access has defined session behavior. | Disabling or removing a workspace member prevents new sign-in and revokes that member's active sessions for that workspace. | Session inventory and removal acceptance test. | Existing sessions may remain valid for up to 24 hours. |
| Users and operators can recover from identity-provider and configuration failures safely. | The UI shows actionable, non-sensitive errors; operators can distinguish configured failure classes; rollback restores the preceding configuration. | Failure-injection tests, audit review, and configuration rollback exercise. | No SSO operating path or support SLO is assigned. |

## Scope

**In:**

- Tenant-level SSO configuration, validation, activation, enforcement, rollback, and signing-key rotation for the protocol or protocols selected for the first release.
- IdP-initiated flows only if the selected protocol and approved threat model require them; service-provider-initiated login is required.
- Stable identity binding using `tenant_id + issuer + subject`, mapped to the existing user UUID; workspace membership and role remain separately authoritative.
- Safe migration for existing members, including explicit identity verification and membership checks. Email alone is never sufficient to link an account.
- Tenant discovery and login experiences for people who belong to one or several workspaces.
- Explicit treatment of owners, admins, members, and guests, with guest enforcement held behind the open product decision below.
- Session revocation on member removal or disablement, IdP outage behavior, tested break-glass owner access, audit events, monitoring, and support diagnostics.
- Minimal identity claims, documented storage, retention, and access, plus a login path targeting WCAG 2.2 AA.
- Web login and the existing short-lived handoff-code path used by mobile clients.

**Out (deliberately):**

- SCIM or other lifecycle provisioning, because the current operations record identifies it as a separate scope decision.
- Automatic domain-wide enrollment, because domain verification does not prove individual identity or membership.
- Changes to workspace roles or authorization, because SSO authenticates identity while existing tenant membership remains authoritative.
- A pricing or packaging commitment, because enterprise entitlement is proposed but not approved.
- A launch-date commitment, because none is recorded and protocol scope is unresolved.
- Certified accessibility or regulatory compliance claims; the current evidence establishes internal targets and review needs, not certification.

**Non-goals:**

- Reusing the abandoned spring SAML prototype; it never shipped and is not the current architecture.
- Linking accounts by matching email addresses; email can change and the security baseline forbids email-only linking.
- A universal authentication bypass; break-glass access is limited to tested owner recovery and every use is audited.
- Treating SSO authentication as authorization to any workspace; explicit tenant membership is always required.

## Requirements

Priority labels mean: **critical path** is required for any safe release; **now** is required for general availability of the selected first-release protocol; **next** follows that release; **later** is intentionally deferred.

1. **[Critical path] Protocol decision.** Product, Security, and Engineering must record whether the first release supports SAML, OIDC, or both before protocol-specific implementation is accepted. The decision must account for Aspen's SAML requirement, the OIDC security proposal, delivery cost, and whether managed federation is preferable to direct implementation. **Acceptance:** a dated decision names the selected scope, decision owners, rejected alternative, and effect on the pilot.
2. **[Critical path] Tenant isolation and authorization.** Authentication must resolve within the requested tenant and must not grant or alter membership or role. **Acceptance:** automated negative tests show that a valid identity from one tenant, issuer, or subject cannot access another tenant without an explicit membership there.
3. **[Critical path] Stable identity binding.** Federated identities must bind by tenant, verified issuer, and immutable subject to the existing user UUID. Email may be displayed or used during an explicitly verified migration but cannot be the linking key. **Acceptance:** changed-email and duplicate-email tests retain the correct identity binding, while an unbound identity cannot take over an existing account by matching its email.
4. **[Critical path] Protocol security.** The selected flow must validate every security property required by its approved threat model. For OIDC, this includes authorization code flow with PKCE, exact redirect URI matching, issuer, audience, signature and expiry checks, plus replay protection. **Acceptance:** one automated negative test per validation rejects the transaction and produces no session.
5. **[Critical path] Safe enforcement.** An admin can enforce SSO only after a successful test connection and recovery preflight. The system must not allow enforcement to strand the final tenant owner. **Acceptance:** attempts to enable enforcement without a successful test or working owner recovery are blocked; a recovery drill restores owner access and creates an audit event.
6. **[Critical path] Deprovisioning and sessions.** Removing or disabling a membership must prevent new sign-ins and revoke that member's active OrionDesk sessions for the affected workspace. **Acceptance:** after the membership change, existing web sessions and mobile handoff-derived sessions cannot perform an authenticated workspace action; sessions for other valid workspaces are unaffected.
7. **[Now] Configuration lifecycle.** Authorized tenant admins can create, test, activate, version, roll back, disable, and rotate keys or certificates for an IdP configuration. Secrets and tokens must not appear in URLs or audit events. **Acceptance:** an admin can restore the immediately preceding working configuration in a test, and audit inspection finds metadata and actor information but no secret or token values.
8. **[Now] Login and tenant discovery.** The login experience must route a person to the correct tenant authentication method, including a person who belongs to several workspaces, without disclosing membership to an unauthenticated requester. **Acceptance:** end-to-end tests cover one and multiple memberships, unknown tenant, enforced and non-enforced tenant, and do not reveal whether an entered person belongs to a tenant.
9. **[Now] Failure and outage behavior.** The product must define behavior for unreachable IdP, invalid response, expired or rotated keys, configuration error, replay, and OrionDesk dependency failure. User messages must be actionable without exposing sensitive details; operator diagnostics must distinguish these classes. **Acceptance:** failure-injection tests produce the documented user message, operator reason, and audit result for each class.
10. **[Now] Auditability.** Configuration changes, test results, enforcement changes, federated identity link and unlink events, authentication outcomes, session revocations, rollback, and break-glass use must be auditable with tenant, actor, timestamp, event type, and outcome. **Acceptance:** the audit test suite emits every named event and confirms that no credential, assertion, authorization code, access token, refresh token, or signing secret is present.
11. **[Now] Privacy.** The implementation must request and store only approved identity claims and document their purpose, retention, access, and deletion behavior. **Acceptance:** Security and Privacy review a claim inventory and data-flow record; tests show unapproved claims are discarded rather than persisted.
12. **[Now] Accessible authentication.** OrionDesk-owned login, tenant discovery, configuration, error, and recovery screens must target WCAG 2.2 AA, including keyboard use, visible focus, error recovery, and password-manager and paste compatibility for fallback paths. The handoff to the IdP must preserve understandable context. **Acceptance:** an accessibility review exercises each OrionDesk-owned path with keyboard-only navigation and automated checks, and records any IdP-owned limitations separately.
13. **[Now] Mobile continuity.** Mobile clients must continue using short-lived handoff codes and must not receive SSO assertions or long-lived IdP tokens through URLs. **Acceptance:** a mobile end-to-end test completes sign-in through the web-owned session exchange and log inspection finds no SSO assertion or token in application URLs.
14. **[Next] Guest policy.** Apply the product-approved guest authentication policy without assuming a guest uses the tenant's IdP. **Acceptance:** tests cover an internal member and a guest with a different IdP under enforced SSO and match the recorded policy decision.
15. **[Later] Lifecycle provisioning.** Evaluate SCIM separately after authentication scope is stable. **Acceptance:** none for this release; no SCIM behavior is implied by SSO availability.

## Priority evidence

- Large prospective tenants are asking for centralized authentication; Aspen's pilot specifically calls for SAML 2.0 with Okta, and another prospect can use OIDC with Entra ID. [SSO-14](collab://jira/SSO-14)
- The current architecture has no shipped SSO, uses stable internal UUIDs and tenant-scoped memberships, and warns that email is not a stable federated identity key. [Current authentication architecture](collab://docs/auth-architecture)
- Security requires tenant isolation, verified identity and membership, safe owner recovery, and exclusion of secrets and tokens from URLs and audit events. [Security baseline](docs/security-baseline.md)
- Member removal does not revoke current sessions; they may survive for up to 24 hours. This gap must be fixed or explicitly accepted before enforced SSO ships. [Sessions and operations](collab://docs/sessions) · [Session correction](collab://slack/identity/340)
- Identity privacy, contract jurisdiction, and data-region terms cannot be closed from current access because the Aspen addendum is inaccessible. [Identity privacy questions](collab://docs/privacy)

## Assumptions and how they would be tested

- **[Assumed]** Tenant admins, rather than OrionDesk support, should own routine IdP configuration. **Test:** Product interviews pilot administrators and Support reviews the proposed permission and escalation model before implementation sign-off. If wrong, configuration roles and operating procedures must change.
- **[Assumed]** Service-provider-initiated login is sufficient as the required entry path; IdP-initiated behavior depends on the selected protocol and pilot need. **Test:** confirm against the accessible pilot requirements and threat model before protocol design is approved. If wrong, login routing and replay protections expand.
- **[Assumed]** Immediate workspace-scoped session revocation is technically feasible without ending the user's sessions in other workspaces. **Test:** Engineering proves the behavior against the current session model before committing the release plan. If wrong, session architecture becomes critical-path work.
- **[Assumed]** Existing mobile handoff codes can remain the mobile boundary for SSO. **Test:** Security reviews a mobile sequence diagram and Engineering runs an end-to-end prototype. If wrong, mobile scope and token handling require redesign.
- **[Assumed]** A managed federation service may reduce protocol and key-management risk. **Test:** Engineering and Security compare managed federation with direct implementation before the protocol decision. If wrong, direct implementation must fund equivalent validation, rotation, observability, and incident response.

## Open questions (earned)

- **Which protocol or protocols ship first?** Product, Security, and Engineering decide. It blocks protocol-specific design, estimates, and the Aspen pilot fit because current sources support different priorities.
- **What does the Aspen addendum require for protocol, data region, jurisdiction, security, and timing?** The commercial owner and Legal answer from the inaccessible contract. It blocks contractual and privacy sign-off; no term should be inferred from the prospect's name.
- **Are guests subject to tenant-enforced SSO, exempt, or configurable?** Product and Security decide with pilot admins. It blocks final guest acceptance tests because contractors may use a different IdP.
- **Is SCIM part of the same commercial release or a separate follow-on?** Product decides with Sales and Engineering. It does not block authentication MVP but blocks packaging and lifecycle claims.
- **Who owns SSO support and what escalation SLO applies?** Support and Engineering leadership decide before general availability. It blocks operational readiness, not the configuration prototype.
- **What entitlement and packaging apply?** Product and Commercial leadership decide. It blocks billing and launch messaging, not technical validation.

## Decision

Product owns the problem, release scope, guest policy, packaging, and success measures. Security must approve the protocol threat model, identity linking, recovery, privacy controls, and release security evidence. Engineering owns the architecture and must prove session revocation, tenant isolation, migration, rollback, mobile handoff, and failure behavior. Design owns the OrionDesk login, configuration, recovery, and accessibility experience. Support must accept the runbook and escalation model before general availability. Legal and the commercial owner must review the Aspen addendum and any privacy or data-region obligations.

Recommended decision: accept this PRD as the protocol-neutral product contract, then make the first-release protocol decision before committing implementation scope or a pilot date. The strongest failure mode is choosing OIDC-only because it is the current security preference and discovering that the named pilot contract requires SAML; the best alternative is a managed federation layer that can satisfy the chosen protocols while keeping identity binding and tenant enforcement consistent. **Disposition: needs validation** against the Aspen addendum and a managed-versus-direct technical assessment.
