# deploy/terraform/environments/staging/terraform.tfvars
# Copy to terraform.tfvars.local and fill in sensitive values.
# Never commit terraform.tfvars.local — it is gitignored.

name        = "construct"
environment = "staging"
aws_region  = "us-east-1"
vpc_cidr    = "10.0.0.0/16"

# Set to your ECR image URI after first `docker build && docker push`
image_uri = "REPLACE_WITH_ECR_IMAGE_URI"

task_cpu      = 256
task_memory   = 512
desired_count = 1

# Set to your Route53 zone ID and desired hostname
route53_zone_id     = ""
hostname            = "construct-staging.example.com"
acm_certificate_arn = ""

# Sensitive — set via TF_VAR_dashboard_token env var or .tfvars.local
# dashboard_token   = ""
# anthropic_api_key = ""
