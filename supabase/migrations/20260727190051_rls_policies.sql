-- Row level security: public read, no public write.
--
-- The app reads with the anon/publishable key, so a bug in a route handler cannot write to
-- benchmark data. All writes go through scripts/import-results.ts with the service key,
-- which bypasses RLS. There are deliberately no insert/update/delete policies.
--
-- sites.answer_substring is readable by anyone holding the anon key. That is intended: the
-- answer key is already rendered publicly on /site/[slug], and a checkable pre-registration
-- record is the point (docs/METHODOLOGY.md).

alter table public.sites              enable row level security;
alter table public.lighthouse_results enable row level security;
alter table public.agent_runs         enable row level security;

create policy "public read sites"
  on public.sites for select to anon, authenticated using (true);

create policy "public read lighthouse_results"
  on public.lighthouse_results for select to anon, authenticated using (true);

create policy "public read agent_runs"
  on public.agent_runs for select to anon, authenticated using (true);
