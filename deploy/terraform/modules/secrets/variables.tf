terraform {
  required_providers {
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }
}

variable "name"              { type = string }
variable "environment"       { type = string }
variable "dashboard_token"   { type = string; sensitive = true }
variable "anthropic_api_key" { type = string; sensitive = true; default = "" }
