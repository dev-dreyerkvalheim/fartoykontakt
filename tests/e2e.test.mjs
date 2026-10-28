// Ende-til-ende: nettsiden i Supabase-modus mot Postgres med våre migrasjoner. Kjør: npm test
// Ende-til-ende: nettsiden i Supabase-modus mot en ekte Postgres (PGlite) med våre migrasjoner
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import { runSync } from '../supabase/functions/registry-sync/registry.js';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const R = ROOT + 'supabase/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const pg = new PGlite({ extensions: { pg_trgm } });
await pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon; create role authenticated; create role service_role bypassrls;`);
for (const f of ['migrations/20261027000001_schema.sql', 'migrations/20261027000002_functions.sql', 'migrations/20261027000003_hardening.sql', 'seed.sql', 'migrations/20261027000004_register_import.sql', 'migrations/20261028000005_fiskeridir_sync.sql', 'migrations/20261028000007_registry_perf.sql', 'migrations/20261028000008_acting_role.sql', 'migrations/20261028000009_company_managers.sql']) await pg.exec(fs.readFileSync(R + f, 'utf8'));
const U = { kari:'11111111-1111-1111-1111-111111111111', jonas:'22222222-2222-2222-2222-222222222222', ola:'44444444-4444-4444-4444-444444444444', ny:'66666666-6666-6666-6666-666666666666', per:'77777777-7777-7777-7777-777777777777' };
for (const [n, id] of Object.entries(U)) await pg.query(`insert into auth.users values ($1,$2)`, [id, n + '@eksempel.no']);
await pg.exec(`select grant_membership('kari@eksempel.no','froyanes','admin','Kari Nordvik'); select grant_membership('jonas@eksempel.no','froyanes','member','Jonas Vik'); select make_platform_admin('ola@eksempel.no','Ola Drift');`);

let current = null; const listeners = []; let otpTo = null; let rpcCount = 0; const rpcNames = []; const invoked = [];
// Etterligner Edge Function «registry-sync»: samme kode (runSync) mot databasen, med et etterlignet API fra Fiskeridirektoratet
const svc = async (fn, args) => { const keys = Object.keys(args); const r = await pg.query(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])); return r.rows[0].r; };
const FD = [
  { id: '0020010149', name: 'HAVØRN', registrationMark: 'M 0777HØ', radioCallSign: 'LMNO', municipalityCode: '1508', length: 21.5, buildYear: 1999, owners: [{ id: '912345678', entityType: 'COMPANY', name: 'HAVØRN FISKE AS', postalCode: '6000', city: 'ÅLESUND' }] },
  { id: '0020010150', name: 'LILLE SKJÆR', registrationMark: 'N 0012B', radioCallSign: null, municipalityCode: '1804', length: 8.2, owners: [{ id: '12345678901', entityType: 'PERSON', name: 'PER PERSON' }] }
];
const fdFetch = async url => url.includes('geonorge') ? { ok: true, status: 200, headers: { get: () => null }, json: async () => [{ kommunenummer: '1508', kommunenavnNorsk: 'Ålesund' }, { kommunenummer: '1804', kommunenavnNorsk: 'Bodø' }, ...Array.from({ length: 355 }, (_, i) => ({ kommunenummer: String(3000 + i), kommunenavnNorsk: 'K' + i }))] }
  : { ok: true, status: 200, headers: { get: k => k.toLowerCase() === 'x-totalcount' ? String(FD.length) : null }, json: async () => new URL(url).searchParams.get('page') === '1' ? FD : [] };
const functionsMock = { invoke: async (name, { body }) => {
  invoked.push({ name, body, as: current });
  if (current !== 'ola') return { data: null, error: { context: { json: async () => ({ error: 'forbidden' }) } } };
  try {
    if (body.action === 'approve') return { data: { ok: true, counts: await svc('registry_apply', { p_run: body.runId, p_actor: U.ola }) }, error: null };
    const run = await svc('registry_start_run', { p_register: 'fiskeridir', p_mode: 'apply', p_trigger: 'manual', p_started_by: U.ola });
    await runSync({ rpc: svc, runId: run.id, mode: run.mode, actor: U.ola, fetchImpl: fdFetch, sleep: async () => {} });
    return { data: { ok: true, runId: run.id, mode: run.mode }, error: null };
  } catch (e) { return { data: null, error: { context: { json: async () => ({ error: e.message }) } } }; }
} };
const fire = ev => listeners.forEach(cb => cb(ev, current ? { user: { id: U[current] } } : null));
const mockClient = () => ({
  functions: functionsMock,
  rpc: async (fn, args = {}) => {
    rpcCount++; rpcNames.push(fn);
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [current ? U[current] : '', current ? JSON.stringify({ email: current + '@eksempel.no' }) : '']);
    const keys = Object.keys(args);
    const pgArr = a => '{' + a.map(x => '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
    const params = keys.map(k => Array.isArray(args[k]) && args[k].every(x => typeof x === 'string') ? pgArr(args[k]) : args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]);
    try { const r = await pg.query(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, params); return { data: r.rows[0].r, error: null }; }
    catch (e) { return { data: null, error: { message: e.message } }; }
  },
  auth: {
    getSession: async () => ({ data: { session: current ? { user: { id: U[current] } } : null } }),
    signInWithOtp: async ({ email }) => { otpTo = email; return { error: null }; },
    signOut: async () => { current = null; fire('SIGNED_OUT'); return { error: null }; },
    onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; }
  }
});

// Bygger en testside der main.js kjører som vanlig script, så testene kan lese tilstanden
const idx = fs.readFileSync(ROOT + 'index.html', 'utf8');
const body = idx.slice(idx.indexOf('<body>') + 6, idx.indexOf('<script type="module"'));
const js = fs.readFileSync(ROOT + 'src/main.js', 'utf8').replace(/^import .*$/mg, '').replace("(typeof import.meta !== 'undefined' && import.meta.env) || {}", '(window.__ENV || {})');
const html = `<style>${fs.readFileSync(ROOT + 'src/styles.css', 'utf8')}</style>${body}<script>${js}</script>`;
const errors = [];
const dom = new JSDOM('<!doctype html><html><head></head><body>' + html + '</body></html>', {
  url: 'https://fartoykontakt-demo.netlify.app/#sok', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w){ w.__ENV = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }; w.createClient = mockClient;
    w.matchMedia = () => ({ matches:false }); w.scrollTo = () => {}; w.TextDecoder = TextDecoder; w.Element.prototype.scrollIntoView = () => {}; w.onerror = m => errors.push(m); w.fetch = async () => ({ ok:false }); }
});
const w = dom.window, d = w.document, E = s => w.eval(s), app = () => d.getElementById('app');
const go = async h => { w.location.hash = 'x'; await sleep(10); w.location.hash = h; await sleep(150); };
const login = async who => { current = who; fire('SIGNED_IN'); await sleep(400); };
await sleep(500);

ok(E('REMOTE') === true && E('db.vessels.length') > 0 && E('db.vessels.length') < 13 && !rpcNames.includes('get_directory') && rpcNames.includes('get_home'), `Starter i Supabase-modus uten å hente hele registeret (${E('db.vessels.length')} av 13 fartøy lastet)`);
ok(!d.getElementById('simulate-report') && !d.getElementById('reset-demo'), 'Demo-knapper skjult');
ok(!JSON.stringify(E('db.verifications')).includes('"by"'), 'Offentlige bekreftelser uten hvem');
const input = d.getElementById('q');
input.value = 'Frøy'; input.dispatchEvent(new w.Event('input')); await sleep(300);
ok(app().querySelectorAll('.result').length >= 3 && rpcNames.includes('search_directory'), 'Søk på navn skjer i databasen');
input.value = '000 97 101'; input.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Du søkte på et tidligere telefonnummer') && app().textContent.includes('Bergholm'), 'Skjult gammelt nummer finnes via databasen');
input.value = '000 98 401'; input.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Ring nytt nummer'), 'Bekreftet gammelt nummer: «Ring nytt nummer»');

// Delt lenke til et fartøy som ikke er lastet ennå
ok(!E(`api.getVessel('kvitholmen')`), 'Kvitholmen er ikke lastet');
await go('fartoy-kvitholmen');
ok(app().querySelector('h1')?.textContent === 'Kvitholmen' || app().querySelector('h1')?.textContent.length > 0 && rpcNames.includes('get_vessel_public'), 'Delt lenke: fartøyet hentes fra databasen');
await go('fartoy-froyanes');
ok(app().querySelector('.vbadge')?.textContent.trim() === 'Bekreftet av rederiet' && app().querySelector('.vdate').textContent === 'Sist bekreftet 14. oktober 2026', 'Profil viser «Bekreftet av rederiet — 14. oktober 2026»');
await go('fartoy-nordsjobas');
ok(app().querySelector('.vbadge')?.textContent.trim() === 'Delvis bekreftet av rederiet', 'Nordsjøbas delvis');

// Publikum melder feil
await go('meld-feil-lofotkyst');
d.getElementById('reason-1').click(); d.getElementById('reason-1').dispatchEvent(new w.Event('change', { bubbles:true }));
d.getElementById('suggested').value = '000 88 199';
d.getElementById('report-form').dispatchEvent(new w.Event('submit', { cancelable:true, bubbles:true })); await sleep(400);
ok(app().textContent.includes('Takk for at du sa fra') && (await pg.query(`select count(*)::int n from reports where vessel_id='lofotkyst' and suggested='+4700088199'`)).rows[0].n === 1, 'Innmelding lagret i databasen');

// Innlogging
await go('logg-inn');
d.getElementById('otp-email').value = 'kari@eksempel.no';
d.getElementById('otp-form').dispatchEvent(new w.Event('submit', { cancelable:true, bubbles:true })); await sleep(100);
ok(otpTo === 'kari@eksempel.no' && app().textContent.includes('Sjekk e-posten din'), 'E-postlenke sendt');
await login('kari');
ok(w.location.hash === '#mine-fartoy' && app().querySelector('h1').textContent === 'Mine fartøy', 'Etter innlogging: Mine fartøy');
ok(d.querySelector('.nav-badge')?.textContent.trim() === '3', 'Varselmerke viser 3 meldinger');

// Godta endring
await go('innmeldte-feil');
app().querySelector('[data-report="r2"] [data-accept]').click(); await sleep(50);
d.getElementById('m-ok').click(); await sleep(600);
ok((await pg.query(`select bridge_phone from vessels where id='froyanes'`)).rows[0].bridge_phone === '+4700011205', 'Godta endring oppdaterer databasen');
ok(app().textContent.includes('merket som bekreftet av rederiet'), 'Melding om bekreftelse');

// Bekreft fartøy
await go('mine-fartoy');
const row = id => app().querySelector(`.vrow[data-vessel="${id}"]`);
ok(row('froyvik').querySelector('[data-verify]').textContent === 'Bekreft nå', 'Frøyvik: «Bekreft nå»');
row('froyvik').querySelector('[data-verify]').click(); await sleep(50);
row('froyvik').querySelector('[data-vok]').click(); await sleep(700);
ok(E(`vesselVerification(api.getVessel('froyvik')).state`) === 'verified', 'Frøyvik bekreftet via databasen');
ok((await pg.query(`select count(*)::int n from verifications where scope_id='froyvik' and verified_by=$1`, [U.kari])).rows[0].n >= 2, 'Bekreftelser lagret med hvem');

// Konflikt: noen endrer i databasen mens Kari har panelet åpent
row('froyfjord').querySelector('[data-verify]').click(); await sleep(50);
await pg.query(`update vessels set alt_phone='+4700011398' where id='froyfjord'`);
row('froyfjord').querySelector('[data-vok]').click(); await sleep(500);
ok(row('froyfjord').querySelector('.vp-err')?.textContent.includes('endret kontaktinformasjonen'), 'Samtidig endring stoppes av databasen');

// Medarbeider
current = null; fire('SIGNED_OUT'); await sleep(300);
await login('jonas'); await go('mine-fartoy');
ok(!app().querySelector('[data-verify]') && !app().querySelector('#innmeldte-feil'), 'Medarbeider: ingen bekreft-knapp eller meldinger');

// Ny bruker uten tilgang
current = null; fire('SIGNED_OUT'); await sleep(300);
await login('ny'); await go('mine-fartoy');
ok(app().querySelector('h1').textContent === 'Be om tilgang til rederiet', 'Ny bruker får søknadsskjema');
d.getElementById('req-name').value = 'Nils Ny'; d.getElementById('req-org').value = '000111222';
d.querySelector('input[name="basis"][value="fullmakt"]').checked = true;
d.getElementById('req-form').dispatchEvent(new w.Event('submit', { cancelable:true, bubbles:true })); await sleep(400);
ok((await pg.query(`select count(*)::int n from access_requests where full_name='Nils Ny' and company_name='Frøyanes Rederi AS'`)).rows[0].n === 1 && app().textContent.includes('Søknaden din er sendt'), 'Søknad om tilgang lagret');

// Plattformadmin
current = null; fire('SIGNED_OUT'); await sleep(300);
await login('ola'); await go('mine-fartoy');
ok(app().querySelector('h1').textContent === 'Innmeldte feil' && app().textContent.includes('Lofotkyst'), 'Plattformadmin ser alle meldinger');
const sel = d.getElementById('verify-months'); sel.value = '12'; sel.dispatchEvent(new w.Event('change', { bubbles:true })); await sleep(500);
ok((await pg.query(`select verify_months from settings`)).rows[0].verify_months === 12, 'Innstilling lagret');

// Fartøyregister: synkronisering, forhåndsvisning og godkjenning
const contactBefore = (await pg.query(`select string_agg(id||coalesce(bridge_phone,'')||coalesce(alt_phone,'')||coalesce(email,'')||updated_at::text, '|' order by id) s from vessels`)).rows[0].s;
const verBefore = (await pg.query(`select count(*)::int n, max(at)::text m from verifications`)).rows[0];
await go('mine-fartoy');
ok(!!app().querySelector('a[href="#fartoyregister"]'), 'Plattformadmin har lenke til Fartøyregister');
await go('importer'); await sleep(300);
ok(w.location.hash === '#fartoyregister' && app().querySelector('h1')?.textContent === 'Fartøyregister', 'Gammel import-lenke går til Fartøyregister');
ok(app().textContent.includes('Første gang lages en forhåndsvisning'), 'Forklarer forhåndsvisning før første import');
d.getElementById('reg-sync').click(); await sleep(900);
ok(invoked.length === 1 && invoked[0].name === 'registry-sync' && invoked[0].body.action === 'sync', 'Knappen kaller Edge Function registry-sync');
ok(!!d.getElementById('pv-approve') && app().textContent.includes('Første import: forhåndsvisning') && app().textContent.includes('2 nye fartøy'), 'Forhåndsvisning vises med 2 nye fartøy');
ok((await pg.query(`select count(*)::int n from vessel_identifiers`)).rows[0].n === 0, 'Ingenting importert før godkjenning');
d.getElementById('pv-approve').click(); await sleep(900);
ok((await pg.query(`select count(*)::int n from vessel_identifiers`)).rows[0].n === 2 && invoked[1].body.action === 'approve' && Number.isInteger(invoked[1].body.runId), 'Godkjent: 2 fartøy importert');
ok(app().textContent.includes('Synkronisert') && !d.getElementById('pv-approve'), 'Status: synkronisert');
ok((await pg.query(`select string_agg(id||coalesce(bridge_phone,'')||coalesce(alt_phone,'')||coalesce(email,'')||updated_at::text, '|' order by id) s from vessels where id not like 'fd-%'`)).rows[0].s === contactBefore, 'Kontaktinformasjon og tidsstempler uendret');
const verAfter = (await pg.query(`select count(*)::int n, max(at)::text m from verifications`)).rows[0];
ok(verAfter.n === verBefore.n && verAfter.m === verBefore.m, 'Ingen nye «Bekreftet av rederiet»');
ok((await pg.query(`select count(*)::int n from vessels where name ilike '%person%'`)).rows[0].n === 0 && !(await pg.query(`select string_agg(owners::text, '') s from registry_staging`)).rows[0].s?.includes('PER PERSON'), 'Personeiers navn er ikke lagret');

// Andre forsøk mens noe kjører: avvises på serveren
await pg.query(`insert into registry_runs(register, mode, trigger) values ('fiskeridir','apply','manual')`);
await go('fartoyregister'); await sleep(300);
ok(d.getElementById('reg-sync')?.disabled === true && app().textContent.includes('Synkroniserer'), 'Knappen er låst mens en synkronisering pågår');
await pg.query(`update registry_runs set status='failed', error='test' where status='running'`);
await go('fartoyregister'); await sleep(300);
ok(app().textContent.includes('Siste synkronisering feilet') && app().textContent.includes('beholdes'), 'Feilet kjøring vises, forrige data beholdes');

// Rollevelger: plattformadmin som også er administrator i Frøyanes
await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
await pg.exec(`select grant_membership('ola@eksempel.no','froyanes','admin','Ola Drift')`);
await w.eval('refreshAll()'); await go('mine-fartoy');
const rs = () => d.getElementById('role-switch');
ok(!!rs() && rs().value === '' && rs().options.length === 2 && app().querySelector('h1').textContent === 'Innmeldte feil', 'Rollevelger vises, starter som plattformadministrator');
ok(!app().querySelector('[data-verify]') && app().textContent.includes('blir ikke merket «Bekreftet av rederiet»'), 'Som plattformadministrator: ingen bekreft-knapp, forklaring vises');
rs().value = 'froyanes'; rs().dispatchEvent(new w.Event('change', { bubbles:true })); await sleep(700);
ok(app().querySelector('h1').textContent === 'Mine fartøy' && app().textContent.includes('Frøyanes Rederi AS') && rs().value === 'froyanes', 'Bytter til rederiet');
ok(!!app().querySelector('[data-verify]') && !app().querySelector('a[href="#fartoyregister"]'), 'Som rederi: bekreft-knapp, ingen plattformverktøy');
ok((await pg.query(`select company_id from acting_roles where user_id=$1`, [U.ola])).rows[0]?.company_id === 'froyanes', 'Valget lagret på serveren');
const vBtn = app().querySelector('[data-verify]'); const vId = vBtn.closest('.vrow').dataset.vessel; vBtn.click(); await sleep(100);
app().querySelector('[data-vok]').click(); await sleep(700);
ok((await pg.query(`select by_name from changes where vessel_id=$1 and field='confirm' order by at desc limit 1`, [vId])).rows[0]?.by_name === 'Ola Drift', 'Bekreftet som rederi, logget med navnet i rederiet');
await go('fartoyregister'); await sleep(200);
ok(app().textContent.includes('Bytt til plattformadministrator'), 'Fartøyregisteret ber om bytte til plattformadministrator');
await go('mine-fartoy');
rs().value = ''; rs().dispatchEvent(new w.Event('change', { bubbles:true })); await sleep(700);
ok(app().querySelector('h1').textContent === 'Innmeldte feil' && !!app().querySelector('a[href="#fartoyregister"]'), 'Tilbake til plattformadministrator');
await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
await pg.query(`delete from acting_roles`); await pg.query(`delete from memberships where user_id=$1`, [U.ola]);
await w.eval('refreshAll()');

// Forvaltning: plattformadmin registrerer et managementselskap
U.mona = '88888888-8888-8888-8888-888888888888';
await pg.query(`insert into auth.users values ($1, 'mona@eksempel.no')`, [U.mona]);
const realFetch = w.fetch; w.fetch = async url => String(url).includes('brreg') ? { ok: true, json: async () => ({ navn: 'FORVALTER TEST AS' }) } : { ok: false };
await go('mine-fartoy');
ok(!!d.getElementById('mgr-form') && app().textContent.includes('Ingen forvaltning er registrert'), 'Forvaltning: panelet vises for plattformadministrator');
d.getElementById('mgr-org').value = '000 000 123';
d.getElementById('mgr-cos').value = '000444555\n000 555 666\n999999999';
d.getElementById('mgr-note').value = 'Testavtale';
d.getElementById('mgr-form').dispatchEvent(new w.Event('submit', { cancelable:true, bubbles:true })); await sleep(900);
ok((await pg.query(`select count(*)::int n from company_managers where manager_id='org-000000123'`)).rows[0].n === 2 && (await pg.query(`select name from companies where id='org-000000123'`)).rows[0]?.name === 'Forvalter Test AS', 'Forvaltning: lagret, forvalter opprettet med navn fra Enhetsregisteret');
ok(app().textContent.includes('Forvalter Test AS') && app().textContent.includes('Havbris AS') && app().textContent.includes('Kvitholmen Kystfiske AS'), 'Forvaltning: listen viser koblingene');
ok(d.getElementById('mgr-err')?.textContent.includes('999 999 999'), 'Forvaltning: ukjent org.nr. rapporteres');
w.fetch = realFetch;
await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
await pg.exec(`select grant_membership('mona@eksempel.no','org-000000123','admin','Mona Manager')`);
current = null; fire('SIGNED_OUT'); await sleep(300);
await login('mona'); await go('mine-fartoy');
ok(app().querySelector('h1').textContent === 'Mine fartøy' && app().textContent.includes('forvalter fartøyene til 2 rederier'), 'Forvalter: Mine fartøy med forvaltede rederier');
const mRows = [...app().querySelectorAll('.vrow')].map(r => r.dataset.vessel);
ok(mRows.includes('havbris') && mRows.includes('kvitholmen') && !mRows.includes('froyanes') && app().querySelector('.vrow[data-vessel="havbris"] .meta').textContent.includes('Havbris AS'), 'Forvalter: fartøyene vises med eierselskap');
app().querySelector('.vrow[data-vessel="havbris"] [data-verify]').click(); await sleep(100);
app().querySelector('[data-vok]').click(); await sleep(700);
ok((await pg.query(`select by_name from changes where vessel_id='havbris' and field='confirm' order by at desc limit 1`)).rows[0]?.by_name === 'Mona Manager', 'Forvalter: kan bekrefte kontaktinformasjon');
await go('rediger-kvitholmen');
ok(!app().textContent.includes('Du har ikke tilgang'), 'Forvalter: kan åpne fartøyet for redigering');
current = null; fire('SIGNED_OUT'); await sleep(300);
await login('ola'); await go('mine-fartoy');
const rm = app().querySelector('[data-mgr-remove="org-000000123|havbris"]'); rm.click(); await sleep(50);
ok(rm.textContent === 'Bekreft fjerning', 'Forvaltning: fjerning må bekreftes');
rm.click(); await sleep(700);
ok((await pg.query(`select count(*)::int n from company_managers`)).rows[0].n === 1 && (await pg.query(`select count(*)::int n from company_manager_log where action='removed'`)).rows[0].n === 1, 'Forvaltning: fjernet og logget');
await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
await pg.query(`delete from company_managers`); await pg.query(`delete from memberships where user_id=$1`, [U.mona]);
await w.eval('refreshAll()');

// Nytt fartøy uten kontaktinformasjon, søk og kilde
current = null; fire('SIGNED_OUT'); await sleep(300);
await go('sok');
const inp2 = d.getElementById('q'); inp2.value = 'havørn'; inp2.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Havørn'), 'Importert fartøy finnes i søket');
inp2.value = 'LMNO'; inp2.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Kallesignal'), 'Søk på kallesignal');
inp2.value = 'havørm'; inp2.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Havørn'), 'Søk med skrivefeil');
await go('fartoy-fd-0020010149');
ok(app().textContent.includes('Kontaktinformasjon er ikke registrert ennå.'), 'Fartøy uten kontaktinfo: «Kontaktinformasjon er ikke registrert ennå.»');
ok(app().textContent.includes('Kilde for fartøyopplysninger: Fiskeridirektoratet') && !d.getElementById('source-note').hidden, 'Kilde oppgitt på profilen og nederst på siden');
ok(app().textContent.includes('Ålesund') && app().textContent.includes('M-777-HØ'), 'Registeropplysninger vises');
await pg.query(`update vessels set email='lille.skjaer@eksempel.no' where id='fd-0020010150'`);
await go('fartoy-fd-0020010150'); await sleep(300);
ok(app().textContent.includes('lille.skjaer@eksempel.no') && !app().textContent.includes('Kontaktinformasjon er ikke registrert ennå.'), 'Fartøy med bare e-post viser e-posten');
await go('fartoy-fd-0020010149');

// Krev fartøyet: innlogging → søknad med fartøyet fylt inn. Gir ikke tilgang alene.
app().querySelector('a[href="#be-om-tilgang-fd-0020010149"]').click(); await sleep(300);
ok(app().querySelector('h1').textContent === 'Be om tilgang til Havørn', 'Be om tilgang: innlogging først');
await login('per'); await sleep(200);
ok(app().querySelector('h1').textContent === 'Be om tilgang til rederiet' && d.getElementById('req-org').value === '912345678' && app().textContent.includes('Søknaden gjelder fartøyet Havørn'), 'Søknadsskjema med fartøy og org.nr. fylt inn');
d.getElementById('req-name').value = 'Per Rederi';
d.querySelector('input[name="basis"][value="signatur"]').checked = true;
d.getElementById('req-form').dispatchEvent(new w.Event('submit', { cancelable:true, bubbles:true })); await sleep(400);
ok((await pg.query(`select count(*)::int n from access_requests where vessel_id='fd-0020010149' and orgnr='912345678'`)).rows[0].n === 1, 'Søknad lagret med fartøyet');
ok((await pg.query(`select count(*)::int n from memberships where user_id=$1`, [U.per])).rows[0].n === 0, 'Ingen tilgang gitt automatisk');
const before = invoked.length;
ok(!(await w.eval(`callRegistryFunction({ action: 'sync' }).then(() => true, e => e.code === 'forbidden' ? false : 'annen')`)) && invoked.length === before + 1, 'Vanlig bruker avvises av serveren');

// Uten nett: katalog fra lokal kopi
const saved = JSON.parse(w.localStorage.getItem('fartoykontakt-kort-v2') || 'null');
ok(saved && saved.cards.vessels.length > 0 && saved.cards.vessels.length <= 300, `Sist viste fartøy lagret lokalt for dårlig dekning (${saved && saved.cards.vessels.length})`);
// Uten nett: søk i den lokale kopien
const realRpc = w.eval('sb').rpc; w.eval('sb').rpc = async () => { throw new Error('Failed to fetch'); };
await go('sok'); const inp3 = d.getElementById('q'); inp3.value = 'Havørn'; inp3.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Havørn'), 'Uten nett: søket bruker fartøyene som er lagret på enheten');
w.eval('sb').rpc = realRpc;
ok(errors.length === 0, 'Ingen skriptfeil ' + errors.join(' | '));
console.log(`${rpcCount} databasekall totalt`);
console.log(fails ? `${fails} feilet` : 'Alle integrasjonstester bestått');
w.close();
process.exit(fails ? 1 : 0);
