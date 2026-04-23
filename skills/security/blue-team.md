<!--
skills/security/blue-team.md — Blue Team — Use this skill when defending systems, responding to incidents, or building dete

Use this skill when defending systems, responding to incidents, or building detection and monitoring capabilities. ## Detection Engineering
-->
# Blue Team

Use this skill when defending systems, responding to incidents, or building detection and monitoring capabilities.

## Detection Engineering

- Write detection rules based on known TTPs, not just IOCs
- Use SIGMA rules for vendor-agnostic detection logic
- Test detections against atomic red team or similar frameworks
- Tune alert thresholds to minimize false positives without losing true positives
- Layer detections: network, endpoint, identity, application

## SIEM Operations

- Normalize log formats before ingestion
- Correlate events across sources: firewall, endpoint, identity, application
- Build dashboards for: authentication anomalies, lateral movement indicators, data exfiltration patterns
- Retain logs for compliance period plus investigative buffer
- Index critical fields for fast search: source IP, user, process, command line

## EDR and Endpoint Defense

- Deploy agents on all endpoints including servers
- Monitor: process creation trees, network connections, file modifications, registry changes
- Block known-bad hashes and suspicious behaviors
- Investigate alerts within SLA: Critical <1h, High <4h, Medium <24h
- Maintain exclusion lists carefully; review quarterly

## Incident Response Process

1. **Detect**: Alert triggers or user report
2. **Triage**: Confirm true positive, assess scope, assign severity
3. **Contain**: Isolate affected systems, block IOCs, disable compromised accounts
4. **Investigate**: Build timeline, identify root cause, determine blast radius
5. **Eradicate**: Remove attacker presence, patch vulnerability, rotate credentials
6. **Recover**: Restore from clean backups, monitor for re-compromise
7. **Lessons learned**: Document findings, update runbooks, improve detections

## Forensics Fundamentals

- Preserve evidence before remediation (memory dumps, disk images, logs)
- Maintain chain of custody documentation
- Analyze artifacts: prefetch, event logs, browser history, shellbags, MFT
- Timeline analysis using multiple artifact sources
- Hash all evidence for integrity verification

## Threat Hunting

- Hypothesis-driven: start from a TTP, look for evidence
- Data-driven: anomaly detection on baselines (unusual process, new scheduled task, rare DNS query)
- Hunt regularly, not only after incidents
- Document and share findings to improve detection coverage
- Track hunt coverage against MITRE ATT&CK matrix

## IOC Management

- Categorize: IP, domain, hash, URL, email, certificate, mutex
- Score by confidence and relevance
- Expire IOCs that are no longer active
- Automate ingestion from threat feeds into blocking and detection tools
- Share IOCs with trusted peers via STIX/TAXII or equivalent

## Hardening Baselines

- CIS benchmarks as starting point for OS and service hardening
- Disable unnecessary services and protocols
- Enforce least privilege on all accounts
- Segment networks by trust zone
- Patch within SLA: Critical <48h, High <7d, Medium <30d
- Review firewall rules quarterly; remove stale entries

## Metrics

- Mean time to detect (MTTD)
- Mean time to respond (MTTR)
- Alert-to-incident ratio (false positive rate)
- MITRE ATT&CK technique coverage percentage
- Patch compliance rate
