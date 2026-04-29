variable "name"               { type = string }
variable "environment"        { type = string }
variable "vpc_id"             { type = string }
variable "public_subnet_ids"  { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "image_uri"          { type = string }
variable "task_role_arn"      { type = string }
variable "execution_role_arn" { type = string }
variable "secrets_arns"       { type = list(string) }
variable "db_host"            { type = string }
variable "db_name"            { type = string }
variable "port"               { type = number; default = 4242 }
variable "cpu"                { type = number; default = 512 }
variable "memory"             { type = number; default = 1024 }
variable "desired_count"      { type = number; default = 1 }
variable "certificate_arn"    { type = string; default = "" }
