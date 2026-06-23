# GCP Deployment

Deploy Construct in team mode on Cloud Run with a Cloud SQL for PostgreSQL instance. Capability parity with the AWS guide; see the [service equivalence table](./README.md#service-equivalence).

> **Status:** the Terraform under `deploy/terraform/gcp` passes `terraform fmt` and `terraform validate` against the `google` provider schema, but has not yet been applied to a live project. Live-apply validation is tracked by `construct-30z8` (mirrors `construct-49j` for AWS). Run a staging apply before production use.

## Prerequisites

- `gcloud` authenticated with rights to create Cloud Run services, Cloud SQL instances, and Secret Manager secrets.
- Terraform >= 1.6, with the `google` provider.
- Artifact Registry (or another registry) holding the Construct image.
- The Cloud Run service account granted `roles/secretmanager.secretAccessor` and `roles/cloudsql.client`.

## Build and push the image

```bash
docker build -t construct:latest .
gcloud auth configure-docker <region>-docker.pkg.dev
docker tag construct:latest <region>-docker.pkg.dev/<project>/construct/construct:latest
docker push <region>-docker.pkg.dev/<project>/construct/construct:latest
```

## Deploy

```bash
cd deploy/terraform/gcp

cat > terraform.tfvars <<'EOF'
environment       = "staging"
project_id        = "<gcp-project-id>"
image_uri         = "<region>-docker.pkg.dev/<project>/construct/construct:latest"
db_password       = "<generated>"
dashboard_token   = "<generated>"
anthropic_api_key = "<key>"
EOF

terraform init
terraform apply
```

## What gets created

- A Cloud SQL for PostgreSQL 16 instance with a `construct` database and user.
- A Cloud Run v2 service running the Construct image on port 4242 with a managed HTTPS URL.
- Secret Manager secrets for the dashboard token and Anthropic API key, mounted into Cloud Run.
- Logs flow to Cloud Logging automatically.

## Enable pgvector

pgvector ships with Cloud SQL for PostgreSQL; create the extension once:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Access the dashboard

`terraform output dashboard_url` prints the Cloud Run URL. Authenticate with the dashboard token stored in Secret Manager.

## Tear down

```bash
terraform destroy
```
