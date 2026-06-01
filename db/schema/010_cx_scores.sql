-- db/schema/010_cx_scores.sql — Per-trace quality score log + skill quality correlation view.
--
-- Backs `construct skills correlate-quality`.  Producer: lib/mcp/tools/telemetry.mjs
-- cxScore() writes a row here when CONSTRUCT_DB_URL (or DATABASE_URL) is set.
-- Local JSONL/observation paths remain primary in solo mode; this table is
-- primary in team/enterprise mode where multiple agents share a session
-- timeline and the dashboard reads aggregate correlations.

create table if not exists construct_cx_scores (
  id           bigserial    primary key,
  ts           timestamptz  not null,
  trace_id     text         not null,
  session_id   text,
  agent_id     text,
  name         text         not null default 'quality',
  value        numeric      not null,
  comment      text
);

create index if not exists construct_cx_scores_trace_idx
  on construct_cx_scores (trace_id);

create index if not exists construct_cx_scores_session_ts_idx
  on construct_cx_scores (session_id, ts desc);

create index if not exists construct_cx_scores_agent_ts_idx
  on construct_cx_scores (agent_id, ts desc);

-- Skill quality correlation view: joins skill invocations and quality
-- scores by session_id so a reader can ask "for sessions where skill X was
-- invoked, what's the median / mean / p10 quality score?" The view is a
-- simple aggregate over the past 90 days; queries that need a longer
-- window can pull straight from the underlying tables. Materialised view
-- not used here because the correlation surface is small and the freshness
-- expectation is "current session" not "yesterday's batch."

create or replace view construct_skill_quality_correlation as
select
  inv.skill_id,
  count(distinct inv.session_id)                            as sessions,
  count(distinct sc.id)                                     as score_count,
  round(avg(sc.value)::numeric, 3)                          as mean_score,
  round((percentile_cont(0.5) within group (order by sc.value))::numeric, 3)  as median_score,
  round((percentile_cont(0.10) within group (order by sc.value))::numeric, 3) as p10_score,
  round((percentile_cont(0.90) within group (order by sc.value))::numeric, 3) as p90_score,
  max(sc.ts)                                                as last_scored_at
from construct_skill_invocations inv
  inner join construct_cx_scores sc on sc.session_id = inv.session_id
where inv.ts > now() - interval '90 days'
  and sc.ts  > now() - interval '90 days'
group by inv.skill_id;
