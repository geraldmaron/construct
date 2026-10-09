# Harbor release policy

Effective 2026-10-08. This policy is authoritative for expanding the rollout.

Expand to everyone only when all of these hold:
- The last continuous 24-hour observation window is complete.
- The server error rate is below 1.0 percent of requests.
- No priority P1 issue is open.

Use the metrics service for measured service health and the Harbor issue service for issue status. A status note is a historical observation, not approval to override these gates. Reassess after mitigations and a new complete observation window.
