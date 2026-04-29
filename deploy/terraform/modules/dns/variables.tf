variable "name"            { type = string }
variable "environment"     { type = string }
variable "zone_id"         { type = string; default = "" }
variable "hostname"        { type = string }
variable "alb_dns_name"    { type = string }
variable "alb_zone_id"     { type = string }
variable "certificate_arn" { type = string; default = "" }
