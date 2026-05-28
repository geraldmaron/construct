-- db/schema/008_skill_usage.sql — Per-skill invocation log and quality correlation view.
--
-- Backs `construct skills usage/orphans/hot/correlate-quality`.  The local
-- JSONL path (~/.cx/skill-calls.jsonl) is primary in solo mode; this table is
-- primary in team/enterprise mode.  One-time backfill via
-- `construct skills backfill-postgres`.

create table if not exists construct_skill_invocations (
  id           bigserial    primary key,
  ts           timestamptz  not null,
  skill_id     text         not null,
  source       text         not null,  -- 'mcp' | 'role-preload' | 'prompt-composer' | …
  agent_id     text,
  session_id   text,
  caller_context text,
  latency_ms   integer,
  tokens_returned integer
);

create index if not exists construct_skill_invocations_skill_ts_idx
  on construct_skill_invocations (skill_id, ts desc);

create index if not exists construct_skill_invocations_session_idx
  on construct_skill_invocations (session_id);

-- Correlation view: join skill calls with session quality scores.
-- construct_cx_scores must exist (created in 005_strategy.sql or equivalent).
create or replace view construct_skill_quality_correlation as
  select
    s.skill_id,
    count(distinct s.session_id)                                           as sessions,
    avg(q.cx_score)                                                        as avg_session_quality,
    percentile_cont(0.5) within group (order by q.cx_score)               as median_quality
  from construct_skill_invocations s
  join construct_cx_scores q on q.session_id = s.session_id
  group by s.skill_id;
