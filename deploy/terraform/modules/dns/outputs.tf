output "fqdn" {
  value = length(aws_route53_record.this) > 0 ? aws_route53_record.this[0].fqdn : var.alb_dns_name
}
