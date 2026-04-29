# deploy/terraform/variables.tf — Root variables shared across all modules.

variable "name" {
  description = "Base name for all resources (e.g. 'construct')"
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

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "image_uri" {
  description = "Full ECR image URI including tag (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/construct:latest)"
  type        = string
}

variable "task_cpu" {
  description = "ECS task CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "ECS task memory in MB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS task replicas"
  type        = number
  default     = 1
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for DNS records. Leave empty to skip DNS."
  type        = string
  default     = ""
}

variable "hostname" {
  description = "FQDN for the dashboard (e.g. construct.example.com)"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on the ALB. Must cover var.hostname."
  type        = string
  default     = ""
}

variable "dashboard_token" {
  description = "CONSTRUCT_DASHBOARD_TOKEN value. Stored in Secrets Manager."
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key for claude CLI auth. Stored in Secrets Manager."
  type        = string
  sensitive   = true
  default     = ""
}
