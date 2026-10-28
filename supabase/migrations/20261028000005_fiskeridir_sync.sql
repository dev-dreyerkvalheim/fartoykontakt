-- Fartøykontakt — automatisk synkronisering med Fiskeridirektoratets fartøyregister.
--
-- Prinsipp: Fiskeridirektoratet eier fartøyets identitet (ID, navn, merke, kallesignal, mål, eiere).
-- Fartøykontakt eier kontaktinformasjonen (telefon, e-post, gamle numre, bekreftelser, tilganger).
-- Funksjonene her skriver ALDRI til bridge_phone, alt_phone, email, number_history, verifications,
-- memberships eller reports. Testene i tests/registry.test.mjs sjekker dette.
--
-- Kun tillegg: nye tabeller, kolonner og funksjoner. Ingen eksisterende tabeller slettes eller bygges om.
-- Kilde: https://api.fiskeridir.no/vessel-api/api/v1/vessels (åpent API, NLOD). Hentes av Edge Function
-- «registry-sync», som sender ferdig vasket data hit med service-rollen.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- Normalisering for søk
-- Samme regler som i nettleseren: æ→ae, ø→o, å→a, aksenter fjernes, bare a–z og 0–9 beholdes.
create or replace function norm_words(t text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
    translate(replace(lower(coalesce(t, '')), 'æ', 'ae'), 'øåäöüéèêëáàâíìîóòôúùûçñ', 'oaaoueeeeaaaiiiooouuucn'),
    '[^a-z0-9]+', ' ', 'g'))
$$;
create or replace function norm_compact(t text) returns text
language sql immutable set search_path = public as $$
  select replace(norm_words(t), ' ', '')
$$;

-- ---------------------------------------------------------------- Nye felt
-- Registerfelt fra API-et (bare felt som finnes i den offisielle OpenAPI-spesifikasjonen)
alter table vessels add column if not exists municipality_code   text;
alter table vessels add column if not exists tonnage             numeric;
alter table vessels add column if not exists tonnage_type        text;
alter table vessels add column if not exists rebuild_year        int;
alter table vessels add column if not exists engine_build_year   int;
alter table vessels add column if not exists measure_date        date;
-- Status i registeret. 'missing' = ikke med i siste fullstendige uttrekk. Fartøyet slettes aldri automatisk.
alter table vessels add column if not exists registry_status     text not null default 'active';
alter table vessels add column if not exists registry_first_seen timestamptz;
alter table vessels add column if not exists registry_last_seen  timestamptz;   -- settes når fartøyet forsvinner
alter table vessels add column if not exists registry_changed_at timestamptz;   -- siste endring i registerfelt
do $$ begin
  alter table vessels add constraint vessels_registry_status_check check (registry_status in ('active','missing'));
exception when duplicate_object then null; end $$;

-- Søkefelt (genereres av databasen)
alter table vessels   add column if not exists search_name     text generated always as (norm_compact(name)) stored;
alter table vessels   add column if not exists search_words    text generated always as (norm_words(name)) stored;
alter table vessels   add column if not exists search_callsign text generated always as (norm_compact(callsign)) stored;
alter table vessels   add column if not exists search_reg      text generated always as (norm_compact(reg_nr)) stored;
alter table companies add column if not exists search_name     text generated always as (norm_compact(name)) stored;
create index if not exists vessels_search_name_prefix on vessels (search_name text_pattern_ops);
create index if not exists vessels_search_callsign    on vessels (search_callsign text_pattern_ops);
create index if not exists vessels_search_reg         on vessels (search_reg text_pattern_ops);
create index if not exists vessels_search_name_trgm   on vessels using gin (search_name extensions.gin_trgm_ops);
create index if not exists companies_search_name      on companies (search_name text_pattern_ops);
create index if not exists vessels_company            on vessels (company_id);

-- Hvilket fartøy en tilgangssøknad gjelder (valgfritt)
alter table access_requests add column if not exists vessel_id text references vessels(id) on delete set null;

-- ---------------------------------------------------------------- Tabeller
-- Kildebevisst identitet: (register, ekstern ID) → fartøy. Klar for flere registre, f.eks. Sjøfartsdirektoratet.
create table if not exists vessel_identifiers (
  register    text not null check (register in ('fiskeridir','sdir')),
  external_id text not null,
  vessel_id   text not null references vessels(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (register, external_id),
  unique (vessel_id, register),
  -- FARTOY_ID er 10 siffer og lagres som tekst, så ledende nuller aldri går tapt
  constraint vessel_identifiers_fiskeridir_format check (register <> 'fiskeridir' or external_id ~ '^\d{10}$')
);

-- Registrerte eiere (offisielle). Adskilt fra vessels.company_id, som er rederiet som forvalter fartøyet
-- i Fartøykontakt og styrer tilgang. Personer lagres uten navn eller ID.
create table if not exists vessel_owners (
  vessel_id  text not null references vessels(id) on delete cascade,
  register   text not null,
  position   int  not null,
  owner_type text not null check (owner_type in ('COMPANY','PERSON')),
  orgnr      text check (orgnr is null or orgnr ~ '^\d{9}$'),
  company_id text references companies(id),
  primary key (vessel_id, register, position),
  check ((owner_type = 'COMPANY') = (orgnr is not null))
);
create index if not exists vessel_owners_orgnr on vessel_owners (orgnr);

create table if not exists registry_runs (
  id           bigint generated always as identity primary key,
  register     text not null default 'fiskeridir',
  mode         text not null check (mode in ('preview','apply')),
  trigger      text not null check (trigger in ('manual','schedule')),
  status       text not null default 'running' check (status in ('running','preview_ready','completed','failed','superseded')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  heartbeat_at timestamptz not null default now(),
  started_by   uuid,
  approved_by  uuid,
  source_url   text,
  source_total int,
  fetched      int not null default 0,
  counts       jsonb not null default '{}'::jsonb,
  error        text
);
-- Bare én kjøring om gangen per register
create unique index if not exists registry_runs_one_running on registry_runs (register) where status = 'running';

create table if not exists registry_staging (
  run_id            bigint not null references registry_runs(id) on delete cascade,
  external_id       text not null check (external_id ~ '^\d{10}$'),
  name              text not null,
  reg_nr            text not null,
  callsign          text,
  municipality_code text,
  municipality      text,
  length            text,
  width             text,
  tonnage           numeric,
  tonnage_type      text,
  engine_power      int,
  build_year        int,
  rebuild_year      int,
  engine_build_year int,
  register_date     date,
  measure_date      date,
  imo               text,
  owners            jsonb not null default '[]'::jsonb,   -- [{type:'COMPANY', orgnr, name, postalCode, city} | {type:'PERSON'}]
  -- fylles av registry_analyze
  action            text,            -- matched | link | new | ambiguous
  vessel_id         text,
  note              text,
  candidates        jsonb,
  changed           boolean,
  owners_changed    boolean,
  new_company       text,
  manager_change    text,            -- auto | review
  primary key (run_id, external_id)
);

create table if not exists registry_reviews (
  id               bigint generated always as identity primary key,
  register         text not null default 'fiskeridir',
  kind             text not null check (kind in ('owner_change','ambiguous_match','missing','validation')),
  external_id      text,
  vessel_id        text references vessels(id) on delete cascade,
  run_id           bigint references registry_runs(id) on delete set null,
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution       text,
  resolved_by      uuid,
  resolved_by_name text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Høyst én åpen sak per type og fartøy, så gjentatte synkroniseringer ikke lager duplikater
create unique index if not exists registry_reviews_open on registry_reviews (kind, coalesce(external_id, ''), coalesce(vessel_id, '')) where status = 'open';

-- Revisjonsspor for registerdata (skrives bare når noe faktisk endres)
create table if not exists registry_changes (
  id          bigint generated always as identity primary key,
  run_id      bigint references registry_runs(id) on delete set null,
  vessel_id   text references vessels(id) on delete cascade,
  external_id text,
  change      text not null check (change in ('created','linked','updated','owners','manager_changed','missing','reappeared','review_resolved')),
  details     jsonb not null default '{}'::jsonb,
  actor       uuid,
  at          timestamptz not null default now()
);
create index if not exists registry_changes_vessel on registry_changes (vessel_id, at desc);

-- Fartøy eid av privatpersoner kobles hit (finnes fra migrasjon 4)
insert into companies(id, name, orgnr, source) values ('privat', 'Privat eier', '000000000', 'system') on conflict do nothing;

-- ---------------------------------------------------------------- Tilgangsregler
alter table vessel_identifiers enable row level security;
alter table vessel_owners      enable row level security;
alter table registry_runs      enable row level security;
alter table registry_staging   enable row level security;
alter table registry_reviews   enable row level security;
alter table registry_changes   enable row level security;
drop policy if exists "plattform leser identiteter" on vessel_identifiers;
create policy "plattform leser identiteter" on vessel_identifiers for select using (is_platform_admin());
drop policy if exists "plattform leser eiere" on vessel_owners;
create policy "plattform leser eiere" on vessel_owners for select using (is_platform_admin());
drop policy if exists "plattform leser kjøringer" on registry_runs;
create policy "plattform leser kjøringer" on registry_runs for select using (is_platform_admin());
drop policy if exists "plattform leser saker" on registry_reviews;
create policy "plattform leser saker" on registry_reviews for select using (is_platform_admin());
drop policy if exists "plattform leser endringer" on registry_changes;
create policy "plattform leser endringer" on registry_changes for select using (is_platform_admin());
-- registry_staging: ingen regel, bare service-rollen og funksjonene leser den. Ingen skriveregler noe sted.

-- ---------------------------------------------------------------- Hjelpere
create or replace function _reg_fields_s(s registry_staging) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('name', s.name, 'reg_nr', s.reg_nr, 'callsign', s.callsign, 'length', s.length, 'width', s.width,
    'engine_power', s.engine_power, 'build_year', s.build_year, 'register_date', s.register_date, 'imo', s.imo,
    'municipality_code', s.municipality_code, 'municipality', s.municipality, 'tonnage', s.tonnage, 'tonnage_type', s.tonnage_type,
    'rebuild_year', s.rebuild_year, 'engine_build_year', s.engine_build_year, 'measure_date', s.measure_date)
$$;
create or replace function _reg_fields_v(v vessels) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('name', v.name, 'reg_nr', v.reg_nr, 'callsign', v.callsign, 'length', v.length, 'width', v.width,
    'engine_power', v.engine_power, 'build_year', v.build_year, 'register_date', v.register_date, 'imo', v.imo,
    'municipality_code', v.municipality_code, 'municipality', v.municipality, 'tonnage', v.tonnage, 'tonnage_type', v.tonnage_type,
    'rebuild_year', v.rebuild_year, 'engine_build_year', v.engine_build_year, 'measure_date', v.measure_date)
$$;
create or replace function _jsonb_diff(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('fra', a -> k, 'til', b -> k)), '{}'::jsonb)
  from jsonb_object_keys(b) k where (a -> k) is distinct from (b -> k)
$$;
-- Eiersignatur: «C:orgnr» per selskap og «P» per person, i registerets rekkefølge
create or replace function _owner_sig(o jsonb) returns text
language sql immutable set search_path = public as $$
  select string_agg(case when e ->> 'type' = 'COMPANY' then 'C:' || (e ->> 'orgnr') else 'P' end, ',' order by n)
  from jsonb_array_elements(coalesce(o, '[]'::jsonb)) with ordinality x(e, n)
$$;
create or replace function _vessel_owner_sig(p_vessel text, p_register text) returns text
language sql stable set search_path = public as $$
  select string_agg(case when owner_type = 'COMPANY' then 'C:' || orgnr else 'P' end, ',' order by position)
  from vessel_owners where vessel_id = p_vessel and register = p_register
$$;
-- Rederiet som skal forvalte fartøyet: første selskap blant de registrerte eierne, ellers «Privat eier»
create or replace function _primary_company(o jsonb) returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select coalesce((select c.id from companies c where c.orgnr = e ->> 'orgnr'), 'org-' || (e ->> 'orgnr'))
       from jsonb_array_elements(coalesce(o, '[]'::jsonb)) with ordinality x(e, n)
      where e ->> 'type' = 'COMPANY' and e ->> 'orgnr' ~ '^\d{9}$' order by n limit 1),
    'privat')
$$;
-- Er fartøyet «i bruk» i Fartøykontakt? Da flyttes det aldri automatisk til et annet rederi.
create or replace function _vessel_is_managed(p_vessel text, p_company_a text, p_company_b text) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from vessels where id = p_vessel and (bridge_phone is not null or alt_phone is not null or email is not null))
      or exists (select 1 from verifications where scope = 'vessel' and scope_id = p_vessel)
      or exists (select 1 from number_history where vessel_id = p_vessel)
      or exists (select 1 from reports where vessel_id = p_vessel and status = 'new')
      or exists (select 1 from memberships where company_id in (p_company_a, p_company_b) and company_id <> 'privat')
$$;
create or replace function _upsert_review(p_kind text, p_external text, p_vessel text, p_run bigint, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into registry_reviews(kind, external_id, vessel_id, run_id, details)
  values (p_kind, p_external, p_vessel, p_run, p_details)
  on conflict (kind, coalesce(external_id, ''), coalesce(vessel_id, '')) where status = 'open'
  do update set details = excluded.details, run_id = excluded.run_id, updated_at = now()
     where registry_reviews.details is distinct from excluded.details;
end $$;

-- ---------------------------------------------------------------- Kjøringer (kalles av Edge Function med service-rollen)
create or replace function registry_start_run(p_register text, p_mode text, p_trigger text, p_started_by uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_mode text := p_mode; v_id bigint;
begin
  if p_register not in ('fiskeridir') or p_mode not in ('preview','apply') or p_trigger not in ('manual','schedule') then perform _err('invalid'); end if;
  -- Kjøringer uten livstegn i 15 minutter regnes som avbrutt, så en krasj ikke låser synkroniseringen for alltid
  update registry_runs set status = 'failed', finished_at = now(), error = 'Avbrutt: ingen livstegn fra synkroniseringen'
   where register = p_register and status = 'running' and heartbeat_at < now() - interval '15 minutes';
  -- Første import må alltid forhåndsvises og godkjennes av en plattformadministrator
  if v_mode = 'apply' and not exists (select 1 from registry_runs where register = p_register and status = 'completed') then
    v_mode := 'preview';
  end if;
  begin
    insert into registry_runs(register, mode, trigger, started_by) values (p_register, v_mode, p_trigger, p_started_by) returning id into v_id;
  exception when unique_violation then perform _err('busy');
  end;
  return jsonb_build_object('id', v_id, 'mode', v_mode);
end $$;

create or replace function registry_set_source(p_run bigint, p_total int, p_url text) returns void
language sql security definer set search_path = public as $$
  update registry_runs set source_total = p_total, source_url = p_url, heartbeat_at = now() where id = p_run and status = 'running';
$$;

create or replace function registry_heartbeat(p_run bigint, p_fetched int) returns void
language sql security definer set search_path = public as $$
  update registry_runs set fetched = p_fetched, heartbeat_at = now() where id = p_run and status = 'running';
$$;

create or replace function registry_fail_run(p_run bigint, p_error text) returns void
language sql security definer set search_path = public as $$
  update registry_runs set status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'Ukjent feil'), 500)
   where id = p_run and status = 'running';
$$;

-- Tar imot en bunt vaskede rader. Ugyldige rader avvises av databasen (CHECK), duplikater telles.
create or replace function registry_stage(p_run bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_in int; n_ok int;
begin
  if not exists (select 1 from registry_runs where id = p_run and status = 'running') then perform _err('notfound'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then perform _err('invalid'); end if;
  n_in := jsonb_array_length(p_rows);
  with ins as (
    insert into registry_staging(run_id, external_id, name, reg_nr, callsign, municipality_code, municipality, length, width,
      tonnage, tonnage_type, engine_power, build_year, rebuild_year, engine_build_year, register_date, measure_date, imo, owners)
    select p_run, r ->> 'id', left(r ->> 'name', 120), r ->> 'regNr', nullif(r ->> 'callsign', ''), nullif(r ->> 'municipalityCode', ''),
      nullif(r ->> 'municipality', ''), nullif(r ->> 'length', ''), nullif(r ->> 'width', ''), (r ->> 'tonnage')::numeric,
      nullif(r ->> 'tonnageType', ''), (r ->> 'enginePower')::int, (r ->> 'buildYear')::int, (r ->> 'rebuildYear')::int,
      (r ->> 'engineBuildYear')::int, (r ->> 'registerDate')::date, (r ->> 'measureDate')::date, nullif(r ->> 'imo', ''),
      coalesce(r -> 'owners', '[]'::jsonb)
    from jsonb_array_elements(p_rows) r
    where coalesce(r ->> 'id', '') ~ '^\d{10}$' and coalesce(r ->> 'name', '') <> '' and coalesce(r ->> 'regNr', '') <> ''
    on conflict (run_id, external_id) do nothing
    returning 1)
  select count(*) into n_ok from ins;
  update registry_runs set heartbeat_at = now(),
    counts = counts || jsonb_build_object('duplicates', coalesce((counts ->> 'duplicates')::int, 0) + (n_in - n_ok))
   where id = p_run;
  return jsonb_build_object('received', n_in, 'staged', n_ok);
end $$;

-- Rader som ikke besto valideringen i Edge Function: lagres som saker til gjennomgang
create or replace function registry_record_errors(p_run bigint, p_errors jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  for e in select * from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb)) limit 500 loop
    perform _upsert_review('validation', coalesce(nullif(e ->> 'id', ''), 'rad-' || md5(e::text)), null, p_run,
      jsonb_build_object('reason', left(e ->> 'reason', 200), 'sample', e -> 'sample'));
  end loop;
  update registry_runs set counts = counts || jsonb_build_object('validation', jsonb_array_length(coalesce(p_errors, '[]'::jsonb)))
   where id = p_run;
end $$;

-- ---------------------------------------------------------------- Analyse (forhåndsvisning)
create or replace function registry_analyze(p_run bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r registry_runs; v_staged int; v_prev int; v_complete boolean; v_counts jsonb;
begin
  select * into r from registry_runs where id = p_run for update;
  if not found then perform _err('notfound'); end if;
  if r.status <> 'running' then perform _err('already'); end if;
  select count(*) into v_staged from registry_staging where run_id = p_run;
  if v_staged = 0 then perform _err('empty'); end if;
  -- Vern mot halvtomme svar: kraftig nedgang i forhold til forrige vellykkede kjøring stopper alt
  select (counts ->> 'staged')::int into v_prev from registry_runs where register = r.register and status = 'completed' order by id desc limit 1;
  if v_prev is not null and v_staged < v_prev * 0.9 then perform _err('incomplete'); end if;
  v_complete := r.source_total is not null and v_staged >= r.source_total;

  update registry_staging set action = null, vessel_id = null, note = null, candidates = null, changed = null,
    owners_changed = null, new_company = null, manager_change = null where run_id = p_run;

  -- 1. Kjent ID fra registeret
  update registry_staging s set vessel_id = vi.vessel_id, action = 'matched'
    from vessel_identifiers vi where s.run_id = p_run and vi.register = r.register and vi.external_id = s.external_id;

  -- 2. Eksisterende fartøy uten ID: samme registreringsmerke OG (samme kallesignal ELLER samme navn).
  --    Navn alene brukes aldri. Uklare treff går til manuell gjennomgang.
  with cand as (
    select s.external_id, v.id vid, v.name, v.callsign, v.reg_nr,
           coalesce(norm_compact(v.callsign), '') = coalesce(norm_compact(s.callsign), '') as cs_eq,
           norm_compact(v.name) = norm_compact(s.name) as name_eq
      from registry_staging s join vessels v on v.reg_nr = s.reg_nr
     where s.run_id = p_run and s.action is null and v.source = r.register
       and not exists (select 1 from vessel_identifiers x where x.vessel_id = v.id and x.register = r.register)
  ), agg as (
    select external_id, count(*) n, min(vid) vid, bool_and(cs_eq or name_eq) ok,
           jsonb_agg(jsonb_build_object('id', vid, 'name', name, 'callsign', callsign, 'reg_nr', reg_nr)) cands
      from cand group by external_id
  )
  update registry_staging s set
    action = case when a.n = 1 and a.ok then 'link' else 'ambiguous' end,
    vessel_id = case when a.n = 1 and a.ok then a.vid end,
    candidates = a.cands,
    note = case when a.n = 1 and a.ok then null
                when a.n > 1 then 'Flere fartøy i Fartøykontakt har samme registreringsmerke'
                else 'Registreringsmerket stemmer, men verken navn eller kallesignal gjør det' end
  from agg a where s.run_id = p_run and s.external_id = a.external_id and s.action is null;

  -- 3. Resten er nye fartøy
  update registry_staging set action = 'new' where run_id = p_run and action is null;

  -- 4. Samme registreringsmerke to ganger i kilden
  update registry_staging s set action = 'ambiguous', vessel_id = null, note = 'Registreringsmerket finnes flere ganger i kilden'
   where s.run_id = p_run and s.action in ('new','link')
     and exists (select 1 from registry_staging t where t.run_id = p_run and t.reg_nr = s.reg_nr and t.external_id <> s.external_id);

  -- 5. Merket brukes av et annet fartøy i Fartøykontakt som ikke selv får nytt merke i denne kjøringen
  update registry_staging s set action = 'ambiguous',
         candidates = coalesce(s.candidates, (select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'callsign', w.callsign, 'reg_nr', w.reg_nr))
                                                from vessels w where w.reg_nr = s.reg_nr)),
         note = 'Registreringsmerket brukes allerede av et annet fartøy i Fartøykontakt'
   where s.run_id = p_run and s.action in ('new','matched','link')
     and exists (select 1 from vessels w where w.reg_nr = s.reg_nr and w.id is distinct from s.vessel_id
                   and not exists (select 1 from registry_staging t where t.run_id = p_run and t.vessel_id = w.id and t.reg_nr <> s.reg_nr));

  -- 6. Behold kommunenavn hvis kommunelisten ikke kunne hentes denne gangen
  update registry_staging s set municipality = v.municipality
    from vessels v where s.run_id = p_run and s.vessel_id = v.id and s.municipality is null and v.municipality_code = s.municipality_code;

  -- 7. Hva er endret?
  update registry_staging s set
    changed = _reg_fields_s(s) is distinct from _reg_fields_v(v),
    owners_changed = _vessel_owner_sig(v.id, r.register) is not null and _vessel_owner_sig(v.id, r.register) is distinct from _owner_sig(s.owners),
    new_company = _primary_company(s.owners)
  from vessels v where s.run_id = p_run and s.vessel_id = v.id and s.action in ('matched','link');
  update registry_staging set new_company = _primary_company(owners) where run_id = p_run and action = 'new';

  -- 8. Nytt forvaltende rederi? Automatisk bare når ingen har tatt fartøyet i bruk og ingen av rederiene har brukere.
  --    Ellers gjennomgang. En tidligere «behold»-avgjørelse for samme eier gjentas ikke.
  update registry_staging s set manager_change =
         case when _vessel_is_managed(v.id, v.company_id, s.new_company) then 'review' else 'auto' end
    from vessels v
   where s.run_id = p_run and s.vessel_id = v.id and s.action in ('matched','link') and s.new_company <> v.company_id
     and not exists (select 1 from registry_reviews rv where rv.vessel_id = v.id and rv.kind = 'owner_change'
                       and rv.status = 'resolved' and rv.resolution = 'keep' and rv.details ->> 'to_company' = s.new_company);

  select jsonb_build_object(
    'source_total', r.source_total, 'staged', v_staged, 'complete', v_complete,
    'new',         count(*) filter (where action = 'new'),
    'link',        count(*) filter (where action = 'link'),
    'updated',     count(*) filter (where action in ('matched','link') and changed),
    'unchanged',   count(*) filter (where action in ('matched','link') and not changed and not coalesce(owners_changed, false) and manager_change is null),
    'ambiguous',   count(*) filter (where action = 'ambiguous'),
    'owners_updated', count(*) filter (where action in ('matched','link') and owners_changed),
    'owner_auto',  count(*) filter (where manager_change = 'auto'),
    'owner_review', count(*) filter (where manager_change = 'review'),
    'reappeared',  count(*) filter (where action in ('matched','link') and exists (select 1 from vessels v where v.id = registry_staging.vessel_id and v.registry_status = 'missing')),
    'missing', case when v_complete then (
       select count(*) from vessels v where v.source = r.register and v.registry_status = 'active'
          and not exists (select 1 from registry_staging s where s.run_id = p_run and s.vessel_id = v.id)
          and not exists (select 1 from registry_staging s, jsonb_array_elements(coalesce(s.candidates, '[]'::jsonb)) c
                           where s.run_id = p_run and s.action = 'ambiguous' and c ->> 'id' = v.id)) else null end)
  into v_counts from registry_staging where run_id = p_run;

  update registry_runs set counts = counts || v_counts, heartbeat_at = now(),
         status = case when mode = 'preview' then 'preview_ready' else status end,
         finished_at = case when mode = 'preview' then now() else finished_at end
   where id = p_run;
  return (select counts from registry_runs where id = p_run);
end $$;

-- ---------------------------------------------------------------- Bruk endringene (én transaksjon)
create or replace function registry_apply(p_run bigint, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r registry_runs; v_prev_seen timestamptz; v_complete boolean; n_missing int := 0;
begin
  select * into r from registry_runs where id = p_run for update;
  if not found then perform _err('notfound'); end if;
  if r.status = 'preview_ready' then
    -- Godkjenning av forhåndsvisning: må gjøres av en plattformadministrator, og dataene må være ferske
    if p_actor is null or not exists (select 1 from platform_admins where user_id = p_actor) then perform _err('forbidden'); end if;
    if r.started_at < now() - interval '12 hours' then perform _err('stale'); end if;
    if exists (select 1 from registry_runs x where x.register = r.register and x.id > r.id and x.status in ('completed','running')) then perform _err('stale'); end if;
  elsif not (r.status = 'running' and r.mode = 'apply') then
    perform _err('already');
  end if;
  if exists (select 1 from registry_staging where run_id = p_run and action is null) then perform _err('invalid'); end if;
  v_complete := coalesce((r.counts ->> 'complete')::boolean, false);
  select started_at into v_prev_seen from registry_runs where register = r.register and status = 'completed' order by id desc limit 1;

  -- 1. Nye rederier (selskaper) fra eierlisten. Navn som er sjekket mot Brønnøysund overskrives ikke.
  insert into companies(id, name, orgnr, place, postal_code, source)
  select distinct on (o ->> 'orgnr') 'org-' || (o ->> 'orgnr'), left(coalesce(nullif(o ->> 'name', ''), 'Ukjent rederi'), 200), o ->> 'orgnr',
         nullif(left(o ->> 'city', 100), ''), nullif(left(o ->> 'postalCode', 10), ''), 'fiskeridir'
    from registry_staging s, jsonb_array_elements(s.owners) o
   where s.run_id = p_run and s.action in ('new','matched','link') and o ->> 'type' = 'COMPANY' and o ->> 'orgnr' ~ '^\d{9}$'
   order by o ->> 'orgnr'
  on conflict (orgnr) do update set name = excluded.name, place = coalesce(excluded.place, companies.place), postal_code = coalesce(excluded.postal_code, companies.postal_code)
   where companies.source = 'fiskeridir' and companies.brreg_checked_at is null
     and (companies.name, coalesce(companies.place, ''), coalesce(companies.postal_code, ''))
         is distinct from (excluded.name, coalesce(excluded.place, companies.place, ''), coalesce(excluded.postal_code, companies.postal_code, ''));

  -- 2. Koble eksisterende fartøy til registerets ID
  insert into vessel_identifiers(register, external_id, vessel_id)
  select r.register, external_id, vessel_id from registry_staging where run_id = p_run and action = 'link'
  on conflict do nothing;
  insert into registry_changes(run_id, vessel_id, external_id, change, actor)
  select p_run, vessel_id, external_id, 'linked', p_actor from registry_staging where run_id = p_run and action = 'link';

  -- 3. Nye fartøy. Kontaktinformasjon er tom: den legges bare inn av rederiet.
  update registry_staging set vessel_id = 'fd-' || external_id where run_id = p_run and action = 'new';
  insert into vessels(id, company_id, name, reg_nr, callsign, length, width, engine_power, build_year, register_date, imo,
                      municipality_code, municipality, tonnage, tonnage_type, rebuild_year, engine_build_year, measure_date,
                      source, imported_at, registry_first_seen, registry_changed_at)
  select vessel_id, new_company, name, reg_nr, callsign, length, width, engine_power, build_year, register_date, imo,
         municipality_code, municipality, tonnage, tonnage_type, rebuild_year, engine_build_year, measure_date,
         r.register, now(), now(), now()
    from registry_staging where run_id = p_run and action = 'new'
  on conflict (id) do nothing;
  insert into vessel_identifiers(register, external_id, vessel_id)
  select r.register, external_id, vessel_id from registry_staging where run_id = p_run and action = 'new'
  on conflict do nothing;
  insert into registry_changes(run_id, vessel_id, external_id, change, details, actor)
  select p_run, vessel_id, external_id, 'created', jsonb_build_object('name', name, 'reg_nr', reg_nr), p_actor
    from registry_staging where run_id = p_run and action = 'new';

  -- 4. Endrede registerfelt. Bare felt fra registeret; aldri telefon, e-post eller updated_at.
  insert into registry_changes(run_id, vessel_id, external_id, change, details, actor)
  select p_run, v.id, s.external_id, 'updated', _jsonb_diff(_reg_fields_v(v), _reg_fields_s(s)), p_actor
    from registry_staging s join vessels v on v.id = s.vessel_id
   where s.run_id = p_run and s.action in ('matched','link') and s.changed;
  update vessels v set
    name = s.name, reg_nr = s.reg_nr, callsign = s.callsign, length = s.length, width = s.width,
    engine_power = s.engine_power, build_year = s.build_year, register_date = s.register_date, imo = s.imo,
    municipality_code = s.municipality_code, municipality = coalesce(s.municipality, v.municipality),
    tonnage = s.tonnage, tonnage_type = s.tonnage_type, rebuild_year = s.rebuild_year,
    engine_build_year = s.engine_build_year, measure_date = s.measure_date, registry_changed_at = now()
  from registry_staging s
  where s.run_id = p_run and s.vessel_id = v.id and s.action in ('matched','link') and s.changed;
  update vessels v set registry_first_seen = now()
    from registry_staging s where s.run_id = p_run and s.vessel_id = v.id and s.action = 'link' and v.registry_first_seen is null;

  -- 5. Registrerte eiere (bare der de faktisk er endret eller mangler)
  insert into registry_changes(run_id, vessel_id, external_id, change, details, actor)
  select p_run, s.vessel_id, s.external_id, 'owners',
         jsonb_build_object('fra', _vessel_owner_sig(s.vessel_id, r.register), 'til', _owner_sig(s.owners)), p_actor
    from registry_staging s where s.run_id = p_run and s.action in ('matched','link') and s.owners_changed;
  delete from vessel_owners o using registry_staging s
   where s.run_id = p_run and s.action in ('matched','link','new') and o.vessel_id = s.vessel_id and o.register = r.register
     and _vessel_owner_sig(s.vessel_id, r.register) is distinct from _owner_sig(s.owners);
  insert into vessel_owners(vessel_id, register, position, owner_type, orgnr, company_id)
  select s.vessel_id, r.register, x.n, x.e ->> 'type',
         case when x.e ->> 'type' = 'COMPANY' then x.e ->> 'orgnr' end,
         case when x.e ->> 'type' = 'COMPANY' then (select c.id from companies c where c.orgnr = x.e ->> 'orgnr') end
    from registry_staging s, jsonb_array_elements(s.owners) with ordinality x(e, n)
   where s.run_id = p_run and s.action in ('matched','link','new')
     and not exists (select 1 from vessel_owners o where o.vessel_id = s.vessel_id and o.register = r.register)
     and (x.e ->> 'type' = 'PERSON' or x.e ->> 'orgnr' ~ '^\d{9}$');

  -- 6. Forvaltende rederi. Automatisk bare for fartøy ingen bruker. Ellers sak til gjennomgang.
  insert into registry_changes(run_id, vessel_id, external_id, change, details, actor)
  select p_run, v.id, s.external_id, 'manager_changed', jsonb_build_object('fra', v.company_id, 'til', s.new_company), p_actor
    from registry_staging s join vessels v on v.id = s.vessel_id where s.run_id = p_run and s.manager_change = 'auto';
  update vessels v set company_id = s.new_company
    from registry_staging s where s.run_id = p_run and s.vessel_id = v.id and s.manager_change = 'auto';
  perform _upsert_review('owner_change', s.external_id, s.vessel_id, p_run, jsonb_build_object(
            'from_company', v.company_id, 'from_name', (select name from companies where id = v.company_id),
            'to_company', s.new_company, 'to_name', (select name from companies where id = s.new_company),
            'owners', (select jsonb_agg(case when o ->> 'type' = 'COMPANY' then jsonb_build_object('orgnr', o ->> 'orgnr', 'name', o ->> 'name') else jsonb_build_object('person', true) end)
                         from jsonb_array_elements(s.owners) o)))
    from registry_staging s join vessels v on v.id = s.vessel_id where s.run_id = p_run and s.manager_change = 'review';
  -- Saker om eierskifte som ikke lenger er aktuelle (registeret viser igjen samme rederi)
  update registry_reviews rv set status = 'resolved', resolution = 'not_relevant', resolved_at = now(), updated_at = now()
    from registry_staging s join vessels v on v.id = s.vessel_id
   where s.run_id = p_run and rv.vessel_id = s.vessel_id and rv.kind = 'owner_change' and rv.status = 'open' and s.new_company = v.company_id;

  -- 7. Fartøy som ikke lenger er i registeret: merkes, slettes aldri. Bare når kilden var fullstendig.
  if v_complete then
    with gone as (
      update vessels v set registry_status = 'missing', registry_last_seen = coalesce(v_prev_seen, v.registry_first_seen, v.imported_at)
       where v.source = r.register and v.registry_status = 'active'
         and not exists (select 1 from registry_staging s where s.run_id = p_run and s.vessel_id = v.id)
         and not exists (select 1 from registry_staging s, jsonb_array_elements(coalesce(s.candidates, '[]'::jsonb)) c
                          where s.run_id = p_run and s.action = 'ambiguous' and c ->> 'id' = v.id)
      returning v.id, v.name, v.reg_nr, v.registry_last_seen)
    , logged as (
      insert into registry_changes(run_id, vessel_id, change, details, actor)
      select p_run, id, 'missing', jsonb_build_object('sist_sett', registry_last_seen), p_actor from gone returning vessel_id)
    select count(*) into n_missing from logged;
    perform _upsert_review('missing', (select external_id from vessel_identifiers vi where vi.vessel_id = v.id and vi.register = r.register), v.id, p_run,
              jsonb_build_object('name', v.name, 'reg_nr', v.reg_nr, 'last_seen', v.registry_last_seen))
       from vessels v
      where v.registry_status = 'missing' and v.source = r.register
        and exists (select 1 from registry_changes c where c.run_id = p_run and c.vessel_id = v.id and c.change = 'missing');
  end if;

  -- 8. Fartøy som er tilbake i registeret
  insert into registry_changes(run_id, vessel_id, external_id, change, actor)
  select p_run, v.id, s.external_id, 'reappeared', p_actor
    from registry_staging s join vessels v on v.id = s.vessel_id
   where s.run_id = p_run and s.action in ('matched','link') and v.registry_status = 'missing';
  update vessels v set registry_status = 'active', registry_last_seen = null
    from registry_staging s where s.run_id = p_run and s.vessel_id = v.id and s.action in ('matched','link') and v.registry_status = 'missing';
  update registry_reviews rv set status = 'resolved', resolution = 'reappeared', resolved_at = now(), updated_at = now()
    from registry_staging s
   where s.run_id = p_run and s.action in ('matched','link') and rv.vessel_id = s.vessel_id and rv.kind = 'missing' and rv.status = 'open';

  -- 9. Uklare treff til manuell gjennomgang (personnavn er allerede fjernet i Edge Function)
  perform _upsert_review('ambiguous_match', s.external_id, null, p_run, jsonb_build_object(
            'note', s.note, 'candidates', s.candidates, 'new_company', s.new_company,
            'record', _reg_fields_s(s) || jsonb_build_object('owners', s.owners)))
    from registry_staging s where s.run_id = p_run and s.action = 'ambiguous';
  update registry_reviews rv set status = 'resolved', resolution = 'resolved_by_sync', resolved_at = now(), updated_at = now()
    from registry_staging s
   where s.run_id = p_run and s.action <> 'ambiguous' and rv.kind = 'ambiguous_match' and rv.status = 'open' and rv.external_id = s.external_id;
  -- Valideringsfeil som ikke lenger finnes i kilden
  update registry_reviews set status = 'resolved', resolution = 'gone_from_source', resolved_at = now(), updated_at = now()
   where kind = 'validation' and status = 'open' and register = r.register and run_id is distinct from p_run;

  -- 10. Ferdig
  update registry_runs set status = 'completed', finished_at = now(), approved_by = case when r.status = 'preview_ready' then p_actor end,
         counts = counts || jsonb_build_object('missing_marked', n_missing)
   where id = p_run;
  update registry_runs set status = 'superseded' where register = r.register and status = 'preview_ready' and id <> p_run;
  delete from registry_staging where run_id in (select id from registry_runs where id <> p_run and started_at < now() - interval '2 days');
  return (select counts from registry_runs where id = p_run);
end $$;

-- Rederier fra registeret som ikke er sjekket mot Brønnøysund (brukes av Edge Function etter synk)
create or replace function registry_companies_to_check(p_limit int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(orgnr), '[]'::jsonb) from (
    select orgnr from companies where source = 'fiskeridir' and brreg_checked_at is null order by created_at limit least(greatest(p_limit, 1), 2000)) x
$$;
create or replace function registry_set_company_names(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  for e in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update companies set name = coalesce(nullif(left(e ->> 'name', 200), ''), name), place = coalesce(nullif(left(e ->> 'place', 100), ''), place),
           brreg_status = nullif(left(e ->> 'status', 60), ''), brreg_checked_at = now()
     where orgnr = e ->> 'orgnr' and source = 'fiskeridir';
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- Plattformadministrator: oversikt og gjennomgang
create or replace function registry_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_last registry_runs; v_running registry_runs; v_preview registry_runs;
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  select * into v_last from registry_runs where register = 'fiskeridir' and status = 'completed' order by id desc limit 1;
  select * into v_running from registry_runs where register = 'fiskeridir' and status = 'running' order by id desc limit 1;
  select * into v_preview from registry_runs where register = 'fiskeridir' and status = 'preview_ready' order by id desc limit 1;
  return jsonb_build_object(
    'imported', (select count(*) from vessel_identifiers where register = 'fiskeridir'),
    'unlinked', (select count(*) from vessels v where v.source = 'fiskeridir'
                   and not exists (select 1 from vessel_identifiers x where x.vessel_id = v.id and x.register = 'fiskeridir')),
    'missing',  (select count(*) from vessels where source = 'fiskeridir' and registry_status = 'missing'),
    'initialDone', v_last.id is not null,
    'last',    case when v_last.id is null then null else to_jsonb(v_last) - 'started_by' - 'approved_by' end,
    'running', case when v_running.id is null then null else to_jsonb(v_running) - 'started_by' - 'approved_by' end,
    'preview', case when v_preview.id is null then null else to_jsonb(v_preview) - 'started_by' - 'approved_by' end,
    'lastFailed', (select to_jsonb(x) - 'started_by' - 'approved_by' from registry_runs x where register = 'fiskeridir' and status = 'failed'
                    and id > coalesce(v_last.id, 0) order by id desc limit 1),
    'openReviews', (select jsonb_build_object(
        'owner_change', count(*) filter (where kind = 'owner_change'), 'ambiguous_match', count(*) filter (where kind = 'ambiguous_match'),
        'missing', count(*) filter (where kind = 'missing'), 'validation', count(*) filter (where kind = 'validation'))
      from registry_reviews where status = 'open'),
    'reviews', (select coalesce(jsonb_agg(x order by x.kind, x.created_at), '[]'::jsonb) from (
        select rv.id, rv.kind, rv.external_id, rv.vessel_id, rv.details, rv.created_at, v.name vessel_name, v.reg_nr vessel_reg
          from registry_reviews rv left join vessels v on v.id = rv.vessel_id
         where rv.status = 'open' order by rv.created_at limit 200) x),
    'runs', (select coalesce(jsonb_agg(to_jsonb(x) - 'started_by' - 'approved_by' order by x.id desc), '[]'::jsonb)
               from (select * from registry_runs where register = 'fiskeridir' order by id desc limit 10) x),
    'schedule', 'Hver natt kl. 04:00 (norsk tid)'
  );
end $$;

-- Eksempler fra en forhåndsvisning, så administratoren ser hva som vil skje før godkjenning
create or replace function registry_preview(p_run bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  return jsonb_build_object(
    'new',       (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'reg_nr', reg_nr, 'callsign', callsign)), '[]') from (select * from registry_staging where run_id = p_run and action = 'new' order by name limit 25) x),
    'updated',   (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'reg_nr', s.reg_nr, 'diff', _jsonb_diff(_reg_fields_v(v), _reg_fields_s(s)))), '[]')
                    from (select * from registry_staging where run_id = p_run and action in ('matched','link') and changed order by name limit 25) s join vessels v on v.id = s.vessel_id),
    'ambiguous', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'reg_nr', reg_nr, 'note', note, 'candidates', candidates)), '[]') from (select * from registry_staging where run_id = p_run and action = 'ambiguous' order by name limit 25) x),
    'owner_review', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'reg_nr', s.reg_nr, 'from', (select name from companies where id = v.company_id), 'to', (select name from companies where id = s.new_company))), '[]')
                    from (select * from registry_staging where run_id = p_run and manager_change = 'review' order by name limit 25) s join vessels v on v.id = s.vessel_id),
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'reg_nr', reg_nr)), '[]') from (
        select v.name, v.reg_nr from vessels v where v.source = 'fiskeridir' and v.registry_status = 'active'
           and not exists (select 1 from registry_staging s where s.run_id = p_run and s.vessel_id = v.id)
           and not exists (select 1 from registry_staging s, jsonb_array_elements(coalesce(s.candidates, '[]'::jsonb)) c where s.run_id = p_run and s.action = 'ambiguous' and c ->> 'id' = v.id)
         order by v.name limit 25) x)
  );
end $$;

create or replace function registry_resolve_review(p_id bigint, p_action text, p_vessel text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rv registry_reviews; uid uuid := auth.uid(); nm text := _actor_name(); rec jsonb; v_id text; v_company text;
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  select * into rv from registry_reviews where id = p_id for update;
  if not found then perform _err('notfound'); end if;
  if rv.status <> 'open' then perform _err('already'); end if;

  if rv.kind = 'owner_change' and p_action = 'switch' then
    -- Bevisst overføring: fartøyet flyttes til det nye rederiet. Tilgang følger rederiet; ingen brukere opprettes.
    select company_id into v_company from vessels where id = rv.vessel_id for update;
    if v_company is distinct from rv.details ->> 'from_company' then perform _err('conflict'); end if;
    if not exists (select 1 from companies where id = rv.details ->> 'to_company') then perform _err('notfound'); end if;
    update vessels set company_id = rv.details ->> 'to_company' where id = rv.vessel_id;
    insert into registry_changes(vessel_id, external_id, change, details, actor)
    values (rv.vessel_id, rv.external_id, 'manager_changed', jsonb_build_object('fra', v_company, 'til', rv.details ->> 'to_company', 'via', 'gjennomgang'), uid);
  elsif rv.kind = 'owner_change' and p_action = 'keep' then
    null;  -- Rederiet som forvalter fartøyet er et annet enn den registrerte eieren. Spørres ikke igjen for samme eier.
  elsif rv.kind = 'ambiguous_match' and p_action = 'link' then
    if p_vessel is null or not exists (select 1 from jsonb_array_elements(coalesce(rv.details -> 'candidates', '[]'::jsonb)) c where c ->> 'id' = p_vessel) then perform _err('invalid'); end if;
    if exists (select 1 from vessel_identifiers where register = rv.register and (external_id = rv.external_id or vessel_id = p_vessel)) then perform _err('conflict'); end if;
    insert into vessel_identifiers(register, external_id, vessel_id) values (rv.register, rv.external_id, p_vessel);
    update vessels set registry_status = 'active', registry_last_seen = null, registry_first_seen = coalesce(registry_first_seen, now()) where id = p_vessel;
    update registry_reviews set status = 'resolved', resolution = 'linked', resolved_at = now(), resolved_by = uid, resolved_by_name = nm, updated_at = now()
     where kind = 'missing' and status = 'open' and vessel_id = p_vessel;
    insert into registry_changes(vessel_id, external_id, change, details, actor) values (p_vessel, rv.external_id, 'linked', '{"via":"gjennomgang"}', uid);
  elsif rv.kind = 'ambiguous_match' and p_action = 'create' then
    rec := rv.details -> 'record';
    if exists (select 1 from vessels where reg_nr = rec ->> 'reg_nr') then perform _err('conflict'); end if;
    if exists (select 1 from vessel_identifiers where register = rv.register and external_id = rv.external_id) then perform _err('conflict'); end if;
    v_id := 'fd-' || rv.external_id;
    insert into companies(id, name, orgnr, place, postal_code, source)
    select distinct on (o ->> 'orgnr') 'org-' || (o ->> 'orgnr'), left(coalesce(nullif(o ->> 'name', ''), 'Ukjent rederi'), 200), o ->> 'orgnr',
           nullif(o ->> 'city', ''), nullif(o ->> 'postalCode', ''), 'fiskeridir'
      from jsonb_array_elements(coalesce(rec -> 'owners', '[]'::jsonb)) o where o ->> 'type' = 'COMPANY' and o ->> 'orgnr' ~ '^\d{9}$'
    on conflict (orgnr) do nothing;
    insert into vessels(id, company_id, name, reg_nr, callsign, length, width, engine_power, build_year, register_date, imo, municipality_code, municipality,
                        tonnage, tonnage_type, rebuild_year, engine_build_year, measure_date, source, imported_at, registry_first_seen, registry_changed_at)
    values (v_id, _primary_company(rec -> 'owners'), rec ->> 'name', rec ->> 'reg_nr', rec ->> 'callsign', rec ->> 'length', rec ->> 'width',
            (rec ->> 'engine_power')::int, (rec ->> 'build_year')::int, (rec ->> 'register_date')::date, rec ->> 'imo', rec ->> 'municipality_code', rec ->> 'municipality',
            (rec ->> 'tonnage')::numeric, rec ->> 'tonnage_type', (rec ->> 'rebuild_year')::int, (rec ->> 'engine_build_year')::int, (rec ->> 'measure_date')::date,
            rv.register, now(), now(), now());
    insert into vessel_identifiers(register, external_id, vessel_id) values (rv.register, rv.external_id, v_id);
    insert into vessel_owners(vessel_id, register, position, owner_type, orgnr, company_id)
    select v_id, rv.register, x.n, x.e ->> 'type', case when x.e ->> 'type' = 'COMPANY' then x.e ->> 'orgnr' end,
           case when x.e ->> 'type' = 'COMPANY' then (select id from companies where orgnr = x.e ->> 'orgnr') end
      from jsonb_array_elements(coalesce(rec -> 'owners', '[]'::jsonb)) with ordinality x(e, n)
     where x.e ->> 'type' = 'PERSON' or x.e ->> 'orgnr' ~ '^\d{9}$';
    insert into registry_changes(vessel_id, external_id, change, details, actor) values (v_id, rv.external_id, 'created', '{"via":"gjennomgang"}', uid);
  elsif rv.kind in ('missing','validation','ambiguous_match') and p_action = 'dismiss' then
    null;
  else
    perform _err('invalid');
  end if;

  update registry_reviews set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
         resolution = p_action, resolved_by = uid, resolved_by_name = nm, resolved_at = now(), updated_at = now()
   where id = p_id;
  insert into registry_changes(vessel_id, external_id, change, details, actor)
  values (coalesce(rv.vessel_id, v_id, p_vessel), rv.external_id, 'review_resolved', jsonb_build_object('sak', rv.kind, 'valg', p_action), uid);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Offentlig søk (ikke hele registeret i nettleseren)
-- Kort per fartøy: samme form som get_directory, men bare for de fartøyene som trengs
create or replace function _vessel_cards(p_ids text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  with vs as (select * from vessels where id = any(coalesce(p_ids, '{}'))),
  cs as (select * from companies where id in (select company_id from vs)),
  cur as (
    select 'vessel'::text scope, id scope_id, 'bridgePhone'::text field, bridge_phone value from vs where bridge_phone is not null
    union all select 'vessel', id, 'altPhone', alt_phone from vs where alt_phone is not null
    union all select 'vessel', id, 'email', email from vs where email is not null
    union all select 'company', id, 'phone', phone from cs where phone is not null
    union all select 'company', id, 'email', email from cs where email is not null
  ), ver as (
    select distinct on (x.scope, x.scope_id, x.field) x.scope, x.scope_id, x.field, x.value, x.at
      from verifications x join cur c using (scope, scope_id, field, value)
     order by x.scope, x.scope_id, x.field, x.at desc
  )
  select jsonb_build_object(
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'orgnr', orgnr, 'phone', coalesce(phone, ''), 'email', coalesce(email, ''),
                    'place', coalesce(place, ''), 'demo', source = 'demo', 'status', brreg_status)), '[]'::jsonb) from cs),
    'vessels', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', name, 'companyId', company_id, 'regNr', reg_nr,
                    'callsign', coalesce(callsign, ''), 'type', coalesce(vessel_type, ''), 'length', coalesce(length, ''), 'homePort', coalesce(home_port, municipality, ''),
                    'claimed', (bridge_phone is not null or email is not null),
                    'bridgePhone', coalesce(bridge_phone, ''), 'altPhone', coalesce(alt_phone, ''), 'email', coalesce(email, ''),
                    'updatedAt', to_char(updated_at at time zone 'Europe/Oslo', 'YYYY-MM-DD'),
                    'imo', imo, 'buildYear', build_year, 'demo', case when source = 'demo' then true end,
                    'source', case when source = 'fiskeridir' then 'fiskeridir' end,
                    'missing', case when registry_status = 'missing' then true end))), '[]'::jsonb) from vs),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object('id', scope || ':' || scope_id || ':' || field, 'scope', scope, 'scopeId', scope_id,
                    'field', field, 'value', value, 'at', to_char(at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'))), '[]'::jsonb) from ver),
    'numberInfo', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vesselId', vessel_id,
                    'number', case when show_on_profile and status = 'confirmed' then number else null end,
                    'replacedAt', replaced_at, 'status', status, 'showOnProfile', show_on_profile, 'source', source)), '[]'::jsonb)
                    from number_history where vessel_id = any(coalesce(p_ids, '{}')) and replaced_at is not null
                     and status in ('confirmed','reassigned') and replaced_at > _today() - 200)
  );
$$;

create or replace function search_directory(q text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_raw text := btrim(coalesce(q, ''));
  v_qc text; v_k text; v_ids text[] := '{}'; v_hist jsonb := '[]'::jsonb;
begin
  if length(v_raw) > 80 then v_raw := left(v_raw, 80); end if;
  v_qc := norm_compact(regexp_replace(lower(v_raw), '^(ms|mv|m/s|fv)\s+', ''));
  if v_qc = '' then return _vessel_cards('{}') || jsonb_build_object('history', '[]'::jsonb); end if;
  v_k := phone_key(v_raw);
  if v_raw ~ '^[\d\s+()-]+$' and length(v_k) >= 4 then
    -- Telefonnummer: nåværende numre og tidligere numre (med faktisk status: tatt i bruk av andre?)
    select coalesce(array_agg(id), '{}') into v_ids from (
      select id from vessels where phone_key(bridge_phone) like '%' || v_k || '%' or phone_key(alt_phone) like '%' || v_k || '%' limit 20) x;
    select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'vesselId', h.vessel_id, 'number', h.number, 'replacedAt', h.replaced_at,
             'replacedBy', h.replaced_by, 'verifiedAt', h.verified_at, 'source', h.source, 'showOnProfile', h.show_on_profile,
             'status', case when exists (select 1 from vessels o where o.id <> h.vessel_id and (phone_key(o.bridge_phone) = phone_key(h.number) or phone_key(o.alt_phone) = phone_key(h.number)))
                            then 'reassigned' else h.status end)), '[]'::jsonb)
      into v_hist
      from (select * from number_history h where h.status <> 'rejected'
              and (phone_key(h.number) = v_k or (length(v_k) >= 6 and phone_key(h.number) like '%' || v_k || '%')) limit 20) h;
    v_ids := v_ids || coalesce((select array_agg(distinct e ->> 'vesselId') from jsonb_array_elements(v_hist) e), '{}');
  else
    select coalesce(array_agg(id order by score desc, name), '{}') into v_ids from (
      select v.id, v.name, greatest(
          case when v.search_name like v_qc || '%' then 100
               when v.search_words ~ ('(^| )' || v_qc) then 92
               when length(v_qc) >= 3 and v.search_name like '%' || v_qc || '%' then 75 else 0 end,
          case when v.search_callsign like v_qc || '%' then 96 else 0 end,
          case when v.search_reg like v_qc || '%' then 96 when length(v_qc) >= 3 and v.search_reg like '%' || v_qc || '%' then 70 else 0 end,
          case when c.id <> 'privat' and c.search_name like v_qc || '%' then 80
               when c.id <> 'privat' and length(v_qc) >= 3 and c.search_name like '%' || v_qc || '%' then 55 else 0 end,
          case when length(v_qc) >= 3 then (greatest(similarity(v.search_name, v_qc), word_similarity(v_qc, v.search_name)) * 60)::int else 0 end
        ) score
        from vessels v join companies c on c.id = v.company_id
       where v.search_name like v_qc || '%' or v.search_callsign like v_qc || '%' or v.search_reg like v_qc || '%'
          or v.search_words ~ ('(^| )' || v_qc)
          or (length(v_qc) >= 3 and (v.search_name like '%' || v_qc || '%' or v.search_reg like '%' || v_qc || '%'
               or (c.id <> 'privat' and c.search_name like '%' || v_qc || '%') or v.search_name % v_qc or v_qc <% v.search_name))
       order by score desc, v.name limit 40) s;
  end if;
  return _vessel_cards(v_ids) || jsonb_build_object('history', v_hist, 'ids', to_jsonb(v_ids));
end $$;

create or replace function get_vessel_public(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$ select _vessel_cards(array[p_id]) $$;

create or replace function get_vessels_public(p_ids text[]) returns jsonb
language sql stable security definer set search_path = public as $$ select _vessel_cards(p_ids[1:200]) $$;

-- Forsiden: innstillinger, fartøy som nylig har byttet nummer, og tre eksempler som skifter hver dag
create or replace function get_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_recent text[]; v_examples text[];
begin
  select coalesce(array_agg(vessel_id), '{}') into v_recent from (
    select vessel_id, max(replaced_at) d from number_history
     where replaced_at > _today() - 60 and status in ('confirmed','reassigned') group by vessel_id order by d desc limit 10) x;
  select coalesce(array_agg(id), '{}') into v_examples from (
    select id from vessels where callsign is not null and length(name) <= 14 and registry_status = 'active'
     order by md5(id || _today()::text) limit 3) x;
  return _vessel_cards(v_recent || v_examples) || jsonb_build_object(
    'settings', jsonb_build_object('verifyMonths', (select verify_months from settings where id = 1)),
    'recentIds', to_jsonb(v_recent), 'exampleIds', to_jsonb(v_examples));
end $$;

-- Innlogget: fartøyene brukeren trenger (eget rederi + fartøy i meldinger brukeren ser)
create or replace function get_admin_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); plat boolean := is_platform_admin(); my_co text; adm boolean; v_ids text[];
begin
  if uid is null then perform _err('forbidden'); end if;
  select company_id into my_co from memberships where user_id = uid order by (role = 'admin') desc, created_at limit 1;
  adm := my_co is not null and is_company_admin(my_co);
  if not plat and my_co is null then return jsonb_build_object('reports', '[]'::jsonb, 'changes', '[]'::jsonb, 'numberHistory', '[]'::jsonb, 'users', '[]'::jsonb, 'outbox', '[]'::jsonb, 'cards', _vessel_cards('{}')); end if;
  select coalesce(array_agg(distinct id), '{}') into v_ids from (
    select id from vessels where company_id = my_co
    union select r.vessel_id from reports r join vessels v on v.id = r.vessel_id where plat or (adm and v.company_id = my_co)) x;
  return jsonb_build_object(
    'cards', _vessel_cards(v_ids),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'vesselId', r.vessel_id, 'field', r.field, 'reason', r.reason,
        'current', coalesce(r.current_value, ''), 'suggested', r.suggested, 'details', coalesce(r.details, ''), 'contact', coalesce(r.contact, ''),
        'at', to_char(r.created_at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'), 'status', r.status,
        'resolvedBy', r.resolved_by_name, 'resolvedAt', to_char(r.resolved_at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'),
        'resolvedValue', r.resolved_value, 'rejectReason', r.reject_reason, 'resolution', r.resolution)), '[]'::jsonb)
      from reports r join vessels v on v.id = r.vessel_id
      where plat or (adm and v.company_id = my_co)),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'vesselId', c.vessel_id, 'field', c.field, 'from', coalesce(c.from_value, ''),
        'to', coalesce(c.to_value, ''), 'by', c.actor, 'byName', c.by_name, 'at', to_char(c.at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'),
        'status', c.status, 'showPrevious', c.show_previous, 'via', c.via, 'reportId', c.report_id, 'decidedBy', c.decided_by_name)), '[]'::jsonb)
      from changes c join vessels v on v.id = c.vessel_id where v.company_id = my_co),
    'numberHistory', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'vesselId', h.vessel_id, 'number', h.number,
        'replacedAt', h.replaced_at, 'replacedBy', h.replaced_by, 'status', h.status, 'verifiedAt', h.verified_at,
        'source', h.source, 'showOnProfile', h.show_on_profile)), '[]'::jsonb)
      from number_history h join vessels v on v.id = h.vessel_id where v.company_id = my_co),
    'users', (select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.full_name, 'role', m.role, 'companyId', m.company_id,
        'email', case when adm then m.email else null end)), '[]'::jsonb)
      from memberships m where m.company_id = my_co),
    'outbox', (select coalesce(jsonb_agg(jsonb_build_object('to', o.to_email, 'subject', o.subject, 'key', o.key,
        'at', to_char(o.at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI')) order by o.at), '[]'::jsonb)
      from (select * from outbox where to_email = (auth.jwt() ->> 'email') order by at desc limit 20) o)
  );
end $$;

-- Be om tilgang, eventuelt for et bestemt fartøy. Organisasjonsnummeret gir aldri tilgang alene:
-- en plattformadministrator må godkjenne (grant_membership).
drop function if exists request_access(text, text, text);
create or replace function request_access(p_orgnr text, p_basis text, p_full_name text, p_vessel text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform _err('forbidden'); end if;
  if regexp_replace(coalesce(p_orgnr, ''), '\D', '', 'g') !~ '^\d{9}$' then perform _err('invalid'); end if;
  if p_basis not in ('signatur','fullmakt') then perform _err('invalid'); end if;
  if p_vessel is not null and not exists (select 1 from vessels where id = p_vessel) then perform _err('invalid'); end if;
  insert into access_requests(user_id, email, full_name, orgnr, company_name, basis, vessel_id)
  values (auth.uid(), auth.jwt() ->> 'email', left(coalesce(p_full_name, ''), 120), regexp_replace(p_orgnr, '\D', '', 'g'),
          (select name from companies where orgnr = regexp_replace(p_orgnr, '\D', '', 'g')), p_basis, p_vessel);
end $$;

-- ---------------------------------------------------------------- Rettigheter
-- Synkroniseringsfunksjonene: bare service-rollen (Edge Function). Aldri fra nettleseren.
revoke execute on function registry_start_run(text, text, text, uuid) from public, anon, authenticated;
revoke execute on function registry_set_source(bigint, int, text) from public, anon, authenticated;
revoke execute on function registry_heartbeat(bigint, int) from public, anon, authenticated;
revoke execute on function registry_fail_run(bigint, text) from public, anon, authenticated;
revoke execute on function registry_stage(bigint, jsonb) from public, anon, authenticated;
revoke execute on function registry_record_errors(bigint, jsonb) from public, anon, authenticated;
revoke execute on function registry_analyze(bigint) from public, anon, authenticated;
revoke execute on function registry_apply(bigint, uuid) from public, anon, authenticated;
revoke execute on function registry_companies_to_check(int) from public, anon, authenticated;
revoke execute on function registry_set_company_names(jsonb) from public, anon, authenticated;
revoke execute on function _upsert_review(text, text, text, bigint, jsonb) from public, anon, authenticated;
revoke execute on function _vessel_is_managed(text, text, text) from public, anon, authenticated;
revoke execute on function _vessel_cards(text[]) from public, anon, authenticated;
grant execute on function registry_start_run(text, text, text, uuid) to service_role;
grant execute on function registry_set_source(bigint, int, text) to service_role;
grant execute on function registry_heartbeat(bigint, int) to service_role;
grant execute on function registry_fail_run(bigint, text) to service_role;
grant execute on function registry_stage(bigint, jsonb) to service_role;
grant execute on function registry_record_errors(bigint, jsonb) to service_role;
grant execute on function registry_analyze(bigint) to service_role;
grant execute on function registry_apply(bigint, uuid) to service_role;
grant execute on function registry_companies_to_check(int) to service_role;
grant execute on function registry_set_company_names(jsonb) to service_role;
-- Plattformadministrator (sjekkes inne i funksjonene)
revoke execute on function registry_overview() from public, anon;
revoke execute on function registry_preview(bigint) from public, anon;
revoke execute on function registry_resolve_review(bigint, text, text) from public, anon;
grant execute on function registry_overview() to authenticated;
grant execute on function registry_preview(bigint) to authenticated;
grant execute on function registry_resolve_review(bigint, text, text) to authenticated;
-- Offentlig lesing
grant execute on function search_directory(text) to anon, authenticated;
grant execute on function get_vessel_public(text) to anon, authenticated;
grant execute on function get_vessels_public(text[]) to anon, authenticated;
grant execute on function get_home() to anon, authenticated;
revoke execute on function get_admin_data() from public, anon;
grant execute on function get_admin_data() to authenticated;
revoke execute on function request_access(text, text, text, text) from public, anon;
grant execute on function request_access(text, text, text, text) to authenticated;
