# LatticeDesk Single Sign-On Product Requirements

Status: Draft  
Audience: Product, engineering, design, and security  
Owner: Product  

## Summary

LatticeDesk should add workspace-level single sign-on (SSO) for enterprise customers using the SAML protocol. Workspace admins will configure and verify an identity-provider connection, test it before activation, and optionally require members to use it. Existing password and magic-link sign-in will remain available where SSO isn't enforced. Guests will remain outside enforcement by default because they may use a different identity provider.

The first release covers authentication and safe association with existing LatticeDesk accounts. Automated provisioning and deprovisioning, open-ended identity-provider discovery, and OIDC support are deferred.

## Context

LatticeDesk workspaces have owners, admins, members, and guests, and one person may belong to several workspaces. Today, sign-in uses a password or emailed magic link; SSO hasn't shipped. Large prospective tenants want centralized employee authentication, while guest contractors may use a different identity provider. Enterprise packaging has been proposed but pricing isn't approved. [Product overview](docs/product.md)

The security baseline makes tenant isolation mandatory. LatticeDesk must not link an account by email address alone, treat domain control as proof of an individual's identity, expose secrets in URLs or audit events, or let enforced SSO strand a workspace's final owner. [Security baseline](docs/security-baseline.md)

The historical roadmap proposed broad SAML availability, automatic domain enrollment, and email-based account linking. It explicitly isn't an implementation record, and its linking approach conflicts with the current security baseline; this PRD doesn't carry those proposals forward. [Historical roadmap](docs/old-roadmap.md)

## Problem

Enterprise administrators cannot centralize employee authentication in their identity provider. This creates additional credential-management work, prevents customers from applying their existing authentication policies to LatticeDesk access, and blocks prospects that require SSO.

At the same time, naive domain matching or email-only account linking could grant access across tenant boundaries, take over an existing account, or lock administrators out. The product needs enterprise SSO without weakening workspace isolation or the existing multi-workspace and guest models.

## Goals

- Let an authorized workspace administrator configure, verify, test, activate, and disable a SAML identity-provider connection.
- Let eligible workspace members authenticate through the configured identity provider.
- Preserve a person's ability to belong to multiple workspaces, including workspaces with different authentication policies.
- Let an administrator enforce SSO for eligible members without locking out the final workspace owner.
- Give administrators and support staff useful, secret-free audit records and failure diagnostics.
- Make rollout reversible at the workspace level.

## Non-goals

- Automated user lifecycle management or group synchronization.
- OIDC authentication.
- Automatic enrollment based only on an email domain.
- Pricing, packaging, or entitlement approval.
- Replacing password or magic-link authentication across the product.
- A specific identity-provider vendor partnership or implementation architecture.

## Users and jobs

### Workspace owner or admin

- Configure the workspace's identity-provider connection without support intervention.
- Prove the connection works before it affects other users.
- Understand who will be required to use SSO and who is exempt.
- Recover safely from identity-provider failure or a bad configuration.
- Investigate changes and sign-in failures without seeing credentials or tokens.

### Workspace member

- Reach the correct workspace sign-in path and authenticate with the expected identity provider.
- Retain access to other LatticeDesk workspaces that use different sign-in policies.
- Receive an actionable error when authentication succeeds but workspace access isn't authorized.

### Guest

- Continue using an allowed existing sign-in method by default, even when the host workspace enforces SSO for its workforce.

### Support and security teams

- Diagnose configuration and authentication failures from bounded, non-sensitive metadata.
- Identify configuration, enforcement, and recovery events in an audit trail.

## Product decisions

- SSO configuration and enforcement are scoped to a workspace, not to an email domain or a person's entire LatticeDesk account.
- The initial protocol is SAML. OIDC is deferred.
- SSO proves authentication with an identity provider; it doesn't by itself prove membership in a LatticeDesk workspace.
- Existing-account linking requires an authenticated LatticeDesk session or another approved proof of account control plus explicit workspace membership. A matching email claim alone is insufficient.
- Guests are exempt from SSO enforcement by default. A later policy may expand enforcement after the mixed-identity-provider experience is validated.
- At least one owner recovery path must remain available while enforcement is enabled. The final owner cannot be removed from all usable recovery paths.
- Just-in-time access is limited to people who already have an explicit pending invitation or active membership for that workspace. Domain ownership alone never creates membership.

## User experience

### Configure and test

- An owner or admin opens workspace authentication settings and starts SSO setup.
- LatticeDesk presents its service-provider details and accepts the identity-provider metadata required for the connection.
- Sensitive configuration values are masked after entry and never echoed in URLs or audit records.
- The administrator runs a test sign-in in a separate flow. A failed test doesn't change the workspace's current sign-in policy.
- After a successful test, the administrator can activate SSO in optional mode.

### Link and sign in

- A signed-in member may link the identity-provider identity to their existing LatticeDesk account from a controlled flow.
- On later visits, a workspace-specific sign-in entry point routes the person to that workspace's identity provider.
- After the identity provider returns a valid assertion, LatticeDesk resolves the connection, validates the assertion, and confirms explicit membership in the target workspace before creating a session.
- If the identity is valid but isn't authorized for the workspace, LatticeDesk denies access without disclosing whether unrelated accounts or workspaces exist.
- A person can use SSO for one workspace and password or magic link for another.

### Enforce and recover

- An owner or admin can review the affected roles and exemptions before enabling enforcement.
- Enforcement cannot be enabled until the connection has passed a test and the final owner has a valid recovery path.
- Disabling or changing a connection requires recent administrator authentication and creates an audit event.
- If the identity provider is unavailable, the designated owner recovery flow restores administrative access without bypassing workspace membership checks. Recovery use is audited and triggers the project's existing security-notification mechanism where available.

## Functional requirements

### Workspace configuration

- Only authorized workspace owners or admins may view or change SSO settings, subject to the existing role-permission model.
- Each workspace may have one active SAML connection in the initial release.
- The system must validate required metadata, reject malformed or insecure configuration, and clearly identify correctable errors.
- Configuration changes must be staged so a broken replacement doesn't overwrite a working connection before validation.
- The system must support test, activate, update, disable, and rotate-credential flows.

### Authentication and authorization

- The system must bind every SSO transaction to the intended workspace and connection.
- The system must validate the assertion using the approved security implementation, including issuer, audience, destination, signature, timing, request correlation, and replay protections as applicable.
- The system must establish workspace membership independently from the email domain or the identity provider's authentication result.
- The system must reject ambiguous identity matches and direct the person to a safe resolution or support flow.
- Account linking and unlinking must require recent authentication and must not remove the person's last usable authentication method without an approved recovery path.
- A workspace's enforcement policy must not alter authentication policy for the person's other workspaces.

### Enforcement policy

- Optional mode allows eligible members to use either SSO or an existing permitted sign-in method.
- Enforced mode requires SSO for members covered by the workspace policy.
- Guests are excluded by default and their exemption is visible before enforcement.
- The system must block enforcement when it would strand the final owner.
- Policy changes take effect predictably for new sign-ins; the treatment of existing sessions must be documented before launch and applied consistently.

### Audit and diagnostics

- Audit events must cover connection creation, successful test, activation, configuration change, enforcement change, disablement, identity link or unlink, and recovery use.
- Audit records must identify the actor, workspace, action, outcome, and timestamp while excluding assertions, tokens, secrets, and sensitive configuration values.
- Sign-in errors shown to users must be actionable but must not reveal whether unrelated users, domains, or workspaces exist.
- Support diagnostics must use correlation identifiers and bounded metadata, with access controlled under existing support and security policies.

## Security and privacy requirements

- Preserve tenant isolation at every configuration, routing, linking, authentication, authorization, and recovery boundary.
- Use an approved SAML library and complete a protocol-focused security review before release.
- Protect configuration secrets and signing material using the project's approved secret-storage and rotation mechanisms.
- Prevent open redirects, assertion replay, login cross-site request forgery, workspace-confusion attacks, and identity-provider mix-up.
- Rate-limit and monitor discovery, callback, linking, and recovery paths where abuse could expose account state or enable takeover attempts.
- Collect and retain only the identity attributes needed for authentication, account resolution, authorization, audit, and support. Document retention and deletion behavior before launch.
- Never place assertions, tokens, secrets, or sensitive configuration values in URLs, analytics payloads, client-visible logs, or audit events.
- Require threat modeling and security approval for the account-linking and owner-recovery designs before implementation is considered complete.

## Success measures

The team will establish baselines and launch targets before general availability. Measures should include:

- Eligible enterprise workspaces that successfully configure, test, and activate SSO.
- SSO sign-in completion and failure rates, segmented by failure category without exposing identity data.
- Support contacts attributable to setup, account linking, enforcement, and recovery.
- Prospective or existing customers unblocked by SSO availability.
- Confirmed cross-workspace authorization, account-takeover, secret-exposure, or unrecoverable-lockout incidents, with a launch expectation of none.

## Rollout and validation

- Begin with internal test workspaces representing members, guests, multiple-workspace users, and different workspace policies.
- Run an invite-only customer pilot with optional SSO before allowing enforcement.
- Exercise configuration replacement, expired or rotated identity-provider credentials, invalid and replayed assertions, identity-provider outage, ambiguous identity, removed membership, guest access, multi-workspace routing, and owner recovery.
- Require a successful connection test and owner-recovery check before each workspace can enable enforcement.
- Define dashboards, alerts, support procedures, incident ownership, and a workspace-level rollback procedure before broader release.
- Expand availability only after product, engineering, support, and security review the pilot evidence and open issues.

## Acceptance criteria

- An authorized administrator can configure and successfully test a SAML connection without changing the active sign-in policy.
- A valid, explicitly authorized member can sign in through the correct workspace connection.
- A valid identity-provider user without explicit workspace membership is denied access.
- Matching email or domain claims alone never link an existing account or create workspace membership.
- A person can use different permitted authentication methods across different workspaces.
- Guests retain their permitted existing sign-in path when member SSO enforcement is enabled by default.
- Enforcement is blocked when it would leave the final owner without a tested recovery path.
- Failed setup or identity-provider outage can be reversed at the workspace level without weakening membership checks.
- Audit and diagnostic records support investigation while excluding assertions, tokens, secrets, and sensitive configuration.
- Security testing covers tenant confusion, account linking, replay, request correlation, redirect handling, enforcement bypass, and recovery abuse before release.

## Dependencies and open decisions

- Confirm which workspace roles may configure SSO and which roles are covered by enforcement.
- Define the approved owner-recovery mechanism and operational approval path.
- Decide how existing sessions behave when enforcement is enabled, disabled, or materially reconfigured.
- Define the minimum identity attributes and their retention periods.
- Validate protocol and account-linking architecture against the referenced identity-review and authentication-architecture materials before implementation.
- Decide enterprise entitlement and packaging separately from this product behavior.
- Set launch targets for adoption, reliability, and support burden after baseline data is available.

## Risks and controls

- **Cross-tenant account takeover:** A matching email is treated as identity or membership. Control: require proof of account control, bind transactions to a workspace and connection, and verify explicit membership separately.
- **Administrator lockout:** Enforcement or identity-provider failure removes every owner path. Control: preflight enforcement, preserve a tested owner recovery path, and audit its use.
- **Guest disruption:** Workforce SSO policy captures contractors using another identity provider. Control: exempt guests by default and show the affected population before enforcement.
- **Workspace confusion:** A multi-workspace user is routed through or returned to the wrong tenant. Control: bind requests and callbacks to the intended workspace and connection, reject mismatches, and test mixed-policy journeys.
- **Secret leakage:** Assertions or configuration values enter URLs, analytics, logs, or audit history. Control: prohibit those fields, review telemetry schemas, and test redaction.
- **Unsafe rollout:** A bad configuration replaces a working one. Control: stage and test changes, retain workspace-level disablement, and document rollback.
