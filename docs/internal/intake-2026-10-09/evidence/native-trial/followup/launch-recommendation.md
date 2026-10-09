# Harbor launch recommendation

**Recommendation: hold the rollout; do not expand to everyone now.** The corrected evidence fails one of the three mandatory [release gates](docs/release-policy.md) (policy effective October 8, 2026): the server error rate is exactly **1.0%**, while the policy requires **strictly below 1.0%**.

Latest source revisions: **`correction-2`**, observed **October 9, 2026, 12:00 UTC**. Both sources corrected the same snapshots without advancing their observation timestamp; these corrections supersede the earlier 1.8% error rate and open HBR-17 status.

| Release gate | Evidence | Result |
| --- | --- | --- |
| Complete continuous 24-hour window | Metrics cover October 8, 12:00 to October 9, 12:00 UTC; `complete: true`. | Pass |
| Server error rate below 1.0% | **200 server errors / 20,000 requests = 1.0%**. Metrics schema version 2 reports the unit as `percent`; equality does not satisfy the gate. | **Blocker** |
| No open P1 issue | Complete issue coverage shows HBR-17 and HBR-09 both closed; no P1 remains open. HBR-17's duplicate-payment retry fix is verified. | Pass |

Sources: [Harbor metrics](http://127.0.0.1:56764/v1/metrics/rollout), metric `rollout-health`; Harbor issue service `harbor_issues.list_rollout_issues`. Both return revision `correction-2`. Metric units follow [measurement conventions](docs/units.md).

HBR-22 (receipt spacing on small screens) remains open at P2 with the Experience team; it is a follow-up, not a blocker under these gates. The [October 7 status note](docs/status-note.md) is historical and cannot override current evidence or policy.

**Next steps:**

1. Investigate and mitigate the remaining server errors; the supplied evidence does not establish their cause. After mitigations, collect a **new complete continuous 24-hour observation window**; the corrected snapshot is not a new window.
2. Reassess fresh metrics and issue status. Expand only when all three gates pass, including server errors **strictly below 1.0%** and **no open P1**. The Checkout team's verified HBR-17 fix needs no further action per the issue service.
3. Experience team: fix HBR-22 and check narrow viewport rendering.
