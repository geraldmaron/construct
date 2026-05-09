<!--
skills/ai/ml-ops.md — ML Operations (MLOps) — ```

## The MLOps Lifecycle ```
-->
# ML Operations (MLOps)

## The MLOps Lifecycle

```
Data → Feature Engineering → Training → Evaluation → Registry → Deployment → Monitoring → (loop)
```

Each stage should be reproducible, versioned, and automated.

## Data Management

### Data versioning

Use **DVC** (Data Version Control) alongside git to version datasets and models:

```bash
dvc add data/training.csv        # track large file outside git
dvc push                         # push to remote storage (S3, GCS, Azure)
git add data/training.csv.dvc    # commit the pointer
```

### Feature stores

For team-shared features or online serving:
- **Feast** (open source): offline (data warehouse) + online (Redis/DynamoDB) store
- **Tecton**, **Hopsworks** for managed options

Feature pipelines should be:
1. Deterministic (same input → same output)
2. Backfillable (can recompute historical features)
3. Point-in-time correct (no future data leakage)

## Experiment Tracking

Use **MLflow** or **Weights & Biases** to log:

```python
import mlflow

with mlflow.start_run(run_name="baseline-xgb"):
  mlflow.log_params({"max_depth": 6, "n_estimators": 100})
  model.fit(X_train, y_train)
  metrics = evaluate(model, X_val, y_val)
  mlflow.log_metrics(metrics)
  mlflow.sklearn.log_model(model, "model")
```

Minimum to log per experiment: hyperparameters, dataset version/hash, evaluation metrics, model artifact.

## Training Pipelines

### Pipeline orchestration

Use **Kubeflow Pipelines**, **Prefect**, **Airflow**, or **ZenML**:

```python
@pipeline
def training_pipeline():
  data = ingest_data()
  features = engineer_features(data)
  model = train_model(features)
  evaluate_model(model, features)
  push_to_registry(model)
```

- Each step is a containerized function with explicit inputs/outputs
- Cache step outputs to avoid re-running expensive transformations
- Use hardware-specific steps (GPU) only where necessary

### Reproducibility requirements

- Pin library versions (`requirements.txt` or `conda.yml` locked)
- Log random seeds
- Log git commit hash with the run
- Use deterministic data splits (fixed random seed, or pre-split stored files)

## Model Registry

Central store for model versions and deployment state:

| Stage | Meaning |
|---|---|
| Staging | Candidate — passes evaluation, not yet in production |
| Production | Currently serving |
| Archived | Superseded |

MLflow Model Registry, SageMaker Model Registry, or Vertex AI Model Registry all follow this pattern.

## Deployment Patterns

### Online serving (real-time inference)

- **Containerize** the model + serving code: `docker build -t model-server .`
- **Serve** via FastAPI / Triton Inference Server / TorchServe
- **Deploy** to Kubernetes with horizontal pod autoscaling on GPU/CPU utilization

```python
# FastAPI serving example
@app.post("/predict")
async def predict(req: PredictRequest) -> PredictResponse:
  features = feature_pipeline(req.input)
  score = model.predict(features)
  return PredictResponse(score=score)
```

### Batch inference

- Schedule periodic jobs (Airflow, Prefect) to score datasets
- Write results to a data warehouse or feature store
- Use Spark for large-scale batch scoring

### A/B testing / Shadow mode

- **Shadow mode**: new model receives traffic and logs predictions but does not serve users — validate before switching
- **A/B test**: split traffic (e.g., 10% new model) and measure business metrics, not just accuracy
- Use a feature flag system to control routing

## Monitoring

### What to monitor

| Signal | Why |
|---|---|
| Prediction distribution | Detect output drift |
| Feature distribution | Detect input drift (data pipeline change) |
| Model latency (p50, p95, p99) | SLO compliance |
| Error rate / null predictions | Serving failures |
| Business metric (CTR, revenue) | Downstream impact |

### Drift detection

```python
from evidently.report import Report
from evidently.metric_preset import DataDriftPreset

report = Report(metrics=[DataDriftPreset()])
report.run(reference_data=reference_df, current_data=production_df)
report.save_html("drift_report.html")
```

Tools: **Evidently**, **WhyLogs**, **Seldon Alibi Detect**.

Trigger retraining when:
- Statistical drift test fails (KS test, PSI > 0.2)
- Business metric degrades below threshold for N consecutive periods
- Scheduled periodic retraining cadence (baseline)

## Infrastructure

- **Container registry**: ECR, GCR, GHCR
- **Object storage**: S3/GCS for datasets, model artifacts, logs
- **Feature store**: Redis (online), BigQuery/Snowflake (offline)
- **Orchestration**: Kubeflow, Airflow, Prefect, Vertex Pipelines
- **Serving**: Kubernetes + Knative / SageMaker Endpoints / Vertex AI Endpoints
- **Monitoring**: Prometheus + Grafana for infrastructure; Evidently/WhyLogs for model health

## Common Pitfalls

- **Training-serving skew**: feature engineering in training differs from serving — solve with a shared feature pipeline
- **Data leakage**: future information in training features inflates metrics — use strict temporal splits
- **Model staleness without detection**: set up drift monitoring day 1, not after the model degrades
- **No rollback plan**: always keep N-1 model version in registry and test rollback procedure
- **GPU waste**: jobs that could run on CPU scheduled on GPU — profile resource usage
