# Deploy

Cloud deployment guides for self-hosting Construct in team/shared-database mode.

- [AWS](./aws.md): Terraform modules, ECS/Fargate, RDS+pgvector, Secrets Manager, ALB
- [Azure](./azure.md): Container Apps, PostgreSQL Flexible Server+pgvector, Key Vault, Log Analytics
- [GCP](./gcp.md): Cloud Run, Cloud SQL Postgres+pgvector, Secret Manager, Cloud Logging

## Service equivalence

All three targets deliver the same team-mode capability set (per the deployment parity contract, `construct deployment parity`). The provider-specific services differ; the capability does not.

| Capability | AWS | Azure | GCP |
|------------|-----|-------|-----|
| Container runtime | ECS Fargate | Container Apps | Cloud Run v2 |
| PostgreSQL + pgvector | RDS PostgreSQL | PostgreSQL Flexible Server | Cloud SQL for PostgreSQL |
| Secret store | Secrets Manager | Key Vault | Secret Manager |
| Logs | CloudWatch | Log Analytics | Cloud Logging |
| Ingress | ALB + Route53 | Container Apps ingress | Cloud Run URL |

## Validation status

The AWS module is the reference and the furthest along; live AWS deploy validation is tracked by `construct-49j`. The Azure and GCP modules (`deploy/terraform/azure`, `deploy/terraform/gcp`) mirror the AWS capability set and **pass `terraform fmt` and `terraform validate`** against the `azurerm` and `google` provider schemas, but have **not** yet been applied to a live subscription/project — each has a live-apply follow-up bead (`construct-1fdp`, `construct-30z8`). Treat them as schema-valid starting points pending live validation, not as battle-tested infrastructure.
