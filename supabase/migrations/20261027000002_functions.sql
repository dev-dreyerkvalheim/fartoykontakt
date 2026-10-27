-- Fartøykontakt — funksjoner (RPC) som nettsiden kaller.
-- Alle sjekker tilgang selv (security definer), låser radene de endrer (for update),
-- og skriver endringslogg. Feil returneres som korte koder: forbidden, conflict, already,
-- invalid, required, same, notfound, nofield, ratelimit, dup:<felt>.

-- ---------------------------------------------------------------- Interne hjelpere
create or replace function _err(code text) returns void language plpgsql as $$
begin raise exception using message = code, errcode = 'P0001'; end $$;

create or replace function _actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select full_name from memberships where user_id = auth.uid() order by created_at limit 1),
    (select full_name from platform_admins where user_id = auth.uid()),
    auth.jwt() ->> 'email', 'Ukjent');
$$;

create or replace function _today() returns date language sql stable as $$ select (now() at time zone 'Europe/Oslo')::date $$;

create or replace function _vessel_field(v vessels, f text) returns text language sql immutable as $$
  select coalesce(case f when 'bridgePhone' then v.bridge_phone when 'altPhone' then v.alt_phone when 'email' then v.email end, '')
$$;

create or replace function _clean(f text, raw text) returns text language plpgsql immutable as $$
declare t text;
begin
  if f like '%email' then t := btrim(coalesce(raw, '')); else t := norm_phone(raw); end if;
  if f = 'bridgePhone' and t = '' then perform _err('required'); end if;
  if t <> '' and ((f like '%email' and not valid_email(t)) or (f not like '%email' and not valid_phone(t))) then perform _err('invalid'); end if;
  return t;
end $$;

-- Varsel med demping: samme type til samme person sendes ikke igjen innen vinduet
create or replace function _notify(p_to text, p_subject text, p_key text, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_to, '') = '' then return; end if;
  if p_key is not null and exists (select 1 from outbox where to_email = p_to and key = p_key and at > now() - p_window) then return; end if;
  insert into outbox(to_email, subject, key) values (p_to, p_subject, p_key);
end $$;

create or replace function _notify_other_admins(p_company text, p_vessel text, p_subject text) returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select email from memberships where company_id = p_company and role = 'admin' and user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) loop
    perform _notify(m.email, p_subject, 'change:' || p_vessel, interval '1 hour');
  end loop;
end $$;

-- Publiser én endring: flytt gammelt nummer til historikken, oppdater fartøyet,
-- bekreft feltet hvis den som gjør det er administrator i rederiet, og lukk meldinger om samme felt.
create or replace function _apply_change(p_vessel text, p_field text, p_to text, p_actor uuid, p_actor_name text, p_via text, p_show_prev boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v vessels; old text; d date := _today(); k text;
begin
  select * into v from vessels where id = p_vessel for update;
  old := _vessel_field(v, p_field);
  if p_field in ('bridgePhone','altPhone') and coalesce(p_to, '') <> '' then
    k := phone_key(p_to);
    delete from number_history where vessel_id = p_vessel and phone_key(number) = k;
    update number_history set status = 'reassigned', verified_at = d
      where vessel_id <> p_vessel and phone_key(number) = k and status <> 'rejected';
  end if;
  if p_field in ('bridgePhone','altPhone') and old <> '' then
    insert into number_history(vessel_id, number, replaced_at, replaced_by, status, verified_at, verified_by, valid_until, source, show_on_profile)
    values (p_vessel, old, d, nullif(p_to, ''), 'confirmed', d, p_actor, d, 'Rederiet', p_field = 'bridgePhone' and coalesce(p_show_prev, false));
  end if;
  update vessels set
    bridge_phone = case when p_field = 'bridgePhone' then nullif(p_to, '') else bridge_phone end,
    alt_phone    = case when p_field = 'altPhone'    then nullif(p_to, '') else alt_phone end,
    email        = case when p_field = 'email'       then nullif(p_to, '') else email end,
    updated_at   = now()
  where id = p_vessel;
  if is_company_admin(v.company_id) and coalesce(p_to, '') <> '' then
    insert into verifications(scope, scope_id, field, value, verified_by, source) values ('vessel', p_vessel, p_field, p_to, p_actor, coalesce(p_via, 'change'));
  end if;
  update reports set status = 'resolved', resolved_by = p_actor, resolved_by_name = p_actor_name, resolved_at = now(), resolution = 'Rettet av rederiet'
    where vessel_id = p_vessel and status = 'new' and (field is null or field = p_field);
end $$;

-- ---------------------------------------------------------------- Offentlig lesing
-- Hele katalogen i ett kall (få forespørsler = bra på dårlig nett om bord).
-- Bekreftelser tas bare med for verdier som er i bruk nå, og uten hvem som bekreftet.
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
        'phone', coalesce(phone, ''), 'email', coalesce(email, ''), 'place', coalesce(place, '')) order by name), '[]'::jsonb) from companies),
    'vessels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'companyId', company_id, 'regNr', reg_nr,
        'callsign', coalesce(callsign, ''), 'type', coalesce(vessel_type, ''), 'length', coalesce(length, ''), 'homePort', coalesce(home_port, ''),
        'claimed', (bridge_phone is not null or email is not null),
        'bridgePhone', coalesce(bridge_phone, ''), 'altPhone', coalesce(alt_phone, ''), 'email', coalesce(email, ''),
        'updatedAt', to_char(updated_at at time zone 'Europe/Oslo', 'YYYY-MM-DD')) order by name), '[]'::jsonb) from vessels),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object('id', scope || ':' || scope_id || ':' || field, 'scope', scope, 'scopeId', scope_id,
        'field', field, 'value', value, 'at', to_char(at at time zone 'Europe/Oslo', 'YYYY-MM-DD"T"HH24:MI'))), '[]'::jsonb) from ver),
    -- Bare nummerbytter (dato/status) — selve nummeret bare når rederiet har valgt å vise det
    'numberInfo', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vesselId', vessel_id,
        'number', case when show_on_profile and status = 'confirmed' then number else null end,
        'replacedAt', replaced_at, 'status', status, 'showOnProfile', show_on_profile, 'source', source)), '[]'::jsonb)
      from number_history where replaced_at is not null and status in ('confirmed','reassigned') and replaced_at > _today() - 200),
    'settings', jsonb_build_object('verifyMonths', (select verify_months from settings where id = 1))
  );
$$;

-- Søk på gamle numre: hele nummeret, eller minst 6 siffer. Gir bare treff, ikke hele historikken.
create or replace function search_number_history(q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k text := phone_key(q);
begin
  if length(k) < 4 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'vesselId', h.vessel_id, 'number', h.number,
      'replacedAt', h.replaced_at, 'replacedBy', h.replaced_by, 'status', h.status, 'verifiedAt', h.verified_at,
      'source', h.source, 'showOnProfile', h.show_on_profile)), '[]'::jsonb)
    from number_history h
    where h.status <> 'rejected' and (phone_key(h.number) = k or (length(k) >= 6 and phone_key(h.number) like '%' || k || '%'))
    limit 20);
end $$;

-- Innmelding av feil — åpen for alle, men endrer aldri kontaktinformasjonen
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
  perform _notify(m.email, 'Nye innmeldte feil om fartøyene deres', 'reports:' || v.company_id, interval '1 hour')
    from memberships m where m.company_id = v.company_id and m.role = 'admin';
  return rid;
end $$;

-- ---------------------------------------------------------------- Innlogget bruker
create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from platform_admins where user_id = auth.uid()) then
      (select jsonb_build_object('id', user_id, 'name', full_name, 'email', email, 'role', 'platform', 'companyId', null) from platform_admins where user_id = auth.uid())
    when exists (select 1 from memberships where user_id = auth.uid()) then
      (select jsonb_build_object('id', user_id, 'name', full_name, 'email', email, 'role', role, 'companyId', company_id)
         from memberships where user_id = auth.uid() order by (role = 'admin') desc, created_at limit 1)
    else jsonb_build_object('id', auth.uid(), 'name', auth.jwt() ->> 'email', 'email', auth.jwt() ->> 'email', 'role', 'none', 'companyId', null,
      'pendingRequest', exists (select 1 from access_requests where user_id = auth.uid() and status = 'pending'))
  end;
$$;

-- Data for innloggede: meldinger, logg, nummerhistorikk, kolleger og egne varsler
create or replace function get_admin_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); plat boolean := is_platform_admin(); my_co text; adm boolean;
begin
  if uid is null then perform _err('forbidden'); end if;
  select company_id into my_co from memberships where user_id = uid order by (role = 'admin') desc, created_at limit 1;
  adm := my_co is not null and is_company_admin(my_co);
  if not plat and my_co is null then return jsonb_build_object('reports', '[]'::jsonb, 'changes', '[]'::jsonb, 'numberHistory', '[]'::jsonb, 'users', '[]'::jsonb, 'outbox', '[]'::jsonb); end if;
  return jsonb_build_object(
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

create or replace function request_access(p_orgnr text, p_basis text, p_full_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform _err('forbidden'); end if;
  if regexp_replace(coalesce(p_orgnr, ''), '\D', '', 'g') !~ '^\d{9}$' then perform _err('invalid'); end if;
  if p_basis not in ('signatur','fullmakt') then perform _err('invalid'); end if;
  insert into access_requests(user_id, email, full_name, orgnr, company_name, basis)
  values (auth.uid(), auth.jwt() ->> 'email', left(coalesce(p_full_name, ''), 120), regexp_replace(p_orgnr, '\D', '', 'g'),
          (select name from companies where orgnr = regexp_replace(p_orgnr, '\D', '', 'g')), p_basis);
end $$;

-- ---------------------------------------------------------------- Rederiet endrer
create or replace function submit_change(p_vessel text, p_changes jsonb, p_show_previous boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vessels; uid uuid := auth.uid(); adm boolean; nm text := _actor_name(); ch jsonb; f text; t text; cur text;
begin
  if uid is null then perform _err('forbidden'); end if;
  select * into v from vessels where id = p_vessel for update;
  if not found then perform _err('notfound'); end if;
  if not is_company_member(v.company_id) then perform _err('forbidden'); end if;
  adm := is_company_admin(v.company_id);
  for ch in select * from jsonb_array_elements(p_changes) loop
    f := ch ->> 'field';
    if f not in ('bridgePhone','altPhone','email') then perform _err('invalid'); end if;
    t := _clean(f, ch ->> 'to');
    cur := _vessel_field(v, f);
    if cur <> coalesce(ch ->> 'from', '') then perform _err('conflict'); end if;
    if not adm and exists (select 1 from changes where vessel_id = p_vessel and field = f and status = 'pending') then perform _err('dup:' || f); end if;
    insert into changes(vessel_id, field, from_value, to_value, actor, by_name, status, show_previous)
    values (p_vessel, f, cur, t, uid, nm, case when adm then 'published' else 'pending' end, f = 'bridgePhone' and coalesce(p_show_previous, false));
    if adm then perform _apply_change(p_vessel, f, t, uid, nm, 'change', p_show_previous); end if;
  end loop;
  perform _notify_other_admins(v.company_id, p_vessel,
    case when adm then nm || ' har endret kontaktinfo for ' || v.name else nm || ' har foreslått endring for ' || v.name end);
  return jsonb_build_object('published', adm);
end $$;

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
  select email into author_email from memberships where user_id = c.actor and company_id = v.company_id;
  perform _notify(author_email, case when p_approve then 'Endringen din er godkjent' else 'Endringen din ble avvist' end, null, interval '0');
end $$;

-- «Ja, informasjonen stemmer» — med eventuelle rettinger gjort i samme operasjon
create or replace function verify_vessel(p_vessel text, p_expected jsonb, p_edits jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vessels; c companies; uid uuid := auth.uid(); nm text := _actor_name(); cur jsonb; k text; val text; changed text[] := '{}';
begin
  select * into v from vessels where id = p_vessel for update;
  if not found then perform _err('notfound'); end if;
  if not is_company_admin(v.company_id) then perform _err('forbidden'); end if;
  select * into c from companies where id = v.company_id for update;
  cur := jsonb_build_object('bridgePhone', coalesce(v.bridge_phone, ''), 'altPhone', coalesce(v.alt_phone, ''), 'email', coalesce(v.email, ''),
                            'co.phone', coalesce(c.phone, ''), 'co.email', coalesce(c.email, ''));
  for k in select jsonb_object_keys(cur) loop
    if coalesce(p_expected ->> k, '') <> cur ->> k then perform _err('conflict'); end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(p_edits, '{}'::jsonb)) loop
    if not cur ? k then perform _err('invalid'); end if;
    val := _clean(k, p_edits ->> k);
    if val <> cur ->> k then
      changed := changed || k;
      insert into changes(vessel_id, field, from_value, to_value, actor, by_name, status, via) values (v.id, k, cur ->> k, val, uid, nm, 'published', 'verify');
      if k = 'co.phone' then update companies set phone = nullif(val, '') where id = c.id;
      elsif k = 'co.email' then update companies set email = nullif(val, '') where id = c.id;
      else perform _apply_change(v.id, k, val, uid, nm, 'verify', false);
      end if;
    end if;
  end loop;
  select * into v from vessels where id = p_vessel;
  select * into c from companies where id = v.company_id;
  insert into verifications(scope, scope_id, field, value, verified_by, source)
    select 'vessel', v.id, f, val2, uid, 'confirm' from (values ('bridgePhone', v.bridge_phone), ('altPhone', v.alt_phone), ('email', v.email)) x(f, val2) where val2 is not null
    union all
    select 'company', c.id, f, val2, uid, 'confirm' from (values ('phone', c.phone), ('email', c.email)) y(f, val2) where val2 is not null;
  insert into changes(vessel_id, field, from_value, to_value, actor, by_name, status) values (v.id, 'confirm', '', '', uid, nm, 'confirmed');
  update reports set status = 'resolved', resolved_by = uid, resolved_by_name = nm, resolved_at = now(), resolution = 'Bekreftet at opplysningene stemmer'
    where vessel_id = v.id and status = 'new';
  if array_length(changed, 1) > 0 then perform _notify_other_admins(v.company_id, v.id, nm || ' har endret kontaktinfo for ' || v.name); end if;
  return jsonb_build_object('changed', to_jsonb(changed));
end $$;

-- ---------------------------------------------------------------- Innmeldte feil
create or replace function accept_report(p_report text, p_value text, p_expected text, p_show_previous boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reports; v vessels; uid uuid := auth.uid(); nm text := _actor_name(); val text; cur text;
begin
  select * into r from reports where id = p_report for update;
  if not found then perform _err('notfound'); end if;
  select * into v from vessels where id = r.vessel_id for update;
  if not (is_company_admin(v.company_id) or is_platform_admin()) then perform _err('forbidden'); end if;
  if r.status <> 'new' then perform _err('already'); end if;
  if r.field is null then perform _err('nofield'); end if;
  val := _clean(r.field, p_value);
  cur := _vessel_field(v, r.field);
  if cur <> coalesce(p_expected, '') then perform _err('conflict'); end if;
  if val = cur then perform _err('same'); end if;
  insert into changes(vessel_id, field, from_value, to_value, actor, by_name, status, show_previous, via, report_id)
  values (v.id, r.field, cur, val, uid, nm, 'published', r.field = 'bridgePhone' and coalesce(p_show_previous, false), 'report', r.id);
  perform _apply_change(v.id, r.field, val, uid, nm, 'report', p_show_previous);
  update reports set status = case when val = r.suggested then 'accepted' else 'corrected' end,
    resolved_by = uid, resolved_by_name = nm, resolved_at = now(), resolved_value = val where id = r.id;
  perform _notify_other_admins(v.company_id, v.id, nm || ' har endret kontaktinfo for ' || v.name || ' etter innmeldt feil');
  if r.contact like '%@%' then perform _notify(r.contact, 'Takk! Kontaktinfo for ' || v.name || ' er rettet', null, interval '0'); end if;
  return jsonb_build_object('value', val, 'verified', is_company_admin(v.company_id));
end $$;

create or replace function reject_report(p_report text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r reports; v vessels; uid uuid := auth.uid(); nm text := _actor_name();
begin
  select * into r from reports where id = p_report for update;
  if not found then perform _err('notfound'); end if;
  select * into v from vessels where id = r.vessel_id;
  if not (is_company_admin(v.company_id) or is_platform_admin()) then perform _err('forbidden'); end if;
  if r.status <> 'new' then perform _err('already'); end if;
  update reports set status = 'rejected', resolved_by = uid, resolved_by_name = nm, resolved_at = now(), reject_reason = left(btrim(coalesce(p_reason, '')), 140) where id = r.id;
  insert into changes(vessel_id, field, from_value, to_value, actor, by_name, status, decided_by_name, report_id)
  values (v.id, 'report', r.reason, coalesce(nullif(btrim(p_reason), ''), 'Ingen begrunnelse'), uid, nm, 'rejected', nm, r.id);
end $$;

create or replace function set_number_status(p_history text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare h number_history; v vessels;
begin
  select * into h from number_history where id = p_history for update;
  if not found then perform _err('notfound'); end if;
  select * into v from vessels where id = h.vessel_id;
  if not is_company_admin(v.company_id) then perform _err('forbidden'); end if;
  if p_status not in ('confirmed','reassigned','rejected') then perform _err('invalid'); end if;
  update number_history set status = p_status, verified_at = _today(), verified_by = auth.uid() where id = h.id;
  insert into changes(vessel_id, field, from_value, to_value, actor, by_name, status)
  values (v.id, 'history', h.number,
          case p_status when 'confirmed' then 'Bekreftet som fartøyets nummer' when 'reassigned' then 'Tatt i bruk av andre' else 'Ikke fartøyets nummer' end,
          auth.uid(), _actor_name(), 'published');
end $$;

-- Påminnelser: én samlet melding per administrator, høyst hver 14. dag.
-- Kan kjøres fra nettsiden (når en administrator åpner Mine fartøy) og senere som cron-jobb.
create or replace function run_reminders(p_company text) returns void
language plpgsql security definer set search_path = public as $$
declare n int; m record; months int := (select verify_months from settings where id = 1);
begin
  if not is_company_admin(p_company) then return; end if;
  select count(*) into n from vessels v where v.company_id = p_company and exists (
    select 1 from (values ('bridgePhone', v.bridge_phone), ('altPhone', v.alt_phone), ('email', v.email)) x(f, val)
    where val is not null and not exists (
      select 1 from verifications w where w.scope = 'vessel' and w.scope_id = v.id and w.field = x.f and w.value = x.val
        and w.at > now() - make_interval(months => months)));
  if n = 0 then return; end if;
  for m in select email from memberships where company_id = p_company and role = 'admin' loop
    perform _notify(m.email, case when n = 1 then '1 fartøy må bekreftes på nytt' else n || ' fartøy må bekreftes på nytt' end, 'remind:' || p_company, interval '14 days');
  end loop;
end $$;

create or replace function set_verify_months(p_months int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  if p_months not in (3, 6, 12) then perform _err('invalid'); end if;
  update settings set verify_months = p_months where id = 1;
end $$;

-- ---------------------------------------------------------------- Administrasjon (kjøres i SQL Editor)
-- Gi en person tilgang til et rederi. Personen må ha logget inn én gang først.
--   select grant_membership('kari@firma.no', 'froyanes', 'admin', 'Kari Nordvik');
create or replace function grant_membership(p_email text, p_company text, p_role text, p_full_name text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if auth.uid() is not null and not is_platform_admin() then perform _err('forbidden'); end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then return 'Fant ingen bruker med e-post ' || p_email || '. Be personen logge inn én gang først.'; end if;
  insert into memberships(user_id, company_id, role, full_name, email) values (uid, p_company, p_role, p_full_name, lower(p_email))
    on conflict (user_id, company_id) do update set role = excluded.role, full_name = excluded.full_name;
  update access_requests set status = 'approved' where user_id = uid and status = 'pending';
  return 'OK: ' || p_full_name || ' er ' || p_role || ' i ' || p_company;
end $$;

--   select make_platform_admin('deg@firma.no', 'Ditt Navn');
create or replace function make_platform_admin(p_email text, p_full_name text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if auth.uid() is not null and not is_platform_admin() then perform _err('forbidden'); end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then return 'Fant ingen bruker med e-post ' || p_email || '. Logg inn én gang først.'; end if;
  insert into platform_admins(user_id, full_name, email) values (uid, p_full_name, lower(p_email)) on conflict (user_id) do nothing;
  return 'OK: ' || p_full_name || ' er plattformadministrator';
end $$;

-- ---------------------------------------------------------------- Rettigheter
-- Interne hjelpere skal ikke kunne kalles fra nettleseren.
revoke all on function _apply_change(text, text, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function _notify(text, text, text, interval) from public, anon, authenticated;
revoke all on function _notify_other_admins(text, text, text) from public, anon, authenticated;
revoke all on function grant_membership(text, text, text, text) from public, anon;
revoke all on function make_platform_admin(text, text) from public, anon;

grant execute on function get_directory() to anon, authenticated;
grant execute on function search_number_history(text) to anon, authenticated;
grant execute on function submit_report(text, text, text, text, text, text) to anon, authenticated;
grant execute on function my_context() to authenticated;
grant execute on function get_admin_data() to authenticated;
grant execute on function request_access(text, text, text) to authenticated;
grant execute on function submit_change(text, jsonb, boolean) to authenticated;
grant execute on function decide_change(text, boolean) to authenticated;
grant execute on function verify_vessel(text, jsonb, jsonb) to authenticated;
grant execute on function accept_report(text, text, text, boolean) to authenticated;
grant execute on function reject_report(text, text) to authenticated;
grant execute on function set_number_status(text, text) to authenticated;
grant execute on function run_reminders(text) to authenticated;
grant execute on function set_verify_months(int) to authenticated;
grant execute on function grant_membership(text, text, text, text) to authenticated;
grant execute on function make_platform_admin(text, text) to authenticated;
