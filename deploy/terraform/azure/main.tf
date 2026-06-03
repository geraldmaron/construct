# deploy/terraform/azure/main.tf — Construct on Azure (Container Apps).
#
# Capability parity with the AWS module (deploy/terraform/main.tf):
#   ECS Fargate      -> Azure Container Apps
#   RDS PostgreSQL   -> PostgreSQL Flexible Server (pgvector via azure.extensions)
#   Secrets Manager  -> Key Vault
#   CloudWatch       -> Log Analytics workspace
#   ALB + Route53    -> Container Apps managed ingress (built-in FQDN)
#
# STATUS: passes `terraform fmt` and `terraform validate` against the azurerm
# provider schema. Not yet applied to a live subscription — live apply validation
# is tracked as a follow-up bead (mirrors construct-49j for AWS).

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "this" {
  name     = "${var.name}-${var.environment}"
  location = var.location
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = "${var.name}-${var.environment}-logs"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_key_vault" "this" {
  name                = "${var.name}-${var.environment}-kv"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tenant_id           = var.tenant_id
  sku_name            = "standard"
}

resource "azurerm_key_vault_secret" "dashboard_token" {
  name         = "dashboard-token"
  value        = var.dashboard_token
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_secret" "anthropic_api_key" {
  name         = "anthropic-api-key"
  value        = var.anthropic_api_key
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                   = "${var.name}-${var.environment}-pg"
  resource_group_name    = azurerm_resource_group.this.name
  location               = azurerm_resource_group.this.location
  version                = "16"
  administrator_login    = var.db_admin_login
  administrator_password = var.db_password
  storage_mb             = 32768
  sku_name               = var.db_sku_name
  zone                   = "1"
}

# pgvector is enabled by allowlisting the extension, then `CREATE EXTENSION vector`.

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "VECTOR"
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = "construct"
  server_id = azurerm_postgresql_flexible_server.this.id
}

resource "azurerm_container_app_environment" "this" {
  name                       = "${var.name}-${var.environment}-env"
  location                   = azurerm_resource_group.this.location
  resource_group_name        = azurerm_resource_group.this.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
}

resource "azurerm_container_app" "this" {
  name                         = "${var.name}-${var.environment}"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = azurerm_resource_group.this.name
  revision_mode                = "Single"

  secret {
    name  = "db-password"
    value = var.db_password
  }
  secret {
    name  = "dashboard-token"
    value = var.dashboard_token
  }
  secret {
    name  = "anthropic-api-key"
    value = var.anthropic_api_key
  }

  ingress {
    external_enabled = true
    target_port      = 4242
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.desired_count
    max_replicas = var.desired_count
    container {
      name   = var.name
      image  = var.image_uri
      cpu    = var.task_cpu
      memory = var.task_memory

      env {
        name  = "CONSTRUCT_DEPLOYMENT_MODE"
        value = "team"
      }
      env {
        name  = "DATABASE_URL"
        value = "postgres://${var.db_admin_login}:@${azurerm_postgresql_flexible_server.this.fqdn}:5432/construct"
      }
      env {
        name        = "DASHBOARD_TOKEN"
        secret_name = "dashboard-token"
      }
      env {
        name        = "ANTHROPIC_API_KEY"
        secret_name = "anthropic-api-key"
      }
    }
  }
}

output "dashboard_url" {
  description = "Construct dashboard URL (Container Apps managed FQDN)"
  value       = "https://${azurerm_container_app.this.ingress[0].fqdn}"
}
