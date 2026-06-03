# deploy/terraform/azure/variables.tf — Construct on Azure, root variables.

variable "name" {
  description = "Base name for all resources"
  type        = string
  default     = "construct"
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "tenant_id" {
  description = "Azure AD tenant ID for Key Vault"
  type        = string
}

variable "image_uri" {
  description = "Full container image reference including tag (ACR or other registry)"
  type        = string
}

variable "task_cpu" {
  description = "Container vCPU (e.g. 0.5)"
  type        = number
  default     = 0.5
}

variable "task_memory" {
  description = "Container memory (e.g. '1Gi')"
  type        = string
  default     = "1Gi"
}

variable "desired_count" {
  description = "Replica count (min and max held equal for a fixed-size deployment)"
  type        = number
  default     = 1
}

variable "db_admin_login" {
  description = "PostgreSQL administrator login"
  type        = string
  default     = "construct"
}

variable "db_sku_name" {
  description = "PostgreSQL Flexible Server SKU"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "db_password" {
  description = "PostgreSQL administrator password"
  type        = string
  sensitive   = true
}

variable "dashboard_token" {
  description = "Dashboard auth token"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key"
  type        = string
  sensitive   = true
}
