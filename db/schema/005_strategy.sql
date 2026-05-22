-- 005_strategy.sql — Product strategy store for team and enterprise mode.
-- Solo mode uses ~/.cx/strategy.md instead.
--
-- Each row is an immutable version snapshot. The latest version for a project
-- is the row with the highest version number (or max updated_at when equal).
-- Callers insert a new row on each write; old versions are retained for history.

create table if not exists construct_strategy (
  id bigserial primary key,
  project text not null,
  content text not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create unique index if not exists construct_strategy_project_version_idx
  on construct_strategy (project, version);

create index if not exists construct_strategy_project_updated_at_idx
  on construct_strategy (project, updated_at desc);
