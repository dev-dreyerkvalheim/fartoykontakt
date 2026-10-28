-- Fartøykontakt — forvaltning (management).
-- Et managementselskap (for eksempel Ervik Group AS) forvalter fartøyene til flere eierselskap.
-- Brukerne i managementselskapet får de samme rettighetene til eierselskapenes fartøy som eierselskapets egne brukere.
--
-- Regler:
--  * Forvaltning registreres bare av en plattformadministrator, for hånd. Den gis aldri automatisk
--    (ikke ut fra organisasjonsnummer, eierskap i registeret eller konsernforhold).
--  * Alle endringer i forvaltning logges i company_manager_log, og fjernede koblinger beholdes i loggen.
--  * Fartøyet tilhører fortsatt eierselskapet (vessels.company_id). Offentlige sider og synkroniseringen er uendret.
--  * Et eierselskap kan ha flere forvaltere. En forvalter kan ikke selv bli forvaltet videre (ett nivå).
--  * Rollevelgeren gjelder som før: en plattformadministrator har rettighetene bare mens forvalteren er valgt.
--
-- Kun tillegg: to nye tabeller og nye versjoner av eksisterende funksjoner. Ingen data endres eller slettes.

create table if not exists company_managers (
  manager_id    text not null references companies(id),
  company_id    text not null references companies(id),
  added_by      uuid,
  added_by_name text,
  note          text,
  added_at      timestamptz not null default now(),
  primary key (manager_id, company_id),
  check (manager_id <> company_id)
);
create index if not exists company_managers_company on company_managers (company_id);

create table if not exists company_manager_log (
  id         bigint generated always as identity primary key,
  manager_id text not null,
  company_id text not null,
  action     text not null check (action in ('added','removed')),
  note       text,
  actor      uuid,
  by_name    text,
  at         timestamptz not null default now()
);

alter table company_managers    enable row level security;
alter table company_manager_log enable row level security;
drop policy if exists "plattform og forvalter leser forvaltning" on company_managers;
create policy "plattform og forvalter leser forvaltning" on company_managers for select
  using (exists (select 1 from platform_admins pa where pa.user_id = auth.uid()) or exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id in (manager_id, company_managers.company_id)));
drop policy if exists "plattform leser forvaltningslogg" on company_manager_log;
create policy "plattform leser forvaltningslogg" on company_manager_log for select using (exists (select 1 from platform_admins pa where pa.user_id = auth.uid()));

-- ---------------------------------------------------------------- Rettigheter
-- Handler brukeren for rederiet cid, direkte eller som forvalter? (p_admin: bare som administrator)
create or replace function _acts_for(cid text, p_admin boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and (not p_admin or m.role = 'admin')
      and (m.company_id = cid or exists (select 1 from company_managers cm where cm.manager_id = m.company_id and cm.company_id = cid))
      and (not exists (select 1 from platform_admins where user_id = auth.uid()) or m.company_id is not distinct from _acting_company()));
$$;

create or replace function is_company_admin(cid text) returns boolean
language sql stable security definer set search_path = public as $$ select _acts_for(cid, true) $$;

create or replace function is_company_member(cid text) returns boolean
language sql stable security definer set search_path = public as $$ select _acts_for(cid, false) $$;

-- Rederiet selv og rederiene det forvalter
create or replace function _company_scope(cid text) returns text[]
language sql stable security definer set search_path = public as $$
  select case when cid is null then '{}'::text[]
    else array[cid] || coalesce((select array_agg(company_id order by company_id) from company_managers where manager_id = cid), '{}') end
$$;

-- Administratorer som skal varsles om et rederi: egne administratorer og forvalterens administratorer
create or replace function _company_admin_emails(cid text) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct m.email from memberships m
  where m.role = 'admin' and coalesce(m.email, '') <> ''
    and (m.company_id = cid or m.company_id in (select manager_id from company_managers where company_id = cid))
$$;

create or replace function _notify_other_admins(p_company text, p_vessel text, p_subject text) returns void
language plpgsql security definer set search_path = public as $$
declare e text; me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  for e in select * from _company_admin_emails(p_company) loop
    if lower(e) <> me then perform _notify(e, p_subject, 'change:' || p_vessel, interval '1 hour'); end if;
  end loop;
end $$;

-- Innmelding av feil: som før, men varsler også forvalterens administratorer
create or replace function submit_report(p_vessel text, p_field text, p_reason text, p_suggested text, p_details text, p_contact text)
returns text language plpgsql security definer set search_path = public as $$
declare v vessels; sug text; rid text;
begin
  select * into v from vessels where id = p_vessel;
  if not found then perform _err('notfound'); end if;
  if p_field is not null and p_field not in ('bridgePhone','email') then perform _err('invalid'); end if;
  if coalesce(btrim(p_reason), '') = '' then perform _err('invalid'); end if;
  if (select count(*) from reports where vessel_id = p_vessel and created_at > now() - interval '1 hour') >= 20 then perform _err('ratelimit'); end if;
  sug := null;
  if p_field is not null and coalesce(btrim(p_suggested), '') <> '' then
    sug := case when p_field = 'email' then btrim(p_suggested) else norm_phone(p_suggested) end;
    if (p_field = 'email' and not valid_email(sug)) or (p_field <> 'email' and not valid_phone(sug)) then perform _err('invalid'); end if;
  end if;
  insert into reports(vessel_id, field, reason, current_value, suggested, details, contact)
  values (p_vessel, p_field, left(p_reason, 120), case when p_field is null then null else nullif(_vessel_field(v, p_field), '') end,
          sug, left(coalesce(p_details, ''), 500), left(coalesce(p_contact, ''), 120))
  returning id into rid;
  perform _notify(e, 'Nye innmeldte feil om fartøyene deres', 'reports:' || v.company_id, interval '1 hour')
    from _company_admin_emails(v.company_id) e;
  return rid;
end $$;

-- Godkjenne forslag: forfatteren kan være i eierselskapet eller hos forvalteren
create or replace function decide_change(p_change text, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c changes; v vessels; uid uuid := auth.uid(); nm text := _actor_name(); author_email text;
begin
  select * into c from changes where id = p_change for update;
  if not found then perform _err('notfound'); end if;
  select * into v from vessels where id = c.vessel_id for update;
  if not is_company_admin(v.company_id) then perform _err('forbidden'); end if;
  if c.status <> 'pending' then perform _err('already'); end if;
  if _vessel_field(v, c.field) <> coalesce(c.from_value, '') then perform _err('conflict'); end if;
  update changes set status = case when p_approve then 'approved' else 'rejected' end, decided_by_name = nm, decided_at = now() where id = p_change;
  if p_approve then perform _apply_change(v.id, c.field, c.to_value, uid, nm, 'approval', c.show_previous); end if;
  select email into author_email from memberships
   where user_id = c.actor and company_id = any(_company_scope(v.company_id) || array(select manager_id from company_managers where company_id = v.company_id))
   order by created_at limit 1;
  perform _notify(author_email, case when p_approve then 'Endringen din er godkjent' else 'Endringen din ble avvist' end, null, interval '0');
end $$;

-- Påminnelser for rederiet og rederiene det forvalter
create or replace function run_reminders(p_company text) returns void
language plpgsql security definer set search_path = public as $$
declare n int; e text; months int := (select verify_months from settings where id = 1); scope text[] := _company_scope(p_company);
begin
  if not is_company_admin(p_company) then return; end if;
  select count(*) into n from vessels v where v.company_id = any(scope) and exists (
    select 1 from (values ('bridgePhone', v.bridge_phone), ('altPhone', v.alt_phone), ('email', v.email)) x(f, val)
    where val is not null and not exists (
      select 1 from verifications w where w.scope = 'vessel' and w.scope_id = v.id and w.field = x.f and w.value = x.val
        and w.at > now() - make_interval(months => months)));
  if n = 0 then return; end if;
  for e in select email from memberships where company_id = p_company and role = 'admin' loop
    perform _notify(e, case when n = 1 then '1 fartøy må bekreftes på nytt' else n || ' fartøy må bekreftes på nytt' end, 'remind:' || p_company, interval '14 days');
  end loop;
end $$;

-- Synkroniseringen: et fartøy er «i bruk» også når eierselskapet har en forvalter med brukere
create or replace function _vessel_is_managed(p_vessel text, p_company_a text, p_company_b text) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from vessels where id = p_vessel and (bridge_phone is not null or alt_phone is not null or email is not null))
      or exists (select 1 from verifications where scope = 'vessel' and scope_id = p_vessel)
      or exists (select 1 from number_history where vessel_id = p_vessel)
      or exists (select 1 from reports where vessel_id = p_vessel and status = 'new')
      or exists (select 1 from memberships where company_id in (p_company_a, p_company_b) and company_id <> 'privat')
      or exists (select 1 from company_managers cm join memberships m on m.company_id = cm.manager_id
                  where cm.company_id in (p_company_a, p_company_b) and cm.company_id <> 'privat')
$$;

-- ---------------------------------------------------------------- Kontekst og admindata
create or replace function my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); p platform_admins; m memberships; act text; roles jsonb;
begin
  if uid is null then return null; end if;
  select * into p from platform_admins where user_id = uid;
  select coalesce(jsonb_agg(jsonb_build_object('companyId', x.company_id, 'companyName', c.name, 'orgnr', c.orgnr, 'role', x.role,
           'manages', (select count(*) from company_managers cm where cm.manager_id = x.company_id)) order by c.name), '[]'::jsonb)
    into roles from memberships x join companies c on c.id = x.company_id where x.user_id = uid;
  act := _acting_company();
  if act is not null then
    select * into m from memberships where user_id = uid and company_id = act;
  elsif p.user_id is null then
    select * into m from memberships where user_id = uid order by (role = 'admin') desc, created_at limit 1;
  end if;
  if m.user_id is not null then
    return jsonb_build_object('id', uid, 'name', m.full_name, 'email', m.email, 'role', m.role, 'companyId', m.company_id,
      'manages', (select coalesce(jsonb_agg(company_id order by company_id), '[]'::jsonb) from company_managers where manager_id = m.company_id),
      'platform', false, 'canPlatform', p.user_id is not null, 'roles', roles);
  elsif p.user_id is not null then
    return jsonb_build_object('id', uid, 'name', p.full_name, 'email', p.email, 'role', 'platform', 'companyId', null, 'manages', '[]'::jsonb,
      'platform', true, 'canPlatform', true, 'roles', roles);
  end if;
  return jsonb_build_object('id', uid, 'name', auth.jwt() ->> 'email', 'email', auth.jwt() ->> 'email', 'role', 'none', 'companyId', null,
    'manages', '[]'::jsonb, 'platform', false, 'canPlatform', false, 'roles', '[]'::jsonb,
    'pendingRequest', exists (select 1 from access_requests where user_id = uid and status = 'pending'));
end $$;

create or replace function get_admin_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); is_plat boolean := is_platform_admin(); plat boolean; my_co text; adm boolean; scope text[]; v_ids text[]; cards jsonb;
begin
  if uid is null then perform _err('forbidden'); end if;
  my_co := _acting_company();
  if my_co is null and not is_plat then
    select company_id into my_co from memberships where user_id = uid order by (role = 'admin') desc, created_at limit 1;
  end if;
  plat := is_plat and my_co is null;
  adm := my_co is not null and is_company_admin(my_co);
  scope := _company_scope(my_co);
  if not plat and my_co is null then return jsonb_build_object('reports', '[]'::jsonb, 'changes', '[]'::jsonb, 'numberHistory', '[]'::jsonb, 'users', '[]'::jsonb, 'outbox', '[]'::jsonb, 'managers', '[]'::jsonb, 'cards', _vessel_cards('{}')); end if;
  select coalesce(array_agg(distinct id), '{}') into v_ids from (
    select id from vessels where company_id = any(scope)
    union select r.vessel_id from reports r join vessels v on v.id = r.vessel_id where plat or (adm and v.company_id = any(scope))) x;
  cards := _vessel_cards(v_ids);
  -- Eget rederi tas alltid med (et managementselskap eier ofte ingen fartøy selv)
  if my_co is not null and not exists (select 1 from jsonb_array_elements(cards -> 'companies') e where e ->> 'id' = my_co) then
    cards := jsonb_set(cards, '{companies}', (cards -> 'companies') || (select jsonb_build_array(jsonb_build_object('id', id, 'name', name, 'orgnr', orgnr,
      'phone', coalesce(phone, ''), 'email', coalesce(email, ''), 'place', coalesce(place, ''), 'demo', source = 'demo', 'status', brreg_status)) from companies where id = my_co));
  end if;
  return jsonb_build_object(
    'cards', cards,
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'vesselId', r.vessel_id, 'field', r.field, 'reason', r.reason,
        'current', coalesce(r.current_value, ''), 'suggested', r.suggested, 'details', coalesce(r.details, ''), 'contact', coalesce(r.contact, ''),
        'at', to_char(r.created_at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'), 'status', r.status,
        'resolvedBy', r.resolved_by_name, 'resolvedAt', to_char(r.resolved_at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'),
        'resolvedValue', r.resolved_value, 'rejectReason', r.reject_reason, 'resolution', r.resolution)), '[]'::jsonb)
      from reports r join vessels v on v.id = r.vessel_id
      where plat or (adm and v.company_id = any(scope))),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'vesselId', c.vessel_id, 'field', c.field, 'from', coalesce(c.from_value, ''),
        'to', coalesce(c.to_value, ''), 'by', c.actor, 'byName', c.by_name, 'at', to_char(c.at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'),
        'status', c.status, 'showPrevious', c.show_previous, 'via', c.via, 'reportId', c.report_id, 'decidedBy', c.decided_by_name)), '[]'::jsonb)
      from changes c join vessels v on v.id = c.vessel_id where v.company_id = any(scope)),
    'numberHistory', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'vesselId', h.vessel_id, 'number', h.number,
        'replacedAt', h.replaced_at, 'replacedBy', h.replaced_by, 'status', h.status, 'verifiedAt', h.verified_at,
        'source', h.source, 'showOnProfile', h.show_on_profile)), '[]'::jsonb)
      from number_history h join vessels v on v.id = h.vessel_id where v.company_id = any(scope)),
    'users', (select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.full_name, 'role', m.role, 'companyId', m.company_id,
        'email', case when adm then m.email else null end)), '[]'::jsonb)
      from memberships m where m.company_id = my_co),
    -- Plattformadministrator: alle forvaltninger, til oversikten
    'managers', case when plat then (select coalesce(jsonb_agg(jsonb_build_object('managerId', cm.manager_id, 'managerName', a.name, 'managerOrgnr', a.orgnr,
        'companyId', cm.company_id, 'companyName', b.name, 'companyOrgnr', b.orgnr, 'vessels', (select count(*) from vessels v where v.company_id = cm.company_id),
        'addedBy', cm.added_by_name, 'at', to_char(cm.added_at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'), 'note', cm.note) order by a.name, b.name), '[]'::jsonb)
      from company_managers cm join companies a on a.id = cm.manager_id join companies b on b.id = cm.company_id) else '[]'::jsonb end,
    'outbox', (select coalesce(jsonb_agg(jsonb_build_object('to', o.to_email, 'subject', o.subject, 'key', o.key,
        'at', to_char(o.at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI')) order by o.at), '[]'::jsonb)
      from (select * from outbox where to_email = (auth.jwt() ->> 'email') order by at desc limit 20) o)
  );
end $$;

-- ---------------------------------------------------------------- Plattformadministrator: registrere forvaltning
-- Forvalteren angis med organisasjonsnummer. Finnes ikke selskapet i Fartøykontakt, opprettes det med navnet
-- som er hentet fra Enhetsregisteret (p_manager_name). Eierselskapene angis med organisasjonsnummer.
create or replace function add_company_managers(p_manager_orgnr text, p_manager_name text, p_company_orgnrs text[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text := _actor_name(); mo text := regexp_replace(coalesce(p_manager_orgnr, ''), '\D', '', 'g');
        mgr text; o text; cid text; added int := 0; already int := 0; missing text[] := '{}';
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  if mo !~ '^\d{9}$' then perform _err('invalid'); end if;
  if coalesce(array_length(p_company_orgnrs, 1), 0) = 0 then perform _err('required'); end if;
  select id into mgr from companies where orgnr = mo;
  if mgr is null then
    if coalesce(btrim(p_manager_name), '') = '' then perform _err('notfound'); end if;
    mgr := 'org-' || mo;
    insert into companies(id, name, orgnr, source, brreg_checked_at) values (mgr, left(btrim(p_manager_name), 200), mo, 'system', now());
  end if;
  if exists (select 1 from company_managers where company_id = mgr) then perform _err('nested'); end if;
  foreach o in array p_company_orgnrs loop
    o := regexp_replace(coalesce(o, ''), '\D', '', 'g');
    select id into cid from companies where orgnr = o;
    if cid is null or o !~ '^\d{9}$' then missing := missing || o; continue; end if;
    if cid = mgr or cid = 'privat' then perform _err('invalid'); end if;
    if exists (select 1 from company_managers where manager_id = cid) then perform _err('nested'); end if;
    if exists (select 1 from company_managers where manager_id = mgr and company_id = cid) then already := already + 1; continue; end if;
    insert into company_managers(manager_id, company_id, added_by, added_by_name, note) values (mgr, cid, uid, nm, left(p_note, 300));
    insert into company_manager_log(manager_id, company_id, action, note, actor, by_name) values (mgr, cid, 'added', left(p_note, 300), uid, nm);
    added := added + 1;
  end loop;
  return jsonb_build_object('managerId', mgr, 'added', added, 'already', already, 'missing', to_jsonb(missing));
end $$;

create or replace function remove_company_manager(p_manager text, p_company text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text := _actor_name();
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  delete from company_managers where manager_id = p_manager and company_id = p_company;
  if not found then perform _err('notfound'); end if;
  insert into company_manager_log(manager_id, company_id, action, note, actor, by_name) values (p_manager, p_company, 'removed', left(p_note, 300), uid, nm);
end $$;

-- ---------------------------------------------------------------- Rettigheter
revoke execute on function _acts_for(text, boolean) from public, anon, authenticated;
revoke execute on function _company_scope(text) from public, anon, authenticated;
revoke execute on function _company_admin_emails(text) from public, anon, authenticated;
revoke execute on function _notify_other_admins(text, text, text) from public, anon, authenticated;
revoke execute on function _vessel_is_managed(text, text, text) from public, anon, authenticated;
revoke execute on function add_company_managers(text, text, text[], text) from public, anon;
revoke execute on function remove_company_manager(text, text, text) from public, anon;
grant execute on function add_company_managers(text, text, text[], text) to authenticated;
grant execute on function remove_company_manager(text, text, text) to authenticated;
revoke execute on function decide_change(text, boolean) from public, anon;
grant execute on function decide_change(text, boolean) to authenticated;
revoke execute on function run_reminders(text) from public, anon;
grant execute on function run_reminders(text) to authenticated;
revoke execute on function my_context() from public, anon;
grant execute on function my_context() to authenticated;
revoke execute on function get_admin_data() from public, anon;
grant execute on function get_admin_data() to authenticated;
grant execute on function submit_report(text, text, text, text, text, text) to anon, authenticated;
