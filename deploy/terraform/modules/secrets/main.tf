# deploy/terraform/modules/secrets/main.tf — Secrets Manager entries.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_secretsmanager_secret" "dashboard_token" {
  name        = "${var.name}/${var.environment}/dashboard-token"
  description = "Construct dashboard bearer token (CONSTRUCT_DASHBOARD_TOKEN)"
  tags        = { Environment = var.environment }
}

resource "aws_secretsmanager_secret_version" "dashboard_token" {
  secret_id     = aws_secretsmanager_secret.dashboard_token.id
  secret_string = var.dashboard_token
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  count       = var.anthropic_api_key != "" ? 1 : 0
  name        = "${var.name}/${var.environment}/anthropic-api-key"
  description = "Anthropic API key for claude CLI"
  tags        = { Environment = var.environment }
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  count         = var.anthropic_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.anthropic_api_key[0].id
  secret_string = var.anthropic_api_key
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db_password" {
  name        = "${var.name}/${var.environment}/db-password"
  description = "RDS database password for Construct"
  tags        = { Environment = var.environment }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db.result
}
