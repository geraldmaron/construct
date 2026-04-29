variable "name"               { type = string }
variable "environment"        { type = string }
variable "vpc_id"             { type = string }
variable "subnet_ids"         { type = list(string) }
variable "app_security_group" { type = string }
variable "db_password_secret" { type = string }
variable "instance_class"     { type = string; default = "db.t4g.micro" }
variable "allocated_storage"  { type = number; default = 20 }
