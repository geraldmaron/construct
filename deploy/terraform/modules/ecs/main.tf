# deploy/terraform/modules/ecs/main.tf — ECS Fargate cluster, service, ALB.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

# ── Security groups ────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.name}-${var.environment}-alb"
  description = "Allow HTTP/HTTPS inbound to ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-${var.environment}-alb", Environment = var.environment }
}

resource "aws_security_group" "app" {
  name        = "${var.name}-${var.environment}-app"
  description = "Allow traffic from ALB to ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = var.port
    to_port         = var.port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "Dashboard port from ALB"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-${var.environment}-app", Environment = var.environment }
}

# ── CloudWatch log group ───────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}/${var.environment}"
  retention_in_days = 30
  tags              = { Environment = var.environment }
}

# ── ECS cluster ────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Environment = var.environment }
}

# ── Task definition ────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  task_role_arn            = var.task_role_arn
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([{
    name      = "construct"
    image     = var.image_uri
    essential = true

    portMappings = [{ containerPort = var.port, protocol = "tcp" }]

    environment = [
      { name = "PORT",      value = tostring(var.port) },
      { name = "NODE_ENV",  value = "production" },
      { name = "DB_HOST",   value = var.db_host },
      { name = "DB_NAME",   value = var.db_name },
      { name = "DB_USER",   value = "construct" },
    ]

    secrets = [for arn in var.secrets_arns : {
      name      = "SECRET_${index(var.secrets_arns, arn)}"
      valueFrom = arn
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "ecs"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -fs http://localhost:${var.port}/api/auth/status || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }
  }])

  tags = { Environment = var.environment }
}

data "aws_region" "current" {}

# ── ALB ────────────────────────────────────────────────────────────────────

resource "aws_lb" "this" {
  name               = "${var.name}-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  tags = { Environment = var.environment }
}

resource "aws_lb_target_group" "this" {
  name        = "${var.name}-${var.environment}"
  port        = var.port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/auth/status"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = { Environment = var.environment }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

# Fallback HTTP listener when no cert provided (dev/internal use)
resource "aws_lb_listener" "http_direct" {
  count             = var.certificate_arn == "" ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

# ── ECS service ────────────────────────────────────────────────────────────

resource "aws_ecs_service" "this" {
  name            = "${var.name}-${var.environment}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = "construct"
    container_port   = var.port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  tags = { Environment = var.environment }

  depends_on = [aws_lb_listener.http]
}
