-- Import av Fiskeridirektoratets fartøyregister og navn fra Enhetsregisteret (Brønnøysund).
-- Importen gjøres av en plattformadministrator fra nettsiden (#importer).
-- Registerdata endrer aldri kontaktinformasjon: telefon og e-post eies av rederiet.

-- ---------------------------------------------------------------- Nye felt
alter table vessels add column if not exists municipality  text;
alter table vessels add column if not exists imo           text;
alter table vessels add column if not exists build_year    int;
alter table vessels add column if not exists engine_power  int;
alter table vessels add column if not exists width         text;
alter table vessels add column if not exists register_date date;
alter table vessels add column if not exists source        text not null default 'demo' check (source in ('demo','fiskeridir'));
alter table vessels add column if not exists imported_at   timestamptz;

alter table companies add column if not exists postal_code      text;
alter table companies add column if not exists source           text not null default 'demo' check (source in ('demo','fiskeridir','system'));
alter table companies add column if not exists brreg_checked_at timestamptz;
alter table companies add column if not exists brreg_status     text;

-- Fartøy eid av privatpersoner kobles hit. Personnavn lagres ikke.
insert into companies(id, name, orgnr, source) values ('privat', 'Privat eier', '000000000', 'system') on conflict do nothing;

-- Demofartøyene får merker som ikke finnes i registeret, så de aldri blandes med ekte fartøy
update vessels v set reg_nr = 'DEMO-' || n.rn, callsign = 'X' || substr(v.callsign, 2)
from (select id, row_number() over (order by name) rn from vessels where source = 'demo' and reg_nr not like 'DEMO-%') n
where v.id = n.id;

-- ---------------------------------------------------------------- Rollekontekst
-- En person kan både være plattformadministrator og administrator i et rederi.
create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from memberships where user_id = auth.uid()) then
      (select jsonb_build_object('id', user_id, 'name', full_name, 'email', email, 'role', role, 'companyId', company_id,
              'platform', exists (select 1 from platform_admins p where p.user_id = auth.uid()))
         from memberships where user_id = auth.uid() order by (role = 'admin') desc, created_at limit 1)
    when exists (select 1 from platform_admins where user_id = auth.uid()) then
      (select jsonb_build_object('id', user_id, 'name', full_name, 'email', email, 'role', 'platform', 'companyId', null, 'platform', true)
         from platform_admins where user_id = auth.uid())
    else jsonb_build_object('id', auth.uid(), 'name', auth.jwt() ->> 'email', 'email', auth.jwt() ->> 'email', 'role', 'none', 'companyId', null,
      'platform', false, 'pendingRequest', exists (select 1 from access_requests where user_id = auth.uid() and status = 'pending'))
  end;
$$;

-- ---------------------------------------------------------------- Katalogen med registerfelt
create or replace function get_directory() returns jsonb
language sql stable security definer set search_path = public as $$
  with cur as (
    select 'vessel'::text scope, id scope_id, 'bridgePhone'::text field, bridge_phone value from vessels where bridge_phone is not null
    union all select 'vessel', id, 'altPhone', alt_phone from vessels where alt_phone is not null
    union all select 'vessel', id, 'email', email from vessels where email is not null
    union all select 'company', id, 'phone', phone from companies where phone is not null
    union all select 'company', id, 'email', email from companies where email is not null
  ), ver as (
    select distinct on (x.scope, x.scope_id, x.field) x.scope, x.scope_id, x.field, x.value, x.at
    from verifications x join cur c using (scope, scope_id, field, value)
    order by x.scope, x.scope_id, x.field, x.at desc
  )
  select jsonb_build_object(
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'orgnr', orgnr,
        'phone', coalesce(phone, ''), 'email', coalesce(email, ''), 'place', coalesce(place, ''),
        'demo', source = 'demo', 'status', brreg_status) order by name), '[]'::jsonb) from companies),
    'vessels', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', name, 'companyId', company_id, 'regNr', reg_nr,
        'callsign', coalesce(callsign, ''), 'type', coalesce(vessel_type, ''), 'length', coalesce(length, ''), 'homePort', coalesce(home_port, municipality, ''),
        'claimed', (bridge_phone is not null or email is not null),
        'bridgePhone', coalesce(bridge_phone, ''), 'altPhone', coalesce(alt_phone, ''), 'email', coalesce(email, ''),
        'updatedAt', to_char(updated_at at time zone 'Europe/Oslo', 'YYYY-MM-DD'),
        'imo', imo, 'buildYear', build_year, 'demo', case when source = 'demo' then true end)) order by name), '[]'::jsonb) from vessels),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object('id', scope || ':' || scope_id || ':' || field, 'scope', scope, 'scopeId', scope_id,
        'field', field, 'value', value, 'at', to_char(at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'))), '[]'::jsonb) from ver),
    'numberInfo', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vesselId', vessel_id,
        'number', case when show_on_profile and status = 'confirmed' then number else null end,
        'replacedAt', replaced_at, 'status', status, 'showOnProfile', show_on_profile, 'source', source)), '[]'::jsonb)
      from number_history where replaced_at is not null and status in ('confirmed','reassigned') and replaced_at > _today() - 200),
    'settings', jsonb_build_object('verifyMonths', (select verify_months from settings where id = 1))
  );
$$;

-- ---------------------------------------------------------------- Import (plattformadministrator)
-- p_rows: [{id, regNr, callsign, name, length, width, enginePower, buildYear, registerDate, municipality, imo,
--           ownerType ('COMPANY'|'PERSON'), ownerName, orgnr, postalCode, city}]
create or replace function import_register(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; cid text; vid text; existing vessels; n_new int := 0; n_upd int := 0; n_skip int := 0;
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then perform _err('invalid'); end if;
  insert into companies(id, name, orgnr, source) values ('privat', 'Privat eier', '000000000', 'system') on conflict do nothing;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r ->> 'regNr', '') = '' or coalesce(r ->> 'name', '') = '' then n_skip := n_skip + 1; continue; end if;
    if r ->> 'ownerType' = 'COMPANY' and coalesce(r ->> 'orgnr', '') ~ '^\d{9}$' then
      insert into companies(id, name, orgnr, place, postal_code, source)
      values ('org-' || (r ->> 'orgnr'), left(r ->> 'ownerName', 200), r ->> 'orgnr', left(r ->> 'city', 100), left(r ->> 'postalCode', 10), 'fiskeridir')
      on conflict (orgnr) do update set
        name = case when companies.source = 'fiskeridir' and companies.brreg_checked_at is null then excluded.name else companies.name end,
        place = case when companies.source = 'fiskeridir' and companies.brreg_checked_at is null then excluded.place else companies.place end,
        postal_code = coalesce(excluded.postal_code, companies.postal_code)
      returning id into cid;
    else
      cid := 'privat';   -- personnavn og -nummer lagres ikke
    end if;
    select * into existing from vessels where reg_nr = r ->> 'regNr';
    if found then
      if existing.source = 'fiskeridir' then
        update vessels set name = left(r ->> 'name', 120), callsign = nullif(r ->> 'callsign', ''), length = nullif(r ->> 'length', ''),
          width = nullif(r ->> 'width', ''), engine_power = nullif(r ->> 'enginePower', '')::int, build_year = nullif(r ->> 'buildYear', '')::int,
          register_date = nullif(r ->> 'registerDate', '')::date, municipality = nullif(r ->> 'municipality', ''), imo = nullif(r ->> 'imo', ''),
          company_id = cid, imported_at = now()
        where id = existing.id;
        n_upd := n_upd + 1;
      else
        n_skip := n_skip + 1;
      end if;
    else
      vid := coalesce(nullif(r ->> 'id', ''), 'f-' || md5(r ->> 'regNr'));
      if exists (select 1 from vessels where id = vid) then vid := vid || '-' || substr(md5(r ->> 'regNr'), 1, 4); end if;
      insert into vessels(id, company_id, name, reg_nr, callsign, length, width, engine_power, build_year, register_date, municipality, imo, source, imported_at)
      values (vid, cid, left(r ->> 'name', 120), r ->> 'regNr', nullif(r ->> 'callsign', ''), nullif(r ->> 'length', ''), nullif(r ->> 'width', ''),
              nullif(r ->> 'enginePower', '')::int, nullif(r ->> 'buildYear', '')::int, nullif(r ->> 'registerDate', '')::date,
              nullif(r ->> 'municipality', ''), nullif(r ->> 'imo', ''), 'fiskeridir', now());
      n_new := n_new + 1;
    end if;
  end loop;
  return jsonb_build_object('new', n_new, 'updated', n_upd, 'skipped', n_skip);
end $$;

-- Offisielle navn og status fra Enhetsregisteret. p_rows: [{orgnr, name, place, status}]
create or replace function set_company_names(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    update companies set
      name = coalesce(nullif(left(r ->> 'name', 200), ''), name),
      place = coalesce(nullif(left(r ->> 'place', 100), ''), place),
      brreg_status = nullif(left(r ->> 'status', 60), ''),
      brreg_checked_at = now()
    where orgnr = r ->> 'orgnr' and source = 'fiskeridir';
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Liste over organisasjonsnummer som ikke er sjekket mot Enhetsregisteret ennå
create or replace function companies_to_check() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_platform_admin() then
    (select coalesce(jsonb_agg(orgnr), '[]'::jsonb) from companies where source = 'fiskeridir' and brreg_checked_at is null)
  else '[]'::jsonb end;
$$;

revoke execute on function import_register(jsonb) from public, anon;
revoke execute on function set_company_names(jsonb) from public, anon;
revoke execute on function companies_to_check() from public, anon;
revoke execute on function my_context() from public, anon;
grant execute on function import_register(jsonb) to authenticated;
grant execute on function set_company_names(jsonb) to authenticated;
grant execute on function companies_to_check() to authenticated;
grant execute on function my_context() to authenticated;
grant execute on function get_directory() to anon, authenticated;
