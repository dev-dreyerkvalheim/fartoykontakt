-- Fartøykontakt — raskere analyse av synkroniseringen.
-- Nye rader i registry_staging har ingen statistikk ennå, og da velger Postgres en svært treg plan
-- (testet: over 60 sekunder mot 1 sekund med statistikk). Indeksene og en ANALYZE før analysen løser dette.
-- Kun tillegg: to indekser og én ny funksjon.

create index if not exists registry_staging_run_reg    on registry_staging (run_id, reg_nr);
create index if not exists registry_staging_run_vessel on registry_staging (run_id, vessel_id);

-- Kalles av Edge Function etter at radene er lagt inn, før registry_analyze
create or replace function registry_prepare(p_run bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from registry_runs where id = p_run and status = 'running') then perform _err('notfound'); end if;
  analyze registry_staging;
end $$;
revoke execute on function registry_prepare(bigint) from public, anon, authenticated;
grant execute on function registry_prepare(bigint) to service_role;
