-- Fartøykontakt — forhåndsgodkjent tilgang (invitasjon).
-- En plattformadministrator kan gi en bestemt e-postadresse tilgang til et rederi før personen har logget inn.
-- Tilgangen opprettes automatisk første gang personen bekrefter e-postadressen sin ved innlogging (e-postlenken).
--
-- Regler:
--  * Bare plattformadministrator kan invitere, og bare til én bestemt e-postadresse og ett bestemt rederi.
--    Tilgang gis aldri ut fra domene eller organisasjonsnummer.
--  * Tilgangen gis først når e-postadressen er bekreftet (email_confirmed_at), altså når personen har brukt lenken.
--  * Invitasjoner kan trekkes tilbake før de er brukt. Alt lagres med hvem som inviterte og når.
--
-- Kun tillegg: én ny tabell, nye funksjoner og en trigger på auth.users. Ingen data endres eller slettes.

create table if not exists membership_invites (
  id              bigint generated always as identity primary key,
  email           text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  company_id      text not null references companies(id),
  role            text not null check (role in ('admin','member')),
  full_name       text not null,
  invited_by      uuid,
  invited_by_name text,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_user   uuid,
  revoked_at      timestamptz
);
create unique index if not exists membership_invites_open on membership_invites (lower(email), company_id) where accepted_at is null and revoked_at is null;
alter table membership_invites enable row level security;
drop policy if exists "plattform leser invitasjoner" on membership_invites;
create policy "plattform leser invitasjoner" on membership_invites for select
  using (exists (select 1 from platform_admins pa where pa.user_id = auth.uid()));

-- Gjør åpne invitasjoner for en bekreftet bruker om til tilgang
create or replace function _accept_invites(p_user uuid, p_email text) returns int
language plpgsql security definer set search_path = public as $$
declare i record; n int := 0;
begin
  for i in select * from membership_invites
            where lower(email) = lower(coalesce(p_email, '')) and accepted_at is null and revoked_at is null for update loop
    insert into memberships(user_id, company_id, role, full_name, email) values (p_user, i.company_id, i.role, i.full_name, lower(i.email))
      on conflict (user_id, company_id) do nothing;
    update membership_invites set accepted_at = now(), accepted_user = p_user where id = i.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function _on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform _accept_invites(new.id, new.email);
  end if;
  return new;
end $$;

drop trigger if exists fartoykontakt_accept_invites on auth.users;
create trigger fartoykontakt_accept_invites after insert or update of email_confirmed_at on auth.users
  for each row execute function _on_auth_user_confirmed();

-- Plattformadministrator: gi tilgang til en e-postadresse. Finnes brukeren allerede (bekreftet), gis tilgangen med en gang.
create or replace function invite_member(p_email text, p_company text, p_role text, p_full_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, ''))); uid uuid;
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  if not valid_email(e) or p_role not in ('admin','member') or coalesce(btrim(p_full_name), '') = '' then perform _err('invalid'); end if;
  if not exists (select 1 from companies where id = p_company) then perform _err('notfound'); end if;
  select id into uid from auth.users where lower(email) = e and email_confirmed_at is not null;
  if uid is not null then
    insert into memberships(user_id, company_id, role, full_name, email) values (uid, p_company, p_role, left(btrim(p_full_name), 120), e)
      on conflict (user_id, company_id) do update set role = excluded.role, full_name = excluded.full_name;
    return jsonb_build_object('status', 'granted');
  end if;
  insert into membership_invites(email, company_id, role, full_name, invited_by, invited_by_name)
  values (e, p_company, p_role, left(btrim(p_full_name), 120), auth.uid(), _actor_name())
  on conflict (lower(email), company_id) where accepted_at is null and revoked_at is null
  do update set role = excluded.role, full_name = excluded.full_name, invited_by = excluded.invited_by, invited_by_name = excluded.invited_by_name, created_at = now();
  return jsonb_build_object('status', 'invited');
end $$;

create or replace function revoke_invite(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then perform _err('forbidden'); end if;
  update membership_invites set revoked_at = now() where id = p_id and accepted_at is null and revoked_at is null;
  if not found then perform _err('notfound'); end if;
end $$;

revoke execute on function _accept_invites(uuid, text) from public, anon, authenticated;
revoke execute on function _on_auth_user_confirmed() from public, anon, authenticated;
revoke execute on function invite_member(text, text, text, text) from public, anon;
revoke execute on function revoke_invite(bigint) from public, anon;
grant execute on function invite_member(text, text, text, text) to authenticated;
grant execute on function revoke_invite(bigint) to authenticated;
