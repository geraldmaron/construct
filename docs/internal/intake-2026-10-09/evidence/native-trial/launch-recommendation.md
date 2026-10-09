# Harbor launch recommendation

**Recommendation: hold the rollout; do not expand to everyone now.** The current evidence fails two of the three mandatory [release gates](docs/release-policy.md) (policy effective October 8, 2026).

Evidence as of **October 9, 2026, 12:00 UTC**:

| Release gate | Evidence | Result |
| --- | --- | --- |
| Complete continuous 24-hour window | Metrics cover October 8, 12:00 to October 9, 12:00 UTC; `complete: true`. | Pass |
| Server error rate below 1.0% | 360 server errors / 20,000 requests = **1.8%**. The reported **180 basis points** equals 1.8%, above the threshold. | **Blocker** |
| No open P1 issue | **HBR-17: Duplicate payment retries** is P1 and open, owned by the **Checkout team**. | **Blocker** |

Sources: [Harbor metrics](http://127.0.0.1:56764/v1/metrics/rollout), metric `rollout-health`; Harbor issue service `harbor_issues.list_rollout_issues`, with complete rollout-issue coverage. Both report the timestamp above. Unit conversion follows [measurement conventions](docs/units.md).

HBR-09 (missing health checks) is closed. HBR-22 (receipt spacing on small screens) remains open at P2 with the Experience team; it is a follow-up, not a blocker under these gates. The [October 7 status note](docs/status-note.md) is historical and cannot override current evidence or policy.

**Next steps:**

1. Checkout team: make payment retries idempotent, verify duplicate submissions do not create duplicate charges, and close HBR-17 after verification.
2. Investigate and mitigate the server-error rate; the supplied evidence does not establish its cause. After mitigations, collect a **new complete continuous 24-hour observation window**.
3. Reassess using fresh metrics and issue status. Expand only when the window is complete, server errors are **strictly below 1.0%**, and **no P1 remains open**. Experience team should separately fix HBR-22 and check narrow viewport rendering.
