# deploy/terraform/environments/production/terraform.tfvars

name        = "construct"
environment = "production"
aws_region  = "us-east-1"
vpc_cidr    = "10.1.0.0/16"

image_uri = "REPLACE_WITH_ECR_IMAGE_URI"

task_cpu      = 512
task_memory   = 1024
desired_count = 2

route53_zone_id     = ""
hostname            = "construct.example.com"
acm_certificate_arn = ""

# dashboard_token   = ""
# anthropic_api_key = ""
