-- Innstramming etter Supabase sin sikkerhetssjekk (Security Advisor).
-- Supabase gir anon/authenticated rett til å kalle nye funksjoner som standard.
-- Her tar vi bort alt som ikke skal kunne kalles fra nettleseren, og låser search_path.

-- Hjelpefunksjoner: bare til bruk inne i databasen
revoke execute on function _actor_name() from public, anon, authenticated;
revoke execute on function _err(text) from public, anon, authenticated;
revoke execute on function _today() from public, anon, authenticated;
revoke execute on function _vessel_field(vessels, text) from public, anon, authenticated;
revoke execute on function _clean(text, text) from public, anon, authenticated;
revoke execute on function _apply_change(text, text, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function _notify(text, text, text, interval) from public, anon, authenticated;
revoke execute on function _notify_other_admins(text, text, text) from public, anon, authenticated;

-- Krever innlogging: ikke tilgjengelig for anon
revoke execute on function my_context() from public, anon;
revoke execute on function get_admin_data() from public, anon;
revoke execute on function request_access(text, text, text) from public, anon;
revoke execute on function submit_change(text, jsonb, boolean) from public, anon;
revoke execute on function decide_change(text, boolean) from public, anon;
revoke execute on function verify_vessel(text, jsonb, jsonb) from public, anon;
revoke execute on function accept_report(text, text, text, boolean) from public, anon;
revoke execute on function reject_report(text, text) from public, anon;
revoke execute on function set_number_status(text, text) from public, anon;
revoke execute on function run_reminders(text) from public, anon;
revoke execute on function set_verify_months(int) from public, anon;
revoke execute on function grant_membership(text, text, text, text) from public, anon;
revoke execute on function make_platform_admin(text, text) from public, anon;

-- Brukes av tilgangsreglene (RLS) som innlogget bruker, men skal ikke kunne kalles av anon
revoke execute on function is_company_admin(text) from public, anon;
revoke execute on function is_company_member(text) from public, anon;
revoke execute on function is_platform_admin() from public, anon;
grant execute on function is_company_admin(text) to authenticated;
grant execute on function is_company_member(text) to authenticated;
grant execute on function is_platform_admin() to authenticated;

-- Fast search_path på alle funksjoner
alter function _err(text) set search_path = public;
alter function _today() set search_path = public;
alter function _vessel_field(vessels, text) set search_path = public;
alter function _clean(text, text) set search_path = public;
alter function phone_key(text) set search_path = public;
alter function norm_phone(text) set search_path = public;
alter function valid_phone(text) set search_path = public;
alter function valid_email(text) set search_path = public;

-- Bekreftelser leses aldri direkte (bare via get_directory). Eksplisitt regel som avviser alt.
drop policy if exists "ingen direkte lesing" on verifications;
create policy "ingen direkte lesing" on verifications for select using (false);
