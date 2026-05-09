<!--
skills/ai/llm-security.md — LLM Security — Use this skill when securing LLM-powered applications against prompt injection,

Use this skill when securing LLM-powered applications against prompt injection, data leakage, and misuse. ## Prompt Injection
-->
# LLM Security

Use this skill when securing LLM-powered applications against prompt injection, data leakage, and misuse.

## Prompt Injection

### Direct Injection
- User input overrides system instructions ("ignore previous instructions and...")
- Instruction delimiters in user content confuse the model
- Encoded payloads: base64, ROT13, unicode tricks bypass naive filters

### Indirect Injection
- Malicious instructions embedded in retrieved documents, emails, or web pages
- Tool outputs containing adversarial prompts
- Injected content in database records, file metadata, or API responses

### Mitigations
- Separate system instructions from user input with clear structural delimiters
- Use structured tool calling instead of free-text tool invocation
- Validate and sanitize all external content before including in prompts
- Monitor for instruction-following anomalies in outputs
- Defense in depth: no single mitigation is sufficient

## Data Leakage

### System Prompt Extraction
- Adversarial queries designed to make the model reveal its instructions
- Avoid placing secrets, API keys, or sensitive logic in prompts
- Test with extraction attempts before deployment

### Training Data Leakage
- Model may memorize and reproduce sensitive training data
- Use output filtering for PII, credentials, and proprietary content
- Fine-tuned models have higher memorization risk

### Context Window Leakage
- Multi-turn conversations may expose prior context to subsequent users
- Isolate sessions; do not share context across users
- Clear context between logically separate interactions

## Output Validation

- Classify outputs for harmful content before delivering to users
- Filter PII from generated responses
- Validate structured outputs against expected schema
- Block responses that reference system prompt content
- Rate limit generation to prevent abuse

## Guardrails Architecture

### Input Layer
1. Input validation: length, format, character set
2. Content classification: detect adversarial, toxic, or off-topic input
3. Rate limiting per user, per IP, per session
4. Blocklist for known attack patterns (with awareness that blocklists are bypassable)

### Processing Layer
1. Separate system context from user context structurally
2. Minimize sensitive information in prompts
3. Use tool-level permissions: agent cannot access tools beyond its scope
4. Constrain generation parameters: temperature, max tokens, stop sequences

### Output Layer
1. Content classification on generated text
2. PII detection and redaction
3. Schema validation for structured outputs
4. Citation verification against source material
5. Human review queue for high-risk outputs

## Tool Use Security

- Principle of least privilege: each tool call should require minimum permissions
- Validate all tool arguments; do not pass user input directly to tools
- Sandbox code execution environments
- Log all tool invocations for audit
- Require confirmation for destructive operations

## Jailbreak Resistance

- No single defense stops all jailbreaks; layer mitigations
- Regularly test with known jailbreak techniques
- Monitor for novel attack patterns in production logs
- Update defenses as new techniques emerge
- Accept that sufficiently motivated attackers will find bypasses; limit blast radius

## Monitoring and Incident Response

- Log all prompts, responses, and tool calls (with PII redaction)
- Alert on: unusual token patterns, repeated injection attempts, output policy violations
- Maintain an incident response playbook for LLM-specific failures
- Track and categorize bypass attempts to improve defenses
- Measure: injection detection rate, false positive rate, policy violation rate

## Compliance

- Document AI usage and limitations for users
- Maintain audit trail of model inputs, outputs, and decisions
- Disclose AI-generated content where required by policy or regulation
- Ensure data processing complies with privacy regulations (GDPR, CCPA)
- Review and update security controls with each model or prompt change
