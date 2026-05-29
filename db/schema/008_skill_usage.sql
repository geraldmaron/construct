-- db/schema/008_skill_usage.sql — Per-skill invocation log.
--
-- Backs `construct skills usage/orphans/hot`.  The local
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
