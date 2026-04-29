# Construct — Deployment Runbook

> **Audience**: Engineers deploying or operating a cloud instance of Construct.  
> **Scope**: AWS ECS/Fargate via Terraform. Single-container, multi-user, HTTPS.

---

## Prerequisites

| Tool | Min version | Install |
|------|-------------|---------|
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Terraform | 1.7+ | https://developer.hashicorp.com/terraform/install |
| AWS CLI | 2.x | https://aws.amazon.com/cli/ |
| `gh` CLI | 2.x | https://cli.github.com/ |

```bash
# Verify
docker --version && terraform --version && aws --version && gh --version
```

AWS credentials must have permissions for: ECR, ECS, EC2, RDS, Secrets Manager, IAM, Route53, ACM, CloudWatch.

---

## 1. First Deploy

### 1.1 Bootstrap Terraform state bucket

Terraform needs an S3 bucket + DynamoDB table for remote state. Create once:

```bash
aws s3 mb s3://construct-tfstate-<your-org> --region us-east-1
aws s3api put-bucket-versioning \
  --bucket construct-tfstate-<your-org> \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name construct-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Then update `deploy/terraform/environments/staging/backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket         = "construct-tfstate-<your-org>"
    key            = "construct/staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "construct-tfstate-lock"
    encrypt        = true
  }
}
```

### 1.2 Create ECR repository and push first image

```bash
# Create repo (one-time)
aws ecr create-repository --repository-name construct --region us-east-1

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
IMAGE_URI=<account-id>.dkr.ecr.us-east-1.amazonaws.com/construct:latest
docker build -t construct .
docker tag construct:latest "$IMAGE_URI"
docker push "$IMAGE_URI"
```

### 1.3 Configure tfvars

Copy and edit the staging vars:

```bash
cp deploy/terraform/environments/staging/terraform.tfvars \
   deploy/terraform/environments/staging/terraform.tfvars.local
```

Edit `terraform.tfvars.local` — required values:

| Variable | Description |
|----------|-------------|
| `image_uri` | ECR URI from step 1.2 |
| `route53_zone_id` | Your Route53 hosted zone ID |
| `hostname` | e.g. `construct-staging.example.com` |
| `acm_certificate_arn` | ACM cert ARN for the hostname (must be in us-east-1 for ALB) |

Sensitive values — pass as env vars, not in tfvars files:

```bash
export TF_VAR_dashboard_token="$(openssl rand -hex 32)"
export TF_VAR_anthropic_api_key="sk-ant-..."
```

### 1.4 Apply Terraform

```bash
cd deploy/terraform/environments/staging
terraform init
terraform plan -var-file=terraform.tfvars.local -out=tfplan
terraform apply tfplan
```

Terraform will output:
- `alb_dns_name` — ALB DNS (point your domain here if not using Route53)
- `ecs_cluster_name` — for monitoring
- `ecr_repository_url` — for CI/CD

---

## 2. Generate Dashboard Token

The dashboard token is set via Secrets Manager (Terraform provisions it). To rotate:

```bash
# Get the current secret ARN
terraform -chdir=deploy/terraform/environments/staging output -raw secrets_arn_dashboard_token

# Update the secret value
aws secretsmanager put-secret-value \
  --secret-id <arn-from-above> \
  --secret-string "$(openssl rand -hex 32)"

# Force ECS to pick up the new value by triggering a redeployment
aws ecs update-service \
  --cluster construct-staging \
  --service construct-staging \
  --force-new-deployment \
  --region us-east-1
```

Alternatively, use the local CLI (useful for self-hosted):

```bash
construct serve --token
# Prints generated token; persists to ~/.construct/config.env
```

---

## 3. Routine Deployment (image update)

```bash
# Build and push new image
IMAGE_URI=<account-id>.dkr.ecr.us-east-1.amazonaws.com/construct:<git-sha>
docker build -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

# Update image_uri in tfvars.local, then:
cd deploy/terraform/environments/staging
terraform apply -var-file=terraform.tfvars.local -auto-approve

# Or trigger via CI — see .github/workflows/deploy.yml
```

ECS uses a rolling deployment with a circuit breaker. Health check: `GET /api/auth/status` must return `200` within 30 s.

---

## 4. Environment Variables & Secrets

All config is injected at container start. Nothing is baked into the image.

| Variable | Source | Description |
|----------|--------|-------------|
| `CONSTRUCT_DASHBOARD_TOKEN` | Secrets Manager | Bearer token for dashboard auth |
| `ANTHROPIC_API_KEY` | Secrets Manager (optional) | Used by `claude` CLI inside container |
| `NODE_ENV` | ECS task env | Set to `production` — enables `0.0.0.0` bind |
| `PORT` | ECS task env | Default `4242` |
| `CONSTRUCT_DATA_DIR` | ECS task env | Mount point for persistent data |
| `WEBHOOK_SECRET_GITHUB` | Secrets Manager or env | HMAC secret for GitHub webhooks |
| `WEBHOOK_SECRET_SLACK` | Secrets Manager or env | Signing secret for Slack webhooks |

> Secrets Manager secrets are injected as environment variables by the ECS task definition (see `modules/ecs/main.tf`).

---

## 5. Webhook Configuration

After deploying, configure webhook endpoints in each provider:

### GitHub
Settings → Webhooks → Add webhook  
- Payload URL: `https://construct.example.com/api/webhooks/github`  
- Content type: `application/json`  
- Secret: value of `WEBHOOK_SECRET_GITHUB`  
- Events: Pull requests, Pushes, Issues

### Slack
Slack App settings → Event Subscriptions → Request URL  
- `https://construct.example.com/api/webhooks/slack`  
- Signing secret → set as `WEBHOOK_SECRET_SLACK`

### Jira
Project settings → Webhooks → Create  
- URL: `https://construct.example.com/api/webhooks/jira`  
- Events: Issue created/updated/transitioned

### Confluence
Space settings → Webhooks  
- URL: `https://construct.example.com/api/webhooks/confluence`

---

## 6. Rollback

### ECS rollback (revert to previous task definition)

```bash
# List task definition revisions
aws ecs list-task-definitions \
  --family-prefix construct-staging \
  --sort DESC \
  --region us-east-1

# Rollback to previous revision (e.g., revision 3)
aws ecs update-service \
  --cluster construct-staging \
  --service construct-staging \
  --task-definition construct-staging:3 \
  --region us-east-1
```

### Terraform rollback

If Terraform state is diverged, revert the ECR image URI in tfvars and re-apply.  
Do **not** run `terraform destroy` in production — it will delete the RDS instance.

---

## 7. Monitoring & Health

```bash
# Service status
aws ecs describe-services \
  --cluster construct-staging \
  --services construct-staging \
  --region us-east-1 \
  | jq '.services[0] | {status, runningCount, desiredCount, deployments}'

# Recent logs (last 50 lines)
aws logs get-log-events \
  --log-group-name /ecs/construct-staging \
  --log-stream-name "$(aws logs describe-log-streams \
    --log-group-name /ecs/construct-staging \
    --order-by LastEventTime --descending \
    --max-items 1 --query 'logStreams[0].logStreamName' --output text \
    --region us-east-1)" \
  --limit 50 \
  --region us-east-1 \
  | jq -r '.events[].message'

# Health check
curl -sf https://construct.example.com/api/auth/status
```

---

## 8. Destroying a Staging Environment

```bash
cd deploy/terraform/environments/staging
# Remove deletion protection from RDS first if set:
terraform apply -var-file=terraform.tfvars.local \
  -var="deletion_protection=false" -auto-approve
terraform destroy -var-file=terraform.tfvars.local
```

> **Never run `terraform destroy` against production without a verified RDS snapshot.**

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| ECS task won't start | Image pull fails | Check ECR permissions on task execution role |
| 401 on all dashboard routes | Token mismatch | Verify `CONSTRUCT_DASHBOARD_TOKEN` in Secrets Manager matches what you're sending |
| Health check failing | App not binding on `0.0.0.0` | Confirm `NODE_ENV=production` in task env |
| Webhooks returning 401 | Wrong HMAC secret | Rotate `WEBHOOK_SECRET_<PROVIDER>` and reconfigure in provider settings |
| `claude` CLI not found in container | Build issue | Verify `RUN npm install -g @anthropic-ai/claude-code` in Dockerfile succeeded |
| RDS connection refused | Security group | ECS task SG must be in `allowed_security_groups` for RDS module |
