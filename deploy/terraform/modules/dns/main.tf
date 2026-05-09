# deploy/terraform/modules/dns/main.tf — Route53 A-alias record pointing to ALB.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_route53_record" "this" {
  count   = var.zone_id != "" ? 1 : 0
  zone_id = var.zone_id
  name    = var.hostname
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
