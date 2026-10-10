# LatticeDesk single sign-on

Status: Draft  
Author: Product  
Contributors: Engineering, Security engineering, Support, Legal/Commercial  
Created: 2026-10-09  
Last updated: 2026-10-09  
Tags: authentication, enterprise, security, tenant administration

## Outcome

Eligible LatticeDesk workspaces can configure, test, enable, and safely enforce federated sign-in without weakening tenant isolation or locking out the last owner. Members reach the correct workspace through their organization's identity provider, while guests and recovery users follow an explicit policy. The first launch protocol remains a decision gate: commercial discovery requires SAML 2.0 with Okta, while Security proposes OIDC authorization code flow with PKCE first.

## Users

- Workspace owners and admins configure and operate SSO for a tenant.
- Members authenticate through their organization's identity provider.
- Guests may use a different identity provider and need an explicit, understandable sign-in path.
- Support and security responders diagnose failures and recovery events without receiving secrets or tokens.
- Commercial and legal owners determine entitlement and contract-specific obligations before customer commitment.

## Context

LatticeDesk is a multi-tenant collaboration product. A person may belong to several workspaces, each with an independent membership and role. The current product supports passwords and emailed magic links only; there is no shipped SSO. Users have stable internal UUIDs, while email addresses can change and are not valid federated identity keys.

The historical Spring roadmap is superseded for current implementation and scope. Its proposed SAML launch and email-based account linking did not ship; the prototype was abandoned. Current product, architecture, and security sources govern this PRD.

Demand is confirmed but protocol scope is not. Cedar Labs requests SAML 2.0 with Okta for a pilot, and another prospect supports OIDC with Entra ID. No contract or launch date is committed. The Cedar commercial addendum was inaccessible during drafting, so jurisdiction, data-region, and controller/processor terms are not inferred here.

## Decided

- Security engineering: tenant isolation is non-negotiable.
- Security engineering: linking an existing account by email alone is forbidden; identity and explicit tenant membership must both be verified.
- Security engineering: domain verification does not prove control of an individual mailbox.
- Security engineering: enforced SSO must not strand the final workspace owner.
- Security engineering: secrets and tokens must not appear in URLs or audit events.
- Current architecture: workspace membership and role remain the authorization source; identity-provider claims do not grant a LatticeDesk role by themselves.
- Current architecture: the abandoned SAML prototype and sales mockups are not shipped behavior and must not be reused as evidence of readiness.
- Product accessibility target: the login path, including the LatticeDesk portion of the identity-provider handoff, targets WCAG 2.2 AA. This is a product target, not a certified conformance claim.

## Outcomes

- A workspace admin can configure a tenant-specific identity-provider connection, validate it without affecting active users, and review actionable results before enabling it.
- An invited member with a valid tenant membership can authenticate through the configured provider and enter only that tenant with the existing LatticeDesk role.
- A person who belongs to several workspaces is routed and authorized independently for each workspace.
- Existing accounts are linked only after a verified federated identity is bound to an explicit tenant membership; an email match alone never links accounts.
- An admin can move from optional SSO to enforced SSO through a guarded operation that proves recovery access and protects the final owner.
- Removing or disabling a tenant membership prevents new access and follows an explicit, tested policy for active-session revocation.
- Users and operators receive useful failure categories without exposure of identity claims, secrets, authorization codes, or tokens.
- The sign-in and recovery paths remain usable with keyboard navigation, visible focus, error recovery, and accessible tenant discovery.

## Success measures

Launch measurement thresholds are not yet authorized and must be chosen by Product, Security, and Support before general availability. The launch dashboard must at least distinguish:

- Successful SSO sign-ins from attempted SSO sign-ins, segmented by tenant and provider type without exposing identity claims.
- Configuration tests that pass or fail, with failures grouped into operator-actionable categories.
- Account-linking attempts rejected because identity or tenant membership could not be verified.
- Enforcement attempts blocked by the final-owner or missing-recovery guard.
- Active sessions revoked after membership disablement, measured against the approved revocation policy.
- Break-glass uses, each with an audit record and follow-up review status.
- Support contacts caused by tenant discovery, provider outage, linking, enforcement, or recovery.
- Accessibility defects found in the LatticeDesk login, error, and recovery surfaces.

## Constraints

- Tenant boundaries must be enforced at configuration, callback handling, identity mapping, session creation, and authorization.
- Federated identity must use a stable provider identifier, not email. The proposed key is tenant ID plus issuer plus subject, mapped to the existing user UUID; migration review must approve the final schema.
- OIDC, if selected, must use authorization code flow with PKCE and validate the exact redirect URI, issuer, audience, signature, expiry, state, nonce, and replay protections required by the approved security design.
- SAML, if selected, requires a separate security design and acceptance suite; the abandoned prototype is not a baseline.
- Identity-provider claims may establish authentication and mapped identity but may not assign or elevate a LatticeDesk workspace role.
- Configuration must be tenant-scoped, versioned, rollback-capable, and compatible with signing-key rotation.
- Configuration changes, test results, enablement, enforcement, disablement, recovery, and break-glass use must be auditable without recording secrets, raw tokens, or authorization codes.
- Identity data collection must be limited to claims required for authentication, identity mapping, and the approved user experience. Storage, retention, and access must be documented before launch.
- Existing web sessions remain owned by the web server; mobile clients continue to use short-lived handoff codes unless a reviewed design changes that boundary.
- The current system allows a disabled member's existing sessions to remain valid for up to 24 hours. Launch requires an approved replacement or explicit acceptance of that behavior; it may not remain implicit.
- Enforced SSO must have tested, audited break-glass access. A universal bypass is prohibited.
- The final workspace owner cannot enable a configuration that leaves no tested recovery path.

## Assumptions

- [assumed] The product will first build protocol-neutral tenant configuration, identity mapping, testing, enforcement, audit, and recovery capabilities. Product and Security will settle the first protocol before implementation commits to a provider-specific adapter. If wrong, the architecture and delivery sequence must be revised.
- [assumed] One active identity-provider connection per tenant is sufficient for the initial release. Product discovery with customers who use multiple providers will settle this. If wrong, configuration, routing, and identity uniqueness need a multi-connection model.
- [assumed] Existing tenant membership is required before first SSO sign-in; just-in-time domain-wide enrollment is excluded. Product and Security must confirm the enrollment model. If wrong, invitation, authorization, abuse-prevention, and domain-verification scope expands.
- [assumed] Guests remain outside enforced SSO unless an admin explicitly places them under a compatible connection. Product and Security must settle guest policy. If wrong, guest access and recovery flows must be redesigned.
- [assumed] Password or magic-link fallback remains available until enforcement is enabled. Security must approve fallback and outage behavior. If wrong, migration and recovery requirements expand.
- [assumed] Enterprise entitlement gates customer access, but pricing and packaging remain unapproved. Product and Commercial must settle entitlement before launch.

## Non-goals

- Automatic domain-wide enrollment is excluded because domain control does not prove individual identity or tenant membership.
- Email-only account linking is excluded because email is mutable and the security baseline forbids it.
- SCIM provisioning and group synchronization are excluded from this release; deprovisioning still needs a defined membership and session policy.
- Identity-provider-driven role assignment is excluded because tenant membership roles remain independently authorized by LatticeDesk.
- Multiple simultaneous identity-provider connections per tenant are excluded pending customer validation.
- Replacing password and magic-link authentication for all workspaces is excluded; the capability is tenant-configured and entitlement remains undecided.
- Native mobile federation is excluded; mobile continues through the existing short-lived web handoff unless a separate reviewed design changes it.
- A legal or regulatory compliance claim is excluded; referenced standards inform product and security design but do not establish LatticeDesk's legal obligations.

## Acceptance criteria

- AC-A: An admin can save draft provider configuration, run a connection test, and see separate results for discovery or metadata retrieval, redirect or callback validation, signature validation, issuer and audience validation, and identity-claim mapping, as applicable to the selected protocol.
- AC-B: A failed connection test leaves the active tenant configuration and current user sign-in behavior unchanged.
- AC-C: Enabling SSO requires a successful test against the exact configuration version being enabled; changing that version requires another successful test.
- AC-D: A successful federated callback creates a LatticeDesk session only when the provider identity is cryptographically verified and an explicit active membership exists for the same tenant.
- AC-E: Two accounts that share an email address are not linked unless the approved verified-linking flow binds the provider's stable subject to the intended tenant membership.
- AC-F: A federated identity for one tenant cannot authenticate into another tenant unless that second tenant has its own explicit membership and approved identity binding.
- AC-G: Provider claims cannot create, change, or elevate a workspace role in the initial release.
- AC-H: Enforcement cannot be enabled until the final-owner guard confirms a tested recovery path and records which owner retains recovery access.
- AC-I: Every break-glass sign-in is restricted to authorized recovery users, produces an audit event, and exposes no credential, secret, authorization code, or token in the event or URL.
- AC-J: Disabling a membership prevents new sign-ins immediately and handles existing sessions exactly as the approved revocation policy specifies; an end-to-end test observes the result.
- AC-K: During a simulated provider outage, optional-SSO and enforced-SSO tenants follow their approved fallback policies, users receive a non-sensitive explanation, and operators can distinguish provider failure from LatticeDesk failure.
- AC-L: Signing-key rotation succeeds without accepting an untrusted key, and rolling back tenant configuration restores the last approved version with an audit trail.
- AC-M: Audit coverage includes configuration creation and change, connection test, enablement, enforcement, disablement, identity binding, rejected linking, session revocation, recovery, and break-glass use.
- AC-N: Security review confirms that callback parameters, application logs, analytics, support views, URLs, and audit events contain no secrets or raw tokens.
- AC-O: Privacy review documents every stored identity claim, its purpose, access, retention, deletion behavior, and applicable contract decision before customer launch.
- AC-P: Keyboard-only testing covers workspace discovery, SSO initiation, returned errors, fallback, and recovery with visible focus and usable error recovery; the LatticeDesk-owned login path meets the internal WCAG 2.2 AA target.
- AC-Q: A person with memberships in several workspaces can choose or discover the intended tenant without revealing whether an unrelated tenant exists.
- AC-R: Support documentation maps each observable failure category to safe diagnostic information, user guidance, escalation ownership, and the approved outage response.

## Priorities

### Critical path

- Decide the initial protocol strategy: direct SAML, direct OIDC, or managed federation supporting the required providers.
- Approve the account-linking and stable identity model.
- Approve the active-session revocation policy and enforced-SSO recovery model.
- Resolve the Cedar contract, privacy, jurisdiction, and data-region obligations before making a customer commitment.

### Now

- Build tenant-scoped configuration, safe test mode, versioning, rollback, and key rotation.
- Build verified identity binding, tenant membership checks, and multi-workspace routing.
- Build guarded enablement and enforcement, guest behavior, outage handling, recovery, and audit events.
- Complete security, privacy, accessibility, operational, and support acceptance tests.

### Next

- Validate multiple-provider demand and revisit the single-connection assumption.
- Define SCIM provisioning and faster deprovisioning as a separate product scope.
- Add provider-specific setup guidance beyond the first validated combinations.

### Later

- Evaluate just-in-time enrollment, domain discovery, and group-to-role mapping only after their authorization and abuse cases are separately approved.

## Risks

- Wrong-account takeover: email-only or cross-tenant linking binds a verified provider identity to the wrong LatticeDesk user. Control: stable issuer/subject binding plus explicit tenant membership and a reviewed linking ceremony.
- Tenant escape: a callback or configuration is accepted under the wrong tenant. Control: bind requests, callbacks, configuration, identity, membership, and session creation to the same tenant and test isolation end to end.
- Admin lockout: enforcement or provider outage strands every owner. Control: final-owner guard, tested recovery path, and audited break-glass access.
- Delayed deprovisioning: a removed member retains an active session for up to 24 hours under current behavior. Control: approve and test a revocation target before launch; show residual exposure if current behavior is accepted.
- Protocol mismatch: choosing OIDC first fails the Cedar pilot, while choosing SAML first diverges from the security proposal. Control: decide against verified commercial needs and engineering/security review before provider-specific build work.
- Vendor lock-in or duplicated security work: direct implementation expands protocol burden; managed federation adds dependency, cost, and data handling. Control: compare failure modes, provider coverage, operational ownership, data flows, migration path, and total cost before commitment.
- Privacy or contract breach: identity claims or cross-border handling conflict with inaccessible terms. Control: authorized legal/commercial review of the Cedar addendum before commitment.
- Recovery bypass abuse: a broad fallback defeats enforcement. Control: named recovery users, least privilege, audited use, review, and no universal bypass.
- Support overload: opaque provider errors generate escalations without an owner. Control: observable failure categories, runbooks, named on-call path, and approved escalation expectations before launch.

## Open questions

- Product, Security, and Engineering: Which protocol strategy launches first, and will LatticeDesk implement it directly or use managed federation? Blocks provider-specific architecture and customer commitment. The strongest failure mode is building OIDC that cannot satisfy Cedar; the best alternative is managed federation that supports both required protocols. Status: needs validation.
- Commercial and Legal: What does the Cedar addendum require for protocol, data region, jurisdiction, privacy roles, support, and delivery? The source is inaccessible to this drafting session. Blocks Cedar commitment and privacy sign-off.
- Product and Security: Are guests exempt from enforcement, routed to another provider, or required to use the tenant connection? Blocks final login and recovery experience.
- Security and Engineering: What is the required active-session revocation behavior after membership disablement? Blocks deprovisioning acceptance and risk sign-off.
- Product: Is SCIM included in the launch or a separate follow-on? Blocks only provisioning scope, not core federated authentication.
- Product and Commercial: Which entitlement receives SSO, and is there a pilot exception? Blocks packaging and availability controls.
- Support and Security: Who owns SSO support and on-call escalation, and what response expectations apply? Blocks operational readiness.
- Product, Security, and Data: Which launch thresholds determine pilot success and expansion? Blocks launch criteria, not implementation discovery.

## Verification record

- Separated: answered - see `Outcomes`, `Constraints`, `Assumptions`, and `Decided`.
- Checkable: answered - all acceptance criteria are observable tests; unresolved policy choices are explicit gates.
- Non-goals stated: answered - see `Non-goals`.
- Questions earned: answered - open questions remain only where authority, inaccessible contract material, or an explicit cross-functional decision is required.
- Priorities honest: answered - protocol, identity/linking, revocation/recovery, and contract obligations are the critical path.
- Decision surfaced: answered - the SAML, OIDC, or managed-federation choice is named as the primary decision gate.

## Source notes

- Current local authority: `docs/product.md` and `docs/security-baseline.md`.
- Superseded historical source: `docs/old-roadmap.md`; cited only to make the conflict explicit.
- Workspace evidence reviewed: `workspace://jira/SSO-14`, `workspace://docs/auth-architecture`, `workspace://docs/identity-review`, `workspace://docs/sessions`, `workspace://docs/identity-schema`, `workspace://docs/privacy`, `workspace://docs/accessibility`, `workspace://slack/identity/339`, and `workspace://slack/identity/340`.
- Primary references reviewed: OpenID Connect Core, OAuth 2.0 Security Best Current Practice, NIST federation guidance, and W3C guidance for accessible authentication.
- Inaccessible source: `workspace://contracts/cedar`; no contract content was inferred.
