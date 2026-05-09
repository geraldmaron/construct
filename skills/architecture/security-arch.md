<!--
skills/architecture/security-arch.md — Security Architecture — Use this skill when designing authentication, authorization, network security, o

Use this skill when designing authentication, authorization, network security, or zero-trust architectures. ## Zero Trust Principles
-->
# Security Architecture

Use this skill when designing authentication, authorization, network security, or zero-trust architectures.

## Zero Trust Principles

- Never trust, always verify: authenticate and authorize every request
- Least privilege: grant minimum permissions required for the task
- Assume breach: design as if the perimeter is already compromised
- Verify explicitly: use identity, device health, location, and behavior signals
- Micro-segmentation: limit blast radius of any single compromise

## Identity and Access Management

### Authentication
- Centralize authentication in an identity provider (IdP)
- Support MFA for all human users; enforce for privileged accounts
- Use short-lived tokens (15-60 min) with refresh token rotation
- Machine-to-machine: mTLS or signed JWTs with narrow scopes
- Federate identity across services; avoid per-service credential stores

### Authorization
- RBAC for coarse-grained access (admin, editor, viewer)
- ABAC for fine-grained policies (resource owner, department, time)
- Policy-as-code: OPA/Rego, Cedar, or equivalent
- Evaluate authorization server-side on every request
- Audit all access decisions; log denials prominently

### OAuth 2.0 / OIDC
- Use Authorization Code flow with PKCE for web and mobile
- Client Credentials for service-to-service
- Validate tokens server-side; do not trust client-side token claims
- Rotate client secrets regularly
- Restrict redirect URIs to exact match

## Network Security

### Segmentation
- Separate trust zones: public, DMZ, internal, sensitive data
- Network policies restrict traffic between zones
- Service-to-service communication over mTLS
- Egress filtering: allowlist outbound destinations

### API Gateway
- Centralize authentication, rate limiting, and logging
- Terminate TLS at the gateway
- Input validation and request size limits at the edge
- IP allowlisting for admin and internal APIs

### DNS Security
- DNSSEC for domain integrity
- DNS-over-HTTPS or DNS-over-TLS for privacy
- Monitor for subdomain takeover on deprovisioned infrastructure

## Data Protection

### Encryption
- TLS 1.2+ for all data in transit
- AES-256-GCM or ChaCha20-Poly1305 for data at rest
- Key management via HSM or cloud KMS; never store keys alongside data
- Rotate encryption keys on a schedule and on suspected compromise
- Envelope encryption for large data volumes

### Classification
- Public: no restrictions
- Internal: accessible to authenticated employees
- Confidential: restricted to authorized roles
- Restricted: PII, financial, health data; strongest controls

### Data Lifecycle
- Retention policies defined per data class
- Automated deletion at end of retention period
- Secure deletion: cryptographic erasure or verified overwrite
- Backup encryption with separately managed keys

## Secrets Management

- Use a dedicated secrets manager (Vault, AWS Secrets Manager, etc.)
- Inject secrets at runtime, never at build time
- Audit secret access with who, when, and from where
- Rotate secrets on schedule and immediately on suspected exposure
- Detect and alert on secret sprawl (secrets in repos, configs, logs)

## Defense in Depth

Layer controls so that no single failure compromises the system:

1. **Perimeter**: WAF, DDoS protection, edge rate limiting
2. **Network**: segmentation, firewall rules, mTLS
3. **Application**: input validation, output encoding, auth checks
4. **Data**: encryption, access control, audit logging
5. **Monitoring**: anomaly detection, alerting, incident response

## Compliance Considerations

- Map controls to relevant frameworks: SOC 2, ISO 27001, PCI-DSS, HIPAA
- Maintain evidence of control effectiveness
- Automate compliance checks where possible
- Review and update controls quarterly
- Document accepted risks with business justification and owner
