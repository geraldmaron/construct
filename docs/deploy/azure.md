# Azure Deployment

Deploy Construct in team mode on Azure Container Apps with a PostgreSQL Flexible Server. Capability parity with the AWS guide; see the [service equivalence table](./README.md#service-equivalence).

> **Status:** the Terraform under `deploy/terraform/azure` passes `terraform fmt` and `terraform validate` against the `azurerm` provider schema, but has not yet been applied to a live subscription. Live-apply validation is tracked by `construct-1fdp` (mirrors `construct-49j` for AWS). Run a staging apply before production use.

## Prerequisites

- Azure CLI authenticated (`az login`) with rights to create resource groups, Container Apps, PostgreSQL Flexible Server, and Key Vault.
- Terraform >= 1.6.
- A container registry (ACR or other) holding the Construct image.

## Build and push the image

```bash
# Build
docker build -t construct:latest .

# Push to Azure Container Registry (substitute your registry)
az acr login --name <registry>
docker tag construct:latest <registry>.azurecr.io/construct:latest
docker push <registry>.azurecr.io/construct:latest
```

## Deploy

```bash
cd deploy/terraform/azure

# Create a terraform.tfvars
cat > terraform.tfvars <<'EOF'
environment       = "staging"
tenant_id         = "<azure-ad-tenant-id>"
image_uri         = "<registry>.azurecr.io/construct:latest"
db_password       = "<generated>"
dashboard_token   = "<generated>"
anthropic_api_key = "<key>"
EOF

terraform init
terraform apply
```

## What gets created

- A resource group `construct-<environment>`.
- A Container Apps environment wired to a Log Analytics workspace.
- A Container App running the Construct image on port 4242 with managed external ingress (HTTPS FQDN).
- A PostgreSQL Flexible Server (v16) with the `vector` extension allowlisted via `azure.extensions`, and a `construct` database.
- A Key Vault holding the dashboard token and Anthropic API key.

## Enable pgvector

After the server is up, connect and create the extension once:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Access the dashboard

`terraform output dashboard_url` prints the Container Apps FQDN. Authenticate with the dashboard token stored in Key Vault.

## Tear down

```bash
terraform destroy
```
