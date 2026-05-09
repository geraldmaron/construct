<!--
skills/security/red-team.md — Red Team — Use this skill when planning or executing offensive security assessments, advers

Use this skill when planning or executing offensive security assessments, adversary emulation, or attack simulations. ## Reconnaissance
-->
# Red Team

Use this skill when planning or executing offensive security assessments, adversary emulation, or attack simulations.

## Reconnaissance

- Passive: DNS records, WHOIS, certificate transparency, public repos, social media, job postings
- Active: port scanning, service fingerprinting, directory brute-forcing, virtual host enumeration
- Map the attack surface before attempting exploitation
- Document all discovered assets, services, and potential entry points

## Initial Access

- Phishing: credential harvesting, macro-enabled documents, HTML smuggling
- Exposed services: default credentials, known CVEs, misconfigured cloud storage
- Supply chain: compromised dependencies, typosquatting packages
- Web application: authentication bypass, injection, file upload abuse
- Always verify scope before attempting access vectors

## Privilege Escalation

- Linux: SUID binaries, writable cron jobs, kernel exploits, sudo misconfigurations, capability abuse
- Windows: unquoted service paths, DLL hijacking, token impersonation, AlwaysInstallElevated, PrintNightmare variants
- Cloud: over-permissive IAM roles, instance metadata SSRF, cross-account trust abuse
- Enumerate before escalating; avoid unnecessary noise

## Lateral Movement

- Credential reuse across hosts
- Pass-the-hash and pass-the-ticket (Kerberos)
- Remote services: WMI, PSRemoting, SSH, RDP
- Internal pivoting through compromised hosts
- Abuse of administrative shares and trust relationships
- Document each hop for the attack path narrative

## Persistence

- Scheduled tasks and cron jobs
- Registry run keys and startup folders
- Web shells and reverse shells
- Service creation and modification
- Golden/silver tickets in Active Directory
- Cloud: persistent IAM keys, backdoor roles, lambda triggers

## Command and Control

- HTTP/HTTPS beaconing with domain fronting
- DNS tunneling for restrictive networks
- Encrypted channels with jitter and sleep intervals
- Redirectors to protect infrastructure
- Avoid patterns that trigger common EDR signatures

## Evasion

- AMSI bypass techniques for PowerShell
- Living-off-the-land binaries (LOLBins)
- Process injection: hollowing, DLL injection, APC queue
- Timestomping and log tampering (document for report, do not destroy evidence)
- Obfuscation of tooling and payloads

## Reporting

- Document the full kill chain with timestamps
- Map findings to MITRE ATT&CK techniques
- Provide reproduction steps for each finding
- Rate severity by business impact, not technical complexity
- Include remediation recommendations with priority
- Separate executive summary from technical details

## Rules of Engagement

- Operate strictly within authorized scope
- Maintain out-of-band communication with the client
- Have emergency stop procedures ready
- Log all actions for accountability
- Never exfiltrate real sensitive data; use proof-of-access artifacts
