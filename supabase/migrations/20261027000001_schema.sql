-- Fartøykontakt — tabeller, hjelpefunksjoner og tilgangsregler (RLS)
-- Kjør i Supabase: SQL Editor → lim inn → Run. Kjør deretter 20261027000002_functions.sql og seed.sql.
--
-- Prinsipp: Nettleseren får aldri skrive direkte til tabellene. Alle endringer går gjennom
-- funksjonene i neste fil, som sjekker hvem brukeren er og hva hen har lov til.
-- Offentlig lesing skjer gjennom get_directory(), som bare returnerer det som skal være offentlig.


-- ---------------------------------------------------------------- Tabeller
create table if not exists companies (
  id         text primary key,                       -- kort id, f.eks. 'froyanes'
  name       text not null,
  orgnr      text not null unique check (orgnr ~ '^\d{9}$'),
  phone      text,
  email      text,
  place      text,
  created_at timestamptz not null default now()
);

create table if not exists vessels (
  id           text primary key,                     -- brukes i lenker: #fartoy-<id>
  company_id   text not null references companies(id) on delete restrict,
  name         text not null,
  reg_nr       text not null unique,                 -- senere: fra Fiskeridirektoratet
  callsign     text,
  vessel_type  text,
  length       text,
  home_port    text,
  bridge_phone text,
  alt_phone    text,
  email        text,
  updated_at   timestamptz not null default now()
);

-- Hvem som kan representere hvilket rederi
create table if not exists memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  role       text not null check (role in ('admin','member')),
  full_name  text not null,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table if not exists platform_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email     text not null
);

create table if not exists access_requests (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  orgnr        text not null,
  company_name text,
  basis        text not null check (basis in ('signatur','fullmakt')),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now()
);

-- Tidligere telefonnumre (status: confirmed / unconfirmed / reassigned / rejected)
create table if not exists number_history (
  id              text primary key default gen_random_uuid()::text,
  vessel_id       text not null references vessels(id) on delete cascade,
  number          text not null,
  replaced_at     date,
  replaced_by     text,
  status          text not null check (status in ('confirmed','unconfirmed','reassigned','rejected')),
  verified_at     date,
  verified_by     uuid,
  valid_until     date,
  source          text,
  show_on_profile boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists number_history_vessel on number_history(vessel_id);

-- Innmeldte feil fra publikum. «suggested» er aldri verifisert før en administrator godtar det.
create table if not exists reports (
  id               text primary key default gen_random_uuid()::text,
  vessel_id        text not null references vessels(id) on delete cascade,
  field            text check (field in ('bridgePhone','email')),
  reason           text not null check (length(reason) <= 120),
  current_value    text,
  suggested        text,
  details          text check (length(details) <= 500),
  contact          text check (length(contact) <= 120),
  status           text not null default 'new' check (status in ('new','accepted','corrected','rejected','resolved')),
  resolved_by      uuid,
  resolved_by_name text,
  resolved_at      timestamptz,
  resolved_value   text,
  reject_reason    text,
  resolution       text,
  created_at       timestamptz not null default now()
);
create index if not exists reports_vessel_status on reports(vessel_id, status);

-- Endringslogg (revisjonsspor). Skrives bare av funksjonene.
create table if not exists changes (
  id              text primary key default gen_random_uuid()::text,
  vessel_id       text not null references vessels(id) on delete cascade,
  field           text not null,
  from_value      text,
  to_value        text,
  actor           uuid,
  by_name         text,
  at              timestamptz not null default now(),
  status          text not null check (status in ('published','pending','approved','rejected','confirmed')),
  show_previous   boolean not null default false,
  via             text,
  report_id       text,
  decided_by_name text,
  decided_at      timestamptz
);
create index if not exists changes_vessel on changes(vessel_id);

-- «Bekreftet av rederiet»: én rad per bekreftet verdi. Tidspunkt settes alltid av databasen.
create table if not exists verifications (
  id       text primary key default gen_random_uuid()::text,
  scope    text not null check (scope in ('vessel','company')),
  scope_id text not null,
  field    text not null,
  value    text not null,
  at       timestamptz not null default now(),
  verified_by uuid,
  source   text
);
create index if not exists verifications_lookup on verifications(scope, scope_id, field, value, at desc);

create table if not exists settings (
  id            int primary key default 1 check (id = 1),
  verify_months int not null default 6 check (verify_months in (3,6,12))
);
insert into settings(id) values (1) on conflict do nothing;

-- Varsler som skal sendes på e-post (senere: Edge Function + e-posttjeneste leser herfra)
create table if not exists outbox (
  id       bigint generated always as identity primary key,
  to_email text not null,
  subject  text not null,
  key      text,
  at       timestamptz not null default now(),
  sent     boolean not null default false
);
create index if not exists outbox_dedupe on outbox(to_email, key, at desc);

-- ---------------------------------------------------------------- Hjelpefunksjoner
create or replace function is_company_admin(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and company_id = cid and role = 'admin');
$$;

create or replace function is_company_member(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and company_id = cid);
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- Samme regler som i nettleseren: «+47 000 11 201», «00011201» og «004700011201» gir samme nøkkel
create or replace function phone_key(raw text) returns text
language plpgsql immutable as $$
declare
  s text := btrim(coalesce(raw, ''));
  d text := regexp_replace(s, '\D', '', 'g');
  intl boolean := left(s, 1) = '+';
begin
  if not intl and left(d, 2) = '00' and (length(d) > 8 or left(d, 4) = '0047') then
    d := substr(d, 3); intl := true;
  end if;
  if intl then
    if left(d, 2) = '47' then return substr(d, 3); end if;
    return d;
  end if;
  if length(d) = 10 and left(d, 2) = '47' then return substr(d, 3); end if;
  return d;
end $$;

create or replace function norm_phone(raw text) returns text
language plpgsql immutable as $$
declare t text := regexp_replace(btrim(coalesce(raw, '')), '[\s().-]', '', 'g');
begin
  if t = '' then return ''; end if;
  if left(t, 2) = '00' and length(t) > 8 then t := '+' || substr(t, 3); end if;
  if t ~ '^47\d{8}$' then t := '+' || t; end if;
  if t ~ '^\d{8}$' then t := '+47' || t; end if;
  return t;
end $$;

create or replace function valid_phone(t text) returns boolean language sql immutable as $$ select coalesce(t, '') ~ '^\+\d{8,15}$' $$;
create or replace function valid_email(t text) returns boolean language sql immutable as $$ select coalesce(t, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' $$;

-- ---------------------------------------------------------------- Tilgangsregler (RLS)
alter table companies       enable row level security;
alter table vessels         enable row level security;
alter table memberships     enable row level security;
alter table platform_admins enable row level security;
alter table access_requests enable row level security;
alter table number_history  enable row level security;
alter table reports         enable row level security;
alter table changes         enable row level security;
alter table verifications   enable row level security;
alter table settings        enable row level security;
alter table outbox          enable row level security;

-- Offentlig katalog
drop policy if exists "alle kan lese rederier" on companies;
create policy "alle kan lese rederier" on companies for select using (true);
drop policy if exists "alle kan lese fartøy" on vessels;
create policy "alle kan lese fartøy" on vessels for select using (true);
drop policy if exists "alle kan lese innstillinger" on settings;
create policy "alle kan lese innstillinger" on settings for select using (true);

-- Egne medlemskap, og administratorer ser kolleger i samme rederi
drop policy if exists "se egne og kollegers medlemskap" on memberships;
create policy "se egne og kollegers medlemskap" on memberships for select
  using (user_id = auth.uid() or is_company_admin(company_id) or is_platform_admin());
drop policy if exists "se egen plattformrolle" on platform_admins;
create policy "se egen plattformrolle" on platform_admins for select using (user_id = auth.uid());
drop policy if exists "se egne søknader" on access_requests;
create policy "se egne søknader" on access_requests for select using (user_id = auth.uid() or is_platform_admin());

-- Innmeldte feil: bare administratorer i rederiet og plattformadministratorer (gir også sanntid)
drop policy if exists "admin ser rederiets meldinger" on reports;
create policy "admin ser rederiets meldinger" on reports for select
  using (is_platform_admin() or exists (select 1 from vessels v where v.id = vessel_id and is_company_admin(v.company_id)));

-- Endringslogg og nummerhistorikk: alle i rederiet
drop policy if exists "rederiet ser egen logg" on changes;
create policy "rederiet ser egen logg" on changes for select
  using (is_platform_admin() or exists (select 1 from vessels v where v.id = vessel_id and is_company_member(v.company_id)));
drop policy if exists "rederiet ser egne gamle numre" on number_history;
create policy "rederiet ser egne gamle numre" on number_history for select
  using (is_platform_admin() or exists (select 1 from vessels v where v.id = vessel_id and is_company_member(v.company_id)));

-- Varsler: bare egne
drop policy if exists "se egne varsler" on outbox;
create policy "se egne varsler" on outbox for select using (to_email = (auth.jwt() ->> 'email'));

-- verifications har ingen select-regel: offentlig status hentes via get_directory(), uten hvem som bekreftet.
-- Ingen insert/update/delete-regler noe sted: alt skrives via funksjonene i neste fil.
