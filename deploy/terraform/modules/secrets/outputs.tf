output "dashboard_token_secret_arn" { value = aws_secretsmanager_secret.dashboard_token.arn }
output "db_password_secret_arn"     { value = aws_secretsmanager_secret.db_password.arn }
output "secret_arns" {
  value = compact([
    aws_secretsmanager_secret.dashboard_token.arn,
    aws_secretsmanager_secret.db_password.arn,
    length(aws_secretsmanager_secret.anthropic_api_key) > 0 ? aws_secretsmanager_secret.anthropic_api_key[0].arn : "",
  ])
}
