# Acme Platform

The services behind Acme's storefront checkout and payments.

- `services/checkout` builds carts and checkout sessions.
- `services/payments` charges cards and issues refunds through the card processor.
- `services/ledger` keeps the double-entry ledger every payment and refund posts to.

See `docs/architecture.md` for how they fit together. Work is tracked in Jira
(project PAY); design pages live in Confluence and product specs in Notion.
