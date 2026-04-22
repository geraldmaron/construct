<!--
skills/security/threat-intel.md — Threat Intelligence — Use this skill when performing OSINT, threat modeling, or building threat intell

Use this skill when performing OSINT, threat modeling, or building threat intelligence programs. ## OSINT Collection
-->
# Threat Intelligence

Use this skill when performing OSINT, threat modeling, or building threat intelligence programs.

## OSINT Collection

### Domain and Infrastructure
- DNS records: A, AAAA, MX, TXT, CNAME, NS, SOA
- Reverse DNS and IP range enumeration
- Certificate transparency logs (crt.sh, Censys)
- WHOIS history and registrar patterns
- Subdomain enumeration via passive sources and brute force
- Historical snapshots (Wayback Machine)

### Organization and People
- Public employee directories and org charts
- Job postings reveal technology stack and priorities
- Social media for social engineering vectors
- Code repositories for leaked credentials and internal naming
- Leaked credential databases (for defensive awareness)
- Conference talks and publications reveal architecture decisions

### Technology Fingerprinting
- Web technology stack: Wappalyzer patterns, HTTP headers, JavaScript libraries
- Cloud provider identification via IP ranges and DNS
- Email infrastructure: SPF, DKIM, DMARC records
- Exposed management interfaces and development endpoints

## Threat Modeling

### STRIDE Model
- **Spoofing**: Can an attacker impersonate a user, service, or component?
- **Tampering**: Can data be modified in transit or at rest?
- **Repudiation**: Can actions be performed without attribution?
- **Information Disclosure**: Can sensitive data be exposed?
- **Denial of Service**: Can availability be degraded?
- **Elevation of Privilege**: Can an attacker gain unauthorized access?

### Process
1. Define the system scope and trust boundaries
2. Decompose into components and data flows
3. Identify threats per component using STRIDE
4. Rate risk: likelihood x impact
5. Prioritize mitigations by risk and cost
6. Document accepted risks with justification

## MITRE ATT&CK Mapping

- Map observed behaviors to ATT&CK techniques
- Use ATT&CK Navigator to visualize coverage and gaps
- Prioritize detection for techniques used by relevant threat actors
- Track technique prevalence in your sector
- Map defensive controls to techniques they detect or prevent

## Threat Actor Profiling

- Categorize: nation-state, cybercrime, hacktivist, insider, opportunistic
- Document: known TTPs, targeted sectors, infrastructure patterns, tooling
- Track campaigns and attribute based on overlap in infrastructure, code, and behavior
- Assess relevance to your organization's risk profile
- Update profiles as new intelligence emerges

## Intelligence Sharing

### Standards
- STIX 2.1 for structured threat intelligence objects
- TAXII for automated exchange
- OpenIOC for indicator sharing
- TLP (Traffic Light Protocol) for classification: RED, AMBER, GREEN, CLEAR

### Sources
- Commercial feeds: CrowdStrike, Recorded Future, Mandiant
- Open feeds: AlienVault OTX, Abuse.ch, PhishTank
- ISACs and ISAOs for sector-specific intelligence
- Government: CISA advisories, FBI flash alerts
- Internal: your own incident data is the highest-fidelity source

## Metrics

- Intelligence-to-detection conversion rate
- Time from IOC publication to operational deployment
- Percentage of incidents with prior intelligence
- Threat model coverage: components modeled vs total
- False positive rate of intelligence-derived detections
