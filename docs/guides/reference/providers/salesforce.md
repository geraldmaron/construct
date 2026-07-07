<!--
docs/providers/salesforce.md: Salesforce provider setup and usage guide.

Covers credential configuration, capabilities (read/search), and SOQL examples.
-->

# Salesforce Provider

Connects Construct to Salesforce accounts, opportunities, contacts, and custom objects via SOQL queries and direct record reads.

**Capabilities:** read, search

## Authentication

Salesforce uses an instance URL and a bearer access token. Set both in `~/.config/construct/config.env`:

```
SALESFORCE_INSTANCE_URL=https://yourorg.my.salesforce.com
SALESFORCE_ACCESS_TOKEN=your_access_token_here
```

Obtain an access token through one of these flows:

- **SFDX / Salesforce CLI**: `sf org login web -a myorg && sf org display --target-org myorg --json`: copy the `accessToken` field
- **OAuth 2.0 flow**: authorize via the connected app and exchange the code for a token
- **Named credentials** (if deploying to server infrastructure): configure via Salesforce Setup

The provider uses API version `v60.0`. It does not implement an automatic token refresh: rotate the token externally and update `config.env` when it expires.

## Verify the connection

```bash
construct provider test salesforce
```

A healthy response confirms the instance URL is reachable and the token is valid.

## Usage

### Read a record

Fetch a single record by object type and ID:

```
config.sobject = "Account"
config.id      = "0013000000AbCdEfG"
```

Returns the full sObject record. Both `sobject` and `id` are required for reads.

Valid `sobject` values: any standard or custom Salesforce object: `Account`, `Opportunity`, `Contact`, `Case`, `Lead`, `Custom__c`, etc.

### Search with SOQL

```
config.soql = "SELECT Id, Name, Industry, AnnualRevenue FROM Account WHERE Industry = 'Technology' ORDER BY AnnualRevenue DESC LIMIT 50"
```

Returns the `records` array from the SOQL query result. Maximum result size is governed by Salesforce query limits, not by the provider.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SALESFORCE_INSTANCE_URL` | Yes | Your org's instance URL (no trailing slash) |
| `SALESFORCE_ACCESS_TOKEN` | Yes | Bearer token obtained via OAuth or SFDX |

## Common SOQL examples

| Goal | SOQL |
|---|---|
| Open opportunities by stage | `SELECT Id, Name, StageName, Amount FROM Opportunity WHERE IsClosed = false ORDER BY Amount DESC LIMIT 25` |
| Accounts in a region | `SELECT Id, Name, BillingState, Industry FROM Account WHERE BillingCountry = 'US' AND BillingState = 'CA'` |
| Cases opened this week | `SELECT Id, CaseNumber, Subject, Status FROM Case WHERE CreatedDate = THIS_WEEK` |
| Contacts for an account | `SELECT Id, FirstName, LastName, Email FROM Contact WHERE AccountId = '0013000000AbCdEfG'` |
| Custom object records | `SELECT Id, Name, Status__c FROM Project__c WHERE Status__c = 'Active'` |

## Notes

- Record IDs are 15 or 18 characters, alphanumeric. The provider validates the format before making the request.
- SOQL field names are case-insensitive in queries but the API returns them with the casing defined in the object schema.
- The Salesforce REST API returns relationship objects as nested records. Dot-notation traversal in SOQL works: `SELECT Account.Name FROM Contact`.
- For large result sets, use `LIMIT` in your SOQL to avoid hitting Salesforce governor limits.
