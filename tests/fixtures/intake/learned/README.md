<!--
tests/fixtures/intake/learned/ — learned fixtures captured by `construct intake reroute`.

Populated when a human reclassifies a quarantined packet. CI loads everything
here via tests/intake-classifier-calibration.test.mjs and asserts the classifier
handles each case correctly. A reroute that fixes a real misclassification
becomes a permanent regression guard.
-->

# Learned intake fixtures

Each file in this directory is a JSON record written by `construct intake reroute`:

```json
{
  "content_hash": "sha256:<16-hex>",
  "source_path": ".cx/inbox/...",
  "text_snippet": "first 500 chars",
  "expected": { "intakeType": "<correct-type>" },
  "origin": "user-reroute",
  "created_at": "<ISO-8601>",
  "packet_id": "intake-..."
}
```

CI loads every fixture and asserts the classifier handles each case correctly.

Do not delete a fixture without recording the rationale: the human override
was the trigger to create the fixture, so removing it without a counter-decision
is the exact bug the corpus is guarding against.
