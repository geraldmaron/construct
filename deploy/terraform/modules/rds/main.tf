# deploy/terraform/modules/rds/main.tf — PostgreSQL via RDS (single-AZ for staging, Multi-AZ for production).

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

locals {
  multi_az = var.environment == "production"
}

# ── Security group ─────────────────────────────────────────────────────────

resource "aws_security_group" "rds" {
  name        = "${var.name}-${var.environment}-rds"
  description = "Allow Postgres from ECS task SG only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_security_group]
    description     = "Postgres from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-${var.environment}-rds", Environment = var.environment }
}

# ── Subnet group ───────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-${var.environment}"
  subnet_ids = var.subnet_ids
  tags       = { Environment = var.environment }
}

# ── Parameter group ────────────────────────────────────────────────────────

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-${var.environment}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_connections"
    value = "1"
  }

  tags = { Environment = var.environment }
}

# ── RDS instance ───────────────────────────────────────────────────────────

data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = var.db_password_secret
}

resource "aws_db_instance" "this" {
  identifier        = "${var.name}-${var.environment}"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_encrypted = true
  storage_type      = "gp3"

  db_name  = replace("${var.name}_${var.environment}", "-", "_")
  username = "construct"
  password = data.aws_secretsmanager_secret_version.db_password.secret_string

  db_subnet_group_name   = aws_db_subnet_group.this.name
  parameter_group_name   = aws_db_parameter_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az               = local.multi_az
  publicly_accessible    = false
  skip_final_snapshot    = var.environment != "production"
  deletion_protection    = var.environment == "production"
  backup_retention_period = var.environment == "production" ? 7 : 1

  tags = { Name = "${var.name}-${var.environment}", Environment = var.environment }
}
