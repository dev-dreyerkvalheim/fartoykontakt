-- Fartøykontakt — rollevelger for personer som har flere roller,
-- for eksempel plattformadministrator og administrator i et rederi.
--
-- Regler:
--  * En plattformadministrator som også er med i et rederi, jobber som plattformadministrator
--    til hen selv velger rederiet. Rettighetene i rederiet gjelder bare mens rederiet er valgt.
--  * Bare mens rederiet er valgt kan hen bekrefte kontaktinformasjon («Bekreftet av rederiet»).
--    Endringer gjort som plattformadministrator blir aldri merket som bekreftet av rederiet.
--  * Valget lagres på serveren, så databasen vet hvilken rolle hver handling ble gjort i.
--    Nettleseren kan ikke gi seg selv en rolle: valget sjekkes mot memberships og platform_admins.
--  * Loggen viser rollen: «Navn (plattformadministrator)» eller navnet i rederiet.
--  * Personer som bare er med i rederier (ikke plattformadministrator), har samme rettigheter som før.
--
-- Kun tillegg: én ny tabell og nye versjoner av eksisterende funksjoner. Ingen data endres eller slettes.

create table if not exists acting_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  company_id text references companies(id) on delete set null,   -- null = plattformadministrator
  updated_at timestamptz not null default now()
);
alter table acting_roles enable row level security;
-- Ingen regler for direkte lesing eller skriving: tabellen brukes bare av funksjonene under.

-- Rederiet personen jobber som nå (bare hvis hen fortsatt er med i rederiet)
create or replace function _acting_company() returns text
language sql stable security definer set search_path = public as $$
  select a.company_id from acting_roles a
  join memberships m on m.user_id = a.user_id and m.company_id = a.company_id
  where a.user_id = auth.uid();
$$;

-- Rettigheter i et rederi. For plattformadministratorer gjelder de bare når rederiet er valgt.
create or replace function is_company_admin(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and company_id = cid and role = 'admin')
     and (not exists (select 1 from platform_admins where user_id = auth.uid()) or _acting_company() is not distinct from cid);
$$;

create or replace function is_company_member(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and company_id = cid)
     and (not exists (select 1 from platform_admins where user_id = auth.uid()) or _acting_company() is not distinct from cid);
$$;

-- Navnet som skrives i loggen, med rolle
create or replace function _actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select full_name from memberships where user_id = auth.uid() and company_id = _acting_company()),
    (select full_name || ' (plattformadministrator)' from platform_admins where user_id = auth.uid()),
    (select full_name from memberships where user_id = auth.uid() order by created_at limit 1),
    auth.jwt() ->> 'email', 'Ukjent');
$$;

-- Hvem er jeg nå, og hvilke roller kan jeg velge mellom
create or replace function my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); p platform_admins; m memberships; act text; roles jsonb;
begin
  if uid is null then return null; end if;
  select * into p from platform_admins where user_id = uid;
  select coalesce(jsonb_agg(jsonb_build_object('companyId', x.company_id, 'companyName', c.name, 'orgnr', c.orgnr, 'role', x.role) order by c.name), '[]'::jsonb)
    into roles from memberships x join companies c on c.id = x.company_id where x.user_id = uid;
  act := _acting_company();
  if act is not null then
    select * into m from memberships where user_id = uid and company_id = act;
  elsif p.user_id is null then
    select * into m from memberships where user_id = uid order by (role = 'admin') desc, created_at limit 1;
  end if;
  if m.user_id is not null then
    return jsonb_build_object('id', uid, 'name', m.full_name, 'email', m.email, 'role', m.role, 'companyId', m.company_id,
      'platform', false, 'canPlatform', p.user_id is not null, 'roles', roles);
  elsif p.user_id is not null then
    return jsonb_build_object('id', uid, 'name', p.full_name, 'email', p.email, 'role', 'platform', 'companyId', null,
      'platform', true, 'canPlatform', true, 'roles', roles);
  end if;
  return jsonb_build_object('id', uid, 'name', auth.jwt() ->> 'email', 'email', auth.jwt() ->> 'email', 'role', 'none', 'companyId', null,
    'platform', false, 'canPlatform', false, 'roles', '[]'::jsonb,
    'pendingRequest', exists (select 1 from access_requests where user_id = uid and status = 'pending'));
end $$;

-- Bytt rolle. null = plattformadministrator. Sjekkes mot rollene personen faktisk har.
create or replace function set_acting_role(p_company text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then perform _err('forbidden'); end if;
  if p_company is null then
    if not exists (select 1 from platform_admins where user_id = uid) then perform _err('forbidden'); end if;
  elsif not exists (select 1 from memberships where user_id = uid and company_id = p_company) then
    perform _err('forbidden');
  end if;
  insert into acting_roles(user_id, company_id, updated_at) values (uid, p_company, now())
    on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return my_context();
end $$;

-- Admindata for rollen personen jobber som nå
create or replace function get_admin_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); is_plat boolean := is_platform_admin(); plat boolean; my_co text; adm boolean; v_ids text[];
begin
  if uid is null then perform _err('forbidden'); end if;
  my_co := _acting_company();
  if my_co is null and not is_plat then
    select company_id into my_co from memberships where user_id = uid order by (role = 'admin') desc, created_at limit 1;
  end if;
  plat := is_plat and my_co is null;
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

-- ---------------------------------------------------------------- Rettigheter
revoke execute on function _acting_company() from public, anon, authenticated;
revoke execute on function set_acting_role(text) from public, anon;
grant execute on function set_acting_role(text) to authenticated;
revoke execute on function my_context() from public, anon;
grant execute on function my_context() to authenticated;
revoke execute on function get_admin_data() from public, anon;
grant execute on function get_admin_data() to authenticated;
