-- Fartøykontakt — nattlig synkronisering med Fiskeridirektoratet.
-- Gjelder bare Supabase (bruker Vault, pg_net og pg_cron), og kjøres derfor ikke i de lokale testene.
--
-- Slik virker det: pg_cron starter registry_cron_tick() kl. 02:00 og 03:00 UTC. Funksjonen går bare videre
-- når klokken er 04:00 i Norge (02:00 UTC om sommeren, 03:00 UTC om vinteren), så sommertid håndteres riktig.
-- Den kaller Edge Function «registry-sync» med en hemmelighet fra Vault. Uttrekket fra Fiskeridirektoratet
-- oppdateres rundt kl. 02:30, så kjøringen skjer etter det.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Tilfeldig hemmelighet, laget i databasen. Brukes bare mellom databasen og vår egen Edge Function.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'registry_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'registry_cron_secret', 'Fartøykontakt: nattlig registersynk');
  end if;
  -- Adressen til Edge Function i dette prosjektet. Endre her ved flytting til et annet Supabase-prosjekt.
  if not exists (select 1 from vault.secrets where name = 'registry_function_url') then
    perform vault.create_secret('https://shqnisjfgkoirayykskt.supabase.co/functions/v1/registry-sync', 'registry_function_url', 'Fartøykontakt: adresse til registry-sync');
  end if;
end $$;

-- Brukes av Edge Function (service-rollen) for å kjenne igjen kall fra nattjobben
create or replace function registry_check_cron_secret(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p_secret) >= 32, false)
     and exists (select 1 from vault.decrypted_secrets where name = 'registry_cron_secret' and decrypted_secret = p_secret)
$$;
revoke execute on function registry_check_cron_secret(text) from public, anon, authenticated;
grant execute on function registry_check_cron_secret(text) to service_role;

create or replace function registry_cron_tick(p_force boolean default false, p_action text default 'sync') returns bigint
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if not p_force and extract(hour from (now() at time zone 'Europe/Oslo')) <> 4 then return null; end if;
  if p_action not in ('sync','preview') then raise exception 'invalid'; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'registry_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'registry_cron_secret';
  if v_url is null or v_secret is null then raise exception 'Mangler registry_function_url eller registry_cron_secret i Vault'; end if;
  return net.http_post(
    url := v_url,
    body := jsonb_build_object('action', p_action),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-registry-cron', v_secret),
    timeout_milliseconds := 15000);
end $$;
revoke execute on function registry_cron_tick(boolean, text) from public, anon, authenticated, service_role;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('fartoykontakt-registry-0200', 'fartoykontakt-registry-0300');
end $$;
select cron.schedule('fartoykontakt-registry-0200', '0 2 * * *', 'select public.registry_cron_tick()');
select cron.schedule('fartoykontakt-registry-0300', '0 3 * * *', 'select public.registry_cron_tick()');
