output "task_role_arn"        { value = aws_iam_role.task.arn }
output "execution_role_arn"   { value = aws_iam_role.execution.arn }
output "ecr_repository_url"   { value = aws_ecr_repository.this.repository_url }
