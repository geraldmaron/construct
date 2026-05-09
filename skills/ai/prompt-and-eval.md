<!--
skills/ai/prompt-and-eval.md — Prompt Engineering and Evaluation — Use this skill when designing prompts, evaluating model performance, or optimizi

Use this skill when designing prompts, evaluating model performance, or optimizing LLM behavior. ## Prompt Structure
-->
# Prompt Engineering and Evaluation

Use this skill when designing prompts, evaluating model performance, or optimizing LLM behavior.

## Prompt Structure

### System Prompt
- Define the role and persona
- State capabilities and constraints
- Specify output format and style
- Include examples of correct behavior
- Keep stable across conversations; parameterize the variable parts

### User Prompt
- Be specific: state the task, context, and expected output
- Provide relevant context; omit irrelevant information
- Break complex tasks into steps
- Use delimiters to separate instructions from data

### Few-Shot Examples
- a small set of examples is typically sufficient (often 3-7)
- Cover the range of expected inputs and edge cases
- Order examples from simple to complex
- Use consistent formatting across examples
- Include examples of correct refusal or uncertainty

## Techniques

### Chain of Thought
- "Think step by step" or explicit reasoning scaffolding
- Improves accuracy on math, logic, and multi-step reasoning
- Increases token usage; use when accuracy justifies cost
- Can be made invisible to users with structured output parsing

### Self-Consistency
- Generate multiple responses with temperature >0
- Select the most common answer (majority vote)
- Improves reliability on ambiguous or difficult tasks
- Cost multiplied by number of samples

### Structured Output
- Request JSON, YAML, or XML with a defined schema
- Provide the schema in the prompt
- Validate outputs programmatically
- Use constrained decoding when available

### Retrieval-Augmented Generation
- Include retrieved context with clear source attribution
- Instruct the model to answer only from provided context
- See `skills/ai/rag-system.md` for full RAG guidance

## Anti-Patterns

- Vague instructions ("do your best", "be creative")
- Conflicting constraints in the same prompt
- Excessive context that buries the actual task
- Over-relying on temperature to fix prompt quality issues
- Not testing prompts against edge cases before deployment

## Evaluation Framework

### Offline Evaluation
1. Build a labeled dataset: input + expected output
2. Define metrics per task type (see below)
3. Run the full pipeline on the eval set
4. Track metrics over time; catch regressions
5. Automate eval on every prompt or model change

### Online Evaluation
- A/B test prompt variants on live traffic
- Collect user feedback: thumbs up/down, corrections
- Monitor: latency, cost, user satisfaction, task completion

### Metrics by Task Type

| Task | Primary Metrics |
|---|---|
| Classification | Precision, recall, F1, confusion matrix |
| Generation | Faithfulness, relevance, fluency, human preference |
| Extraction | Exact match, field-level accuracy, hallucination rate |
| Summarization | ROUGE, faithfulness, compression ratio, human eval |
| Code generation | Pass rate on test cases, correctness, security |
| Conversation | Task completion, turns to resolution, user satisfaction |

### Human Evaluation
- Use when automated metrics are insufficient
- Blind evaluation: evaluators do not know which variant they rate
- Inter-annotator agreement to measure consistency
- Rubric-based scoring with clear criteria
- Sample size sufficient for statistical significance

## Model Selection

| Consideration | Guidance |
|---|---|
| Latency | Smaller models for real-time; larger for batch |
| Cost | Price per token varies 10-100x across model tiers |
| Accuracy | Benchmark on your specific task, not general leaderboards |
| Context window | Match to your typical input + output size |
| Fine-tuning | When prompting alone cannot capture domain patterns |

## Optimization Workflow

1. Start with a clear prompt on the strongest available model
2. Evaluate on a representative dataset
3. Iterate on the prompt to fix failure modes
4. Once prompt is stable, test on smaller/cheaper models
5. Fine-tune only when prompt engineering plateaus
6. Continuously monitor and re-evaluate after deployment
