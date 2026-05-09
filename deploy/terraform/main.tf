# deploy/terraform/main.tf — Root Terraform config.
# Composes all modules for a Construct deployment.
# Run from deploy/terraform/environments/staging or environments/production.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — configure backend per environment
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

# ── Modules ────────────────────────────────────────────────────────────────

module "vpc" {
  source      = "../modules/vpc"
  name        = var.name
  environment = var.environment
  cidr        = var.vpc_cidr
}

module "iam" {
  source      = "../modules/iam"
  name        = var.name
  environment = var.environment
}

module "secrets" {
  source           = "../modules/secrets"
  name             = var.name
  environment      = var.environment
  dashboard_token  = var.dashboard_token
  anthropic_api_key = var.anthropic_api_key
}

module "rds" {
  source             = "../modules/rds"
  name               = var.name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  app_security_group = module.ecs.app_security_group_id
  db_password_secret = module.secrets.db_password_secret_arn
}

module "ecs" {
  source               = "../modules/ecs"
  name                 = var.name
  environment          = var.environment
  vpc_id               = module.vpc.vpc_id
  public_subnet_ids    = module.vpc.public_subnet_ids
  private_subnet_ids   = module.vpc.private_subnet_ids
  image_uri            = var.image_uri
  task_role_arn        = module.iam.task_role_arn
  execution_role_arn   = module.iam.execution_role_arn
  dashboard_token_secret_arn   = module.secrets.dashboard_token_secret_arn
  db_password_secret_arn       = module.secrets.db_password_secret_arn
  anthropic_api_key_secret_arn = module.secrets.anthropic_api_key_secret_arn
  db_host              = module.rds.endpoint
  db_name              = module.rds.db_name
  port                 = 4242
  cpu                  = var.task_cpu
  memory               = var.task_memory
  desired_count        = var.desired_count
  certificate_arn      = var.acm_certificate_arn
}

module "dns" {
  source          = "../modules/dns"
  name            = var.name
  environment     = var.environment
  zone_id         = var.route53_zone_id
  hostname        = var.hostname
  alb_dns_name    = module.ecs.alb_dns_name
  alb_zone_id     = module.ecs.alb_zone_id
  certificate_arn = var.acm_certificate_arn
}

# ── Outputs ────────────────────────────────────────────────────────────────

output "dashboard_url" {
  description = "Construct dashboard URL"
  value       = "https://${var.hostname}"
}

output "alb_dns_name" {
  description = "ALB DNS name (for manual CNAME if Route53 not used)"
  value       = module.ecs.alb_dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing the Construct image"
  value       = module.iam.ecr_repository_url
}
