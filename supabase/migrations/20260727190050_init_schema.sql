-- AgentRank core schema.
--
-- Contract:  lib/types.ts  (frozen; changes are a James decision)
-- Design:    docs/ARCHITECTURE.md
-- Rules:     docs/METHODOLOGY.md  (pre-registered, append-only)
--
-- Result tables are append-only, keyed by (site, batch_label): a re-run writes a new batch
-- instead of overwriting one that cost money to produce. lib/dataset.ts names the batch the
-- frontend reads.

-- ---------------------------------------------------------------------------
-- sites — pre-registered cohort config, mirrors data/cohort.csv (canonical, 28 rows)
-- ---------------------------------------------------------------------------

create table public.sites (
  site_id          text primary key,
  name             text not null,
  -- Cohort taxonomy as it exists in data/cohort.csv. METHODOLOGY.md prose groups these
  -- differently ("seeded bottom"); the CSV is the source of truth.
  tier             text not null check (tier in
                     ('anchor', 'middle', 'government', 'small_business', 'off_diagonal', 'blocker')),
  start_url        text not null,   -- where the agent starts; navigation is part of the test
  question         text not null,   -- the per-site question; task shape is constant
  -- Pre-registered answer key. " | " separates any-of alternates (METHODOLOGY rule 6).
  -- Never passed into an agent prompt or task hint.
  answer_substring text not null,
  match_rule       text not null default '',   -- which normalization rules apply to this row
  flag             text not null default '',   -- cohort design note, e.g. "consent-wall obstacle"
  answer_note      text not null default '',
  created_at       timestamptz not null default now()
);

comment on table public.sites is
  'Pre-registered cohort config. Written before any run; mirrors data/cohort.csv.';

-- ---------------------------------------------------------------------------
-- lighthouse_results — Lane 1 (static x-axis), one row per site per batch
-- ---------------------------------------------------------------------------

create table public.lighthouse_results (
  id                    bigint generated always as identity primary key,
  site_id               text not null references public.sites (site_id) on delete cascade,
  batch_label           text not null,
  lh_total              integer  not null check (lh_total between 0 and 100),
  lh_accessibility_tree smallint not null check (lh_accessibility_tree in (0, 1)),
  lh_layout_stability   smallint not null check (lh_layout_stability   in (0, 1)),
  lh_llms_txt           smallint not null check (lh_llms_txt           in (0, 1)),
  lh_webmcp             smallint not null check (lh_webmcp             in (0, 1)),
  screenshot_path       text,
  run_at                timestamptz not null default now(),
  unique (site_id, batch_label)
);

create index lighthouse_results_site_idx  on public.lighthouse_results (site_id);
create index lighthouse_results_batch_idx on public.lighthouse_results (batch_label);

-- ---------------------------------------------------------------------------
-- agent_runs — Lane 2 (behavioral y-axis), one row per trial
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id               bigint generated always as identity primary key,
  site_id          text not null references public.sites (site_id) on delete cascade,
  -- agent_id exists so a multi-agent panel can be added without a schema break. Any change
  -- to the agent loop forks the dataset (new agent_id or batch_label), never amends it.
  agent_id         text not null,
  batch_label      text not null,
  trial_number     integer not null check (trial_number >= 1),
  success          boolean not null,
  step_count       integer not null check (step_count >= 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  -- Fixed enum from METHODOLOGY.md. Text + CHECK rather than a Postgres enum type, because
  -- `alter type ... add value` cannot run inside a migration transaction.
  failure_mode     text not null check (failure_mode in
                     ('success', 'blocked', 'timeout', 'wrong_extraction', 'navigation_stuck', 'error')),
  transcript       jsonb,           -- always stored; makes the failure label auditable
  run_at           timestamptz not null default now(),
  unique (site_id, agent_id, batch_label, trial_number)
);

create index agent_runs_site_idx  on public.agent_runs (site_id);
create index agent_runs_batch_idx on public.agent_runs (batch_label, agent_id);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Newest Lighthouse batch per site, so a reader that does not care about batches can ignore
-- them. security_invoker keeps the caller's RLS in force rather than the view owner's.
create view public.lighthouse_latest with (security_invoker = true) as
  select distinct on (site_id) *
  from public.lighthouse_results
  order by site_id, run_at desc, id desc;

-- No leaderboard or correlation views on purpose: ARCHITECTURE.md pins aggregation at read
-- time in lib/queries.ts, so the lanes and the DB only ever hold raw facts.
