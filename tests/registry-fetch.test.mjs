// Tester henting og vasking fra Fiskeridirektoratet (Edge Function-logikken) med et etterlignet API,
// og hele kjeden API → Edge-logikk → databasefunksjoner i en lokal Postgres. Kjør: npm test
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { normRegMark, titleCase, formatLength, toStagingRow, fetchWithRetry, fetchAllVessels, prepareRows, runSync, VESSEL_API } from '../supabase/functions/registry-sync/registry.js';

let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleeps = []; const sleep = async ms => { sleeps.push(ms); };

// ---- Vasking
ok(normRegMark('N 0056B') === 'N-56-B' && normRegMark('TR0002NR') === 'TR-2-NR' && normRegMark('VL9999AØ') === 'VL-9999-AØ' && normRegMark('N-56-B') === 'N-56-B', 'Registreringsmerke normaliseres («N 0056B» → «N-56-B»)');
ok(normRegMark('XYZ') === null && normRegMark('') === null, 'Ugyldig merke avvises');
ok(formatLength(14.99) === '14,99 m' && formatLength(10) === '10 m' && formatLength(8.5) === '8,5 m' && formatLength(null) === '', 'Lengde formateres som i CSV-importen');
ok(titleCase('VARDØYFISK II') === 'Vardøyfisk II' && titleCase('HAVGUTT KYSTFISKE AS') === 'Havgutt Kystfiske AS', 'Navn får store forbokstaver');
const sample = { id: '2001014950', name: 'A JENSEN', registrationMark: 'N 0056B', radioCallSign: 'LK7381', municipalityCode: '1804', tonnageType: 'OC', width: 5.8, length: 14.99, enginePower: 403, engineBuildYear: 1992, buildYear: 2001, measureDate: '2001-06-26', registrationDate: '2012-04-17',
  owners: [{ id: '998076803', entityType: 'COMPANY', name: 'A. JENSEN AS', postalCode: '8003', city: 'BODØ' }, { id: '12345678901', entityType: 'PERSON', name: 'OLA NORDMANN', postalCode: '8000', city: 'BODØ' }] };
const { row } = toStagingRow(sample, { '1804': 'Bodø' });
ok(row.id === '2001014950' && row.regNr === 'N-56-B' && row.name === 'A Jensen' && row.municipality === 'Bodø' && row.length === '14,99 m' && row.width === '5.8', 'Fartøy vaskes til samme format som eksisterende data');
ok(JSON.stringify(row.owners[1]) === '{"type":"PERSON"}' && !JSON.stringify(row).includes('NORDMANN') && !JSON.stringify(row).includes('12345678901'), 'Personeiers navn og ID fjernes før lagring');
ok(row.owners[0].orgnr === '998076803' && row.owners[0].name === 'A. Jensen AS', 'Selskapseier beholdes med org.nr.');
ok(toStagingRow({ ...sample, id: '123' }).error.reason.includes('FARTOY_ID'), 'Ugyldig ID gir valideringsfeil');
ok(toStagingRow({ ...sample, id: '0012345678' }).row.id === '0012345678', 'Ledende nuller i ID beholdes');
ok(toStagingRow({ ...sample, id: 1234567890 }).row.id === '1234567890', 'Numerisk ID gjøres om til tekst');
const prep = prepareRows([sample, sample, { ...sample, id: 'x' }], null);
ok(prep.rows.length === 1 && prep.errors.length === 1 && prep.rows[0].municipality === '', 'Duplikater fjernes; uten kommuneliste blir kommunenavn tomt (beholdes i databasen)');

// ---- Etterlignet API
const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body });
function fakeApi(all, { failPages = {}, total = all.length } = {}) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push(url);
    if (url.startsWith('https://ws.geonorge.no')) return resp(200, Array.from({ length: 357 }, (_, i) => ({ kommunenummer: String(1000 + i), kommunenavnNorsk: 'Kommune ' + i })).concat([{ kommunenummer: '1804', kommunenavnNorsk: 'Bodø' }]));
    if (url.startsWith('https://data.brreg.no')) return resp(200, { _embedded: { enheter: [] } });
    const u = new URL(url); const p = Number(u.searchParams.get('page')); const pp = Number(u.searchParams.get('per_page'));
    const plan = failPages[p];
    if (plan && plan.length) { const s = plan.shift(); if (s === 'throw') throw new Error('socket hang up'); if (s === 'abort') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } return resp(s, { error: 'x' }); }
    return resp(200, all.slice((p - 1) * pp, p * pp), { 'x-totalcount': String(total) });
  };
  f.calls = calls; return f;
}
const many = Array.from({ length: 450 }, (_, i) => ({ ...sample, id: String(3000000000 + i), name: 'BÅT ' + i, registrationMark: `N ${String(i + 1).padStart(4, '0')}A`, radioCallSign: 'LA' + i }));

let api = fakeApi(many);
let res = await fetchAllVessels({ fetchImpl: api, sleep });
ok(res.total === 450 && res.vessels.length === 450 && api.calls.length === 3 && api.calls.every(u => u.startsWith(VESSEL_API) && u.includes('per_page=200') && u.includes('sort_by=ID')), 'Hele registeret hentes side for side (3 sider à 200)');
ok(sleeps.filter(s => s === 300).length === 2, 'Pause mellom sidene for å skåne API-et');

sleeps.length = 0;
api = fakeApi(many, { failPages: { 2: [503, 429, 'throw'] } });
res = await fetchAllVessels({ fetchImpl: api, sleep });
ok(res.vessels.length === 450 && JSON.stringify(sleeps.filter(s => s !== 300)) === '[1000,2000,4000]', 'Midlertidige feil (503, 429, nettverk) gir nye forsøk med økende ventetid');

api = fakeApi(many, { failPages: { 2: [500, 500, 500, 500] } });
let err = null; try { await fetchAllVessels({ fetchImpl: api, sleep }); } catch (e) { err = e.message; }
ok(err && err.includes('HTTP 500'), 'Gir opp etter 4 forsøk: ' + err);
api = fakeApi(many, { failPages: { 1: ['abort', 'abort', 'abort', 'abort'] } });
err = null; try { await fetchAllVessels({ fetchImpl: api, sleep }); } catch (e) { err = e.message; }
ok(err && err.includes('tidsavbrudd'), 'Tidsavbrudd håndteres: ' + err);
api = fakeApi(many, { failPages: { 1: [404] } });
err = null; try { await fetchAllVessels({ fetchImpl: api, sleep }); } catch (e) { err = e.message; }
ok(err && err.includes('HTTP 404') && api.calls.length === 1, 'Permanente feil (404) prøves ikke på nytt');
err = null; try { await fetchAllVessels({ fetchImpl: async () => resp(200, [], {}), sleep }); } catch (e) { err = e.message; }
ok(err && err.includes('x-totalcount'), 'Manglende totalantall stopper hentingen');
err = null; try { await fetchAllVessels({ fetchImpl: async () => resp(200, { not: 'a list' }, { 'x-totalcount': '5' }), sleep }); } catch (e) { err = e.message; }
ok(err && err.includes('Uventet format'), 'Endret svarformat oppdages');

// ---- Hele kjeden mot lokal database
const R = fileURLToPath(new URL('../supabase/', import.meta.url));
const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon; create role authenticated; create role service_role bypassrls;`);
for (const f of ['20261027000001_schema.sql', '20261027000002_functions.sql', '20261027000003_hardening.sql', '20261027000004_register_import.sql', '20261028000005_fiskeridir_sync.sql'])
  await db.exec(fs.readFileSync(R + 'migrations/' + f, 'utf8'));
await db.exec(`grant usage on schema public, extensions to service_role; grant all on all tables in schema public to service_role; grant usage on all sequences in schema public to service_role;
  insert into auth.users values ('44444444-4444-4444-4444-444444444444', 'ola@eksempel.no'); select make_platform_admin('ola@eksempel.no', 'Ola');`);
await db.exec('set role service_role');
const rpc = async (name, args) => {
  const keys = Object.keys(args);
  const r = await db.query(`select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]));
  return r.rows[0].r;
};
const start = async mode => (await rpc('registry_start_run', { p_register: 'fiskeridir', p_mode: mode, p_trigger: 'schedule', p_started_by: null }));

let run = await start('apply');
res = await runSync({ rpc, runId: run.id, mode: run.mode, fetchImpl: fakeApi(many), sleep });
ok(run.mode === 'preview' && res.ok && res.counts.new === 450, 'Første kjøring mot API-et blir forhåndsvisning med 450 nye');
await rpc('registry_apply', { p_run: run.id, p_actor: '44444444-4444-4444-4444-444444444444' });
ok((await db.query(`select count(*)::int n from vessel_identifiers`)).rows[0].n === 450, 'Godkjent: 450 fartøy importert');
ok((await db.query(`select municipality from vessels where id = 'fd-3000000000'`)).rows[0].municipality === 'Bodø', 'Kommunenavn fra Kartverket');

run = await start('apply');
res = await runSync({ rpc, runId: run.id, mode: run.mode, fetchImpl: fakeApi(many), sleep });
ok(run.mode === 'apply' && res.ok && res.counts.unchanged === 450 && res.counts.updated === 0, 'Neste natt: 450 uendret, ingen skriving');

// Feil midt i hentingen: kjøringen feiler, ingenting endres
const changed = many.map(v => ({ ...v, name: v.name + ' X' }));
run = await start('apply');
res = await runSync({ rpc, runId: run.id, mode: run.mode, fetchImpl: fakeApi(changed, { failPages: { 3: [500, 500, 500, 500] } }), sleep });
const st = (await db.query(`select status, error from registry_runs where id = $1`, [run.id])).rows[0];
ok(!res.ok && st.status === 'failed' && st.error.includes('HTTP 500'), 'Feil midt i hentingen: kjøringen merkes som feilet');
ok((await db.query(`select count(*)::int n from vessels where name like '% X'`)).rows[0].n === 0, 'Delvis hentet data brukes ikke');

// Kilden svarer med langt færre fartøy enn før
run = await start('apply');
res = await runSync({ rpc, runId: run.id, mode: run.mode, fetchImpl: fakeApi(many.slice(0, 100)), sleep });
ok(!res.ok && res.error === 'incomplete' && (await db.query(`select count(*)::int n from vessels where registry_status = 'missing'`)).rows[0].n === 0, 'Ufullstendig kilde (100 av 450): stoppes, ingen merkes som manglende');

// Ugyldige poster går til gjennomgang uten å stoppe resten
run = await start('apply');
res = await runSync({ rpc, runId: run.id, mode: run.mode, fetchImpl: fakeApi([...many, { id: 'feil', name: '' }], { total: 451 }), sleep });
ok(res.ok && res.errors === 1 && (await db.query(`select count(*)::int n from registry_reviews where kind = 'validation' and status = 'open'`)).rows[0].n === 1, 'Ugyldig post blir sak til gjennomgang, resten synkroniseres');

console.log(fails ? `${fails} feilet` : 'Alle hentetester bestått');
process.exit(fails ? 1 : 0);
