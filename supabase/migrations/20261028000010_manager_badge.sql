-- Fartøykontakt — vis hvilket selskap som forvalter fartøyene (management).
-- Fartøykortene får feltet companies[].managedBy med navnet på forvalteren, slik at fartøysiden kan vise
-- «Forvaltes av …». Bare navnet på selskapet vises, aldri hvem som har tilgang.
-- Kun ny versjon av en eksisterende funksjon. Ingen data endres.

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
    'companies', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', cs.id, 'name', cs.name, 'orgnr', cs.orgnr, 'phone', coalesce(cs.phone, ''), 'email', coalesce(cs.email, ''),
                    'place', coalesce(cs.place, ''), 'demo', cs.source = 'demo', 'status', cs.brreg_status,
                    'managedBy', (select string_agg(m.name, ', ' order by m.name) from company_managers cm join companies m on m.id = cm.manager_id where cm.company_id = cs.id)))), '[]'::jsonb) from cs),
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
revoke execute on function _vessel_cards(text[]) from public, anon, authenticated;
