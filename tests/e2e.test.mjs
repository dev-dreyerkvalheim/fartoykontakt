// Ende-til-ende: nettsiden i Supabase-modus mot Postgres med våre migrasjoner. Kjør: npm test
// Ende-til-ende: nettsiden i Supabase-modus mot en ekte Postgres (PGlite) med våre migrasjoner
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const R = ROOT + 'supabase/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const pg = new PGlite();
await pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon; create role authenticated;`);
for (const f of ['migrations/20261027000001_schema.sql', 'migrations/20261027000002_functions.sql', 'seed.sql']) await pg.exec(fs.readFileSync(R + f, 'utf8'));
const U = { kari:'11111111-1111-1111-1111-111111111111', jonas:'22222222-2222-2222-2222-222222222222', ola:'44444444-4444-4444-4444-444444444444', ny:'66666666-6666-6666-6666-666666666666' };
for (const [n, id] of Object.entries(U)) await pg.query(`insert into auth.users values ($1,$2)`, [id, n + '@eksempel.no']);
await pg.exec(`select grant_membership('kari@eksempel.no','froyanes','admin','Kari Nordvik'); select grant_membership('jonas@eksempel.no','froyanes','member','Jonas Vik'); select make_platform_admin('ola@eksempel.no','Ola Drift');`);

let current = null; const listeners = []; let otpTo = null; let rpcCount = 0;
const fire = ev => listeners.forEach(cb => cb(ev, current ? { user: { id: U[current] } } : null));
const mockClient = () => ({
  rpc: async (fn, args = {}) => {
    rpcCount++;
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [current ? U[current] : '', current ? JSON.stringify({ email: current + '@eksempel.no' }) : '']);
    const keys = Object.keys(args);
    const params = keys.map(k => args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]);
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
    w.matchMedia = () => ({ matches:false }); w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {}; w.onerror = m => errors.push(m); w.fetch = async () => ({ ok:false }); }
});
const w = dom.window, d = w.document, E = s => w.eval(s), app = () => d.getElementById('app');
const go = async h => { w.location.hash = 'x'; await sleep(10); w.location.hash = h; await sleep(150); };
const login = async who => { current = who; fire('SIGNED_IN'); await sleep(400); };
await sleep(500);

ok(E('REMOTE') === true && E('db.vessels.length') === 13, 'Starter i Supabase-modus og henter 13 fartøy');
ok(!d.getElementById('simulate-report') && !d.getElementById('reset-demo'), 'Demo-knapper skjult');
ok(!JSON.stringify(E('db.verifications')).includes('"by"'), 'Offentlige bekreftelser uten hvem');
const input = d.getElementById('q');
input.value = 'Frøy'; input.dispatchEvent(new w.Event('input')); await sleep(300);
ok(app().querySelectorAll('.result').length >= 3, 'Søk på navn');
input.value = '000 97 101'; input.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Du søkte på et tidligere telefonnummer') && app().textContent.includes('Bergholm'), 'Skjult gammelt nummer finnes via databasen');
input.value = '000 98 401'; input.dispatchEvent(new w.Event('input')); await sleep(400);
ok(app().textContent.includes('Ring nytt nummer'), 'Bekreftet gammelt nummer: «Ring nytt nummer»');

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

// Uten nett: katalog fra lokal kopi
ok(!!w.localStorage.getItem('fartoykontakt-katalog-v1'), 'Katalogen er lagret lokalt for dårlig dekning');
ok(errors.length === 0, 'Ingen skriptfeil ' + errors.join(' | '));
console.log(`${rpcCount} databasekall totalt`);
console.log(fails ? `${fails} feilet` : 'Alle integrasjonstester bestått');
w.close();
process.exit(fails ? 1 : 0);
