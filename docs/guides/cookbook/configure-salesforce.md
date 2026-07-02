---
title: Configure Salesforce
description: Connect Construct to Salesforce accounts, contacts, opportunities, custom objects. OAuth or username-password.
---

The Salesforce provider gives Construct read access to standard and custom Salesforce objects via SOQL. Useful when your team builds product surfaces backed by CRM data, or when account/opportunity context belongs in the agent loop.

## Pick an auth flow

Two paths:

**OAuth (recommended for production):**

```
SALESFORCE_CLIENT_ID=3MVG9...
SALESFORCE_CLIENT_SECRET=...
SALESFORCE_REFRESH_TOKEN=5Aep...
SALESFORCE_INSTANCE_URL=https://your-org.my.salesforce.com
```

Get these by creating a Connected App in Salesforce Setup (App Manager → New Connected App), enabling OAuth, and running through the OAuth flow once to capture the refresh token. The refresh token doesn't expire by default and is what Construct uses for ongoing auth.

**Username-password (faster for development):**

```
SALESFORCE_USERNAME=you@example.com
SALESFORCE_PASSWORD=your_password
SALESFORCE_SECURITY_TOKEN=abc...
SALESFORCE_INSTANCE_URL=https://login.salesforce.com
```

Get the security token from My Settings → Reset My Security Token in Salesforce. It's emailed to you and is required if your network IP isn't whitelisted.

In both cases, put the values in `~/.config/construct/config.env`.

## Verify

```bash
construct doctor
```

Look for `Provider: salesforce`. Should report `healthy` if credentials are valid.

Inline test:

```bash
construct mcp call salesforce.query --soql="SELECT Id, Name FROM Account LIMIT 5"
```

Returns 5 accounts.

## What you can ask Construct once it's connected

- Pull a specific account or contact (`@construct who owns the Acme Corp account?`).
- Aggregate opportunity status (`@construct what's the pipeline for next quarter?`).
- Query custom objects (`@construct show me Customer_Health_Score__c < 50 records`).
- Cross-reference with code or product analytics: `@construct correlate our churn dashboard metrics with the Salesforce churn reasons`.

## Capabilities

| Capability | Status |
|---|---|
| SOQL query (standard objects) | ✓ |
| SOQL query (custom objects) | ✓ |
| Read attachments and notes | ✓ |
| Write (create/update records) | ✓ (fence-gated) |
| Apex execution | ✗ not supported |
| Reports / Dashboards API | ✗ not supported |

Write actions follow the same fence model as every other provider: opt-in per specialist.

## Common gotchas

- **`INVALID_LOGIN`.** Either the password is wrong, the security token is stale (resets every password change), or your IP isn't allowlisted in Salesforce's login IP ranges.
- **`INVALID_FIELD` on a custom field.** SOQL is case-sensitive on API names and custom fields end in `__c`. Salesforce's setup UI shows the API name.
- **Rate limits.** Salesforce daily limits vary by org tier. Construct's circuit breaker backs off automatically.
- **Sandbox vs production.** Sandboxes use `test.salesforce.com` as the login host, not `login.salesforce.com`. Set `SALESFORCE_INSTANCE_URL` accordingly.

## Reference

- [`docs/providers/salesforce.md`](https://github.com/geraldmaron/construct/blob/main/docs/providers/salesforce.md): full provider reference, all queryable objects.
- [Cookbook → Manage providers](/guides/cookbook/manage-providers): the broader provider model.
