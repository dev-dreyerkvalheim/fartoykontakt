// Edge Function «registry-sync»: synkroniserer Fartøykontakt med Fiskeridirektoratets fartøyregister.
//
// Kalles av:
//  - nettsiden, når en plattformadministrator trykker «Synkroniser med Fiskeridirektoratet» eller godkjenner
//    en forhåndsvisning (Authorization: Bearer <brukerens innloggingstoken>)
//  - den nattlige jobben i databasen (pg_cron → pg_net), med topptekst x-registry-cron som sjekkes mot Vault
//
// Service-rollenøkkelen finnes bare her på serveren (miljøvariabel fra Supabase), aldri i nettleseren.
// Skrivingen skjer i databasefunksjonene registry_* (se supabase/migrations/20261028000005_fiskeridir_sync.sql).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import postgres from 'npm:postgres@3.4.4';
import { runSync } from './registry.js';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const admin = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// Direkte databasetilkobling (bare på serveren) for synkroniseringsfunksjonene: første import av ~5000 fartøy
// tar lengre tid enn Supabase-API-ets grense på 8 sekunder per spørring. Grensen heves bare i denne transaksjonen.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 20 });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SAFE_NAME = /^registry_[a-z_]+$/;
async function rpc(name: string, args: Record<string, unknown>) {
  if (!SAFE_NAME.test(name)) throw new Error('invalid');
  const keys = Object.keys(args);
  if (!keys.every((k) => /^p_[a-z_]+$/.test(k))) throw new Error('invalid');
  // JSON sendes som tekst og gjøres om i databasen (ellers koder driveren den én gang til)
  const isJson = keys.map((k) => args[k] !== null && typeof args[k] === 'object');
  const params = keys.map((k, i) => {
    const v = args[k];
    return v === null || v === undefined ? null : isJson[i] ? JSON.stringify(v) : String(v);
  });
  const call = keys.map((k, i) => `${k} => $${i + 1}${isJson[i] ? '::text::jsonb' : ''}`).join(', ');
  try {
    return await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '180s'`;
      const rows = await tx.unsafe(`select public.${name}(${call}) as r`, params);
      return rows[0]?.r;
    });
  } catch (e) {
    throw new Error((e as Error).message || String(e));
  }
}

// Hvem kaller? Returnerer { trigger, actor } eller null (avvist)
async function authorize(req: Request): Promise<{ trigger: 'manual' | 'schedule'; actor: string | null } | null> {
  const cron = req.headers.get('x-registry-cron');
  if (cron) {
    const { data, error } = await admin.rpc('registry_check_cron_secret', { p_secret: cron });
    return !error && data === true ? { trigger: 'schedule', actor: null } : null;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const user = createClient(URL_, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u, error: ue } = await user.auth.getUser(auth.slice(7));
  if (ue || !u?.user) return null;
  // Rollen sjekkes i databasen med brukerens eget token, ikke ut fra noe nettleseren sier om seg selv
  const { data: isAdmin, error } = await user.rpc('is_platform_admin');
  if (error || isAdmin !== true) return null;
  return { trigger: 'manual', actor: u.user.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const who = await authorize(req);
  if (!who) return json({ error: 'forbidden' }, 403);

  let body: { action?: string; runId?: number } = {};
  try { body = await req.json(); } catch (_) { /* tom kropp */ }
  const action = body.action || 'sync';

  // Godkjenn en forhåndsvisning (første import). Bare plattformadministrator.
  if (action === 'approve') {
    if (who.trigger !== 'manual' || !Number.isInteger(body.runId)) return json({ error: 'invalid' }, 400);
    try {
      const counts = await rpc('registry_apply', { p_run: body.runId, p_actor: who.actor });
      EdgeRuntime.waitUntil((async () => {
        try {
          const orgnrs = await rpc('registry_companies_to_check', { p_limit: 2000 });
          if (orgnrs.length) {
            const { fetchBrreg } = await import('./registry.js');
            await rpc('registry_set_company_names', { p_rows: await fetchBrreg(orgnrs, { sleep }) });
          }
        } catch (e) { console.error('Brønnøysund:', e); }
      })());
      return json({ ok: true, counts });
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 409);
    }
  }

  if (action !== 'sync' && action !== 'preview') return json({ error: 'invalid' }, 400);
  let run: { id: number; mode: 'preview' | 'apply' };
  try {
    run = await rpc('registry_start_run', {
      p_register: 'fiskeridir', p_mode: action === 'preview' ? 'preview' : 'apply', p_trigger: who.trigger, p_started_by: who.actor,
    });
  } catch (e) {
    const msg = String((e as Error).message || e);
    return json({ error: msg === 'busy' ? 'busy' : msg }, msg === 'busy' ? 409 : 500);
  }

  // Selve jobben kjører videre etter svaret; nettsiden følger fremdriften via registry_overview.
  EdgeRuntime.waitUntil((async () => {
    const res = await runSync({ rpc, runId: run.id, mode: run.mode, actor: who.actor, sleep, log: (m: string) => console.log(m) });
    console.log('registry-sync', run.id, JSON.stringify(res));
  })());
  return json({ ok: true, runId: run.id, mode: run.mode }, 202);
});
