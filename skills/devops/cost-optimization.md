<!--
skills/devops/cost-optimization.md — Cloud Cost Optimization — Use this skill when reducing cloud spend, right-sizing resources, or implementin

Use this skill when reducing cloud spend, right-sizing resources, or implementing FinOps practices. ## Cost Visibility
-->
# Cloud Cost Optimization

Use this skill when reducing cloud spend, right-sizing resources, or implementing FinOps practices.

## Cost Visibility

### Tagging Strategy
- Mandatory tags: team, service, environment, cost-center
- Enforce tagging via policy-as-code; block untagged resource creation
- Use consistent naming across providers
- Tag ephemeral resources (CI runners, dev environments) for cleanup automation

### Cost Allocation
- Map spend to teams, services, and features
- Separate shared infrastructure costs (networking, logging, security) and distribute fairly
- Track unit economics: cost per request, cost per user, cost per transaction
- Report weekly to team leads; monthly to leadership

### Tooling
- Cloud provider native: AWS Cost Explorer, GCP Billing, Azure Cost Management
- Third-party: Infracost, Kubecost, CloudHealth, Spot.io
- FinOps dashboards visible to engineering teams, not just finance

## Right-Sizing

### Compute
- Analyze CPU and memory utilization over 2+ weeks
- Target 60-70% average utilization for steady-state
- Downsize instances with <30% average utilization
- Use burstable instances (T-series, e2-micro) for variable workloads
- Auto-scale based on demand; avoid over-provisioning for peaks

### Database
- Match instance class to actual query load
- Use read replicas only when read traffic justifies the cost
- Consider serverless options (Aurora Serverless, DynamoDB on-demand) for variable loads
- Archive cold data to cheaper storage tiers
- Right-size connection pools to reduce idle connections

### Storage
- Lifecycle policies: move to infrequent access after 30 days, archive after 90, delete after retention
- Compress data before storage
- Deduplicate where applicable
- Delete orphaned volumes, snapshots, and unused images
- Monitor storage growth; alert on unexpected spikes

## Commitment Strategies

### Reserved Instances / Savings Plans
- Commit to 1-year for stable baseline workloads
- Cover 60-70% of steady-state with commitments
- Leave headroom for growth and experimentation
- Review utilization monthly; exchange underused reservations
- Use convertible reservations when instance types may change

### Spot/Preemptible Instances
- Use for fault-tolerant, stateless workloads: CI/CD, batch processing, dev environments
- Implement graceful handling of interruptions
- Diversify across instance types and availability zones
- Savings: 60-90% compared to on-demand

## Architecture Cost Patterns

### Scale to Zero
- Serverless functions for infrequent or variable workloads
- Scale Kubernetes deployments to zero during off-hours
- Shut down development environments outside business hours
- Use spot instances for non-production environments

### Efficient Data Transfer
- Minimize cross-region and cross-AZ traffic
- Use VPC endpoints for AWS service communication
- Compress payloads between services
- Cache at the edge to reduce origin traffic
- Consolidate API calls; avoid chatty microservice communication

### Storage Tiering
- Hot: SSD, high IOPS for active data
- Warm: standard storage for recent data
- Cold: infrequent access for archived data
- Glacier/Archive: long-term compliance retention
- Automate transitions with lifecycle policies

## Waste Elimination

- Idle resources: instances running with no traffic
- Orphaned resources: unattached volumes, unused elastic IPs, stale snapshots
- Over-provisioned resources: 4 CPUs allocated, 0.5 used
- Redundant data: multiple copies without retention policy
- Unused features: load balancers, NAT gateways, reserved capacity not utilized

## FinOps Process

1. **Inform**: visibility into who spends what
2. **Optimize**: right-size, commit, eliminate waste
3. **Operate**: continuous monitoring, budget alerts, anomaly detection
- Set budget alerts at 80% and 100% of monthly target
- Anomaly detection for unexpected spend spikes
- Review optimization recommendations weekly
- Track cost efficiency trends month-over-month
