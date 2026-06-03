# deploy/terraform/gcp/variables.tf — Construct on GCP, root variables.

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

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "image_uri" {
  description = "Full container image reference including tag (Artifact Registry or other)"
  type        = string
}

variable "task_cpu" {
  description = "Cloud Run CPU limit (e.g. '1')"
  type        = string
  default     = "1"
}

variable "task_memory" {
  description = "Cloud Run memory limit (e.g. '1Gi')"
  type        = string
  default     = "1Gi"
}

variable "desired_count" {
  description = "Instance count (min and max held equal for a fixed-size deployment)"
  type        = number
  default     = 1
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_user" {
  description = "PostgreSQL user"
  type        = string
  default     = "construct"
}

variable "db_password" {
  description = "PostgreSQL user password"
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
