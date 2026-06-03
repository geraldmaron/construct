# deploy/terraform/gcp/main.tf — Construct on GCP (Cloud Run).
#
# Capability parity with the AWS module (deploy/terraform/main.tf):
#   ECS Fargate      -> Cloud Run v2 service
#   RDS PostgreSQL   -> Cloud SQL for PostgreSQL (pgvector via CREATE EXTENSION)
#   Secrets Manager  -> Secret Manager
#   CloudWatch       -> Cloud Logging (automatic for Cloud Run)
#   ALB + Route53    -> Cloud Run managed URL
#
# STATUS: passes `terraform fmt` and `terraform validate` against the google
# provider schema. Not yet applied to a live project — live apply validation is
# tracked as a follow-up bead (mirrors construct-49j for AWS).

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_sql_database_instance" "this" {
  name             = "${var.name}-${var.environment}-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier = var.db_tier
    ip_configuration {
      ipv4_enabled = true
    }
    # pgvector ships with Cloud SQL Postgres; enable with `CREATE EXTENSION vector`
    # after the instance is up (run from the migration step).
    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "off"
    }
  }
  deletion_protection = var.environment == "production"
}

resource "google_sql_database" "this" {
  name     = "construct"
  instance = google_sql_database_instance.this.name
}

resource "google_sql_user" "this" {
  name     = var.db_user
  instance = google_sql_database_instance.this.name
  password = var.db_password
}

resource "google_secret_manager_secret" "dashboard_token" {
  secret_id = "${var.name}-${var.environment}-dashboard-token"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "dashboard_token" {
  secret      = google_secret_manager_secret.dashboard_token.id
  secret_data = var.dashboard_token
}

resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "${var.name}-${var.environment}-anthropic-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "anthropic_api_key" {
  secret      = google_secret_manager_secret.anthropic_api_key.id
  secret_data = var.anthropic_api_key
}

resource "google_cloud_run_v2_service" "this" {
  name     = "${var.name}-${var.environment}"
  location = var.region

  template {
    scaling {
      min_instance_count = var.desired_count
      max_instance_count = var.desired_count
    }
    containers {
      image = var.image_uri
      ports {
        container_port = 4242
      }
      resources {
        limits = {
          cpu    = var.task_cpu
          memory = var.task_memory
        }
      }
      env {
        name  = "CONSTRUCT_DEPLOYMENT_MODE"
        value = "team"
      }
      env {
        name  = "DATABASE_URL"
        value = "postgres://${var.db_user}:@/construct?host=/cloudsql/${google_sql_database_instance.this.connection_name}"
      }
      env {
        name = "DASHBOARD_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.dashboard_token.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
}

output "dashboard_url" {
  description = "Construct dashboard URL (Cloud Run managed URL)"
  value       = google_cloud_run_v2_service.this.uri
}
