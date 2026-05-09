<!--
docs/deploy/aws.md — AWS Terraform deploy guide for Construct.

Covers prerequisites, terraform init/apply, what gets created, secret flow,
dashboard access, and CloudWatch logs.
-->

# AWS Deployment

Construct ships Terraform modules that deploy a single-tenant instance to AWS. The stack runs the Construct server (dashboard + MCP) on ECS Fargate, backed by RDS Postgres with pgvector.

## Prerequisites

- AWS CLI configured with credentials that can create VPCs, RDS, ECS, ALB, Secrets Manager resources, and Route53 records
- Terraform 1.6 or later
- Docker — to build and push the Construct image
- An ACM certificate for your dashboard hostname (or leave blank for HTTP-only)
- An ECR repository for the Construct image

## Build and push the image

```bash
# Build
docker build -t construct:latest .

# Push to ECR (substitute your account and region)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

docker tag construct:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/construct:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/construct:latest
```

## Deploy

```bash
cd deploy/terraform/environments/staging   # or production

# Create a terraform.tfvars file
cat > terraform.tfvars <<EOF
environment         = "staging"
image_uri           = "123456789.dkr.ecr.us-east-1.amazonaws.com/construct:latest"
hostname            = "construct-staging.example.com"
dashboard_token     = "your-secure-dashboard-token"
anthropic_api_key   = "sk-ant-..."
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/..."
EOF

terraform init
terraform plan
terraform apply
```

## What gets created

| Resource | Description |
|---|---|
| VPC | `/16` CIDR with public and private subnets across 2 AZs |
| RDS Postgres | `db.t4g.medium` (configurable) with `pgvector` extension, in private subnets |
| ECS Cluster + Service | Fargate task running the Construct server |
| Application Load Balancer | Public-facing, forwards HTTPS → ECS on port 4242 |
| Secrets Manager | Stores dashboard token, DB password, and Anthropic API key |
| IAM roles | Task role (Secrets Manager read) and execution role (ECR pull, CloudWatch logs) |
| Route53 record | A-record pointing your hostname at the ALB (optional — requires `route53_zone_id`) |
| CloudWatch log group | `construct-<environment>` — receives all ECS task stderr |

## How secrets flow

Secrets never appear in ECS task environment variables as plaintext. The flow:

1. `terraform apply` writes secrets to Secrets Manager
2. The ECS task definition references secrets by ARN using `secrets` (not `environment`)
3. ECS injects the secret values at container startup via the execution role
4. The Construct server reads them from `process.env`

To rotate a secret after deploy:

```bash
aws secretsmanager update-secret \
  --secret-id construct-staging-dashboard-token \
  --secret-string "new-token-value"

# Force ECS to pick up the new secret
aws ecs update-service --cluster construct-staging --service construct-staging --force-new-deployment
```

## Access the dashboard

After `terraform apply`, the ALB DNS name is output:

```
Outputs:
  alb_dns_name = "construct-staging-alb-123456789.us-east-1.elb.amazonaws.com"
  dashboard_url = "https://construct-staging.example.com"
```

Open the `dashboard_url` in a browser and authenticate with your `dashboard_token`.

## Configuration variables

| Variable | Default | Description |
|---|---|---|
| `environment` | (required) | `staging` or `production` |
| `aws_region` | `us-east-1` | AWS region |
| `vpc_cidr` | `10.0.0.0/16` | VPC CIDR block |
| `image_uri` | (required) | Full ECR image URI including tag |
| `task_cpu` | `512` | ECS task CPU units (512 = 0.5 vCPU) |
| `task_memory` | `1024` | ECS task memory in MB |
| `desired_count` | `1` | Number of ECS task replicas |
| `hostname` | (required) | FQDN for the dashboard |
| `route53_zone_id` | `""` | Route53 zone ID — omit to skip DNS automation |
| `acm_certificate_arn` | `""` | ACM cert ARN — omit for HTTP-only |
| `dashboard_token` | (required) | Dashboard auth token |
| `anthropic_api_key` | `""` | Anthropic API key for the container |

## CloudWatch logs

Logs are in the `construct-<environment>` log group, stream prefix `construct-<environment>/construct`.

View recent logs:

```bash
aws logs tail construct-staging --follow
```

Filter for errors:

```bash
aws logs filter-log-events \
  --log-group-name construct-staging \
  --filter-pattern '{ $.level = "error" }'
```

## Tear down

```bash
terraform destroy
```

This removes all resources including the RDS instance and its data. Export a backup first if you need to preserve the database:

```bash
construct backup create --include-secrets
```
