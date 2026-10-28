// Tester synkroniseringen med Fiskeridirektoratet i en lokal Postgres (PGlite). Kjør: npm test
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'fs';
import { fileURLToPath } from 'url';

const R = fileURLToPath(new URL('../supabase/', import.meta.url));
const db = new PGlite({ extensions: { pg_trgm } });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

await db.exec(`
create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon; create role authenticated; create role service_role bypassrls;
`);
for (const f of ['20261027000001_schema.sql', '20261027000002_functions.sql', '20261027000003_hardening.sql', '20261027000004_register_import.sql', '20261028000005_fiskeridir_sync.sql', '20261028000007_registry_perf.sql'])
  await db.exec(fs.readFileSync(R + 'migrations/' + f, 'utf8'));
await db.exec(`grant usage on schema public, extensions to anon, authenticated, service_role;
  grant select on all tables in schema public to anon, authenticated;
  grant all on all tables in schema public to service_role; grant usage on all sequences in schema public to service_role;`);

const U = { ola: '44444444-4444-4444-4444-444444444444', kari: '11111111-1111-1111-1111-111111111111' };
for (const [n, id] of Object.entries(U)) await db.query(`insert into auth.users values ($1, $2)`, [id, n + '@eksempel.no']);
await db.exec(`select make_platform_admin('ola@eksempel.no', 'Ola Drift')`);

let role = null;
const as = async (who, r = 'authenticated') => {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [who ? U[who] : '', who ? JSON.stringify({ email: who + '@eksempel.no' }) : '']);
  role = r; if (r) await db.exec(`set role ${r}`);
};
const svc = () => as(null, 'service_role');
const sys = () => as(null, null);
const call = async (sql, p = []) => { try { return { rows: (await db.query(sql, p)).rows }; } catch (e) { return { err: e.message }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const val = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] || {})[0];

// ---- Utgangspunkt: fartøy importert fra CSV i går (uten FARTOY_ID), som i produksjon
await sys();
await db.exec(`insert into companies(id, name, orgnr, source) values
  ('org-998076803', 'A. Jensen AS', '998076803', 'fiskeridir'), ('org-911111111', 'Gamle Rederi AS', '911111111', 'fiskeridir'),
  ('org-922222222', 'Kontaktrederiet AS', '922222222', 'fiskeridir'), ('org-933333333', 'Fjerde AS', '933333333', 'fiskeridir')`);
await db.exec(`insert into vessels(id, company_id, name, reg_nr, callsign, length, width, engine_power, build_year, register_date, municipality, source) values
  ('n-56-b', 'org-998076803', 'A Jensen', 'N-56-B', 'LK7381', '14,99 m', '5.8', 403, 2001, '2012-04-17', 'Bodø', 'fiskeridir'),
  ('m-1-a',  'org-911111111', 'Gammel', 'M-1-A', null, '9 m', null, null, null, null, 'Ålesund', 'fiskeridir'),
  ('f-2-v',  'org-911111111', 'Kari', 'F-2-V', 'LF1', '8 m', null, null, null, null, 'Vardø', 'fiskeridir'),
  ('r-3-k',  'org-911111111', 'Forsvunnet', 'R-3-K', 'LR3', '12 m', null, null, null, null, 'Karmøy', 'fiskeridir'),
  ('h-5-av', 'org-922222222', 'Kontaktbåt', 'H-5-AV', 'LH5', '20 m', null, null, null, null, 'Austevoll', 'fiskeridir')`);
// Kontaktbåt har kontaktinfo, bekreftelse, gammelt nummer og en innmeldt feil (Fartøykontakt-data)
await db.exec(`update vessels set bridge_phone = '+4700055501', alt_phone = '+4700055502', email = 'bro@kontakt.eksempel.no', updated_at = '2026-10-01T12:00:00Z' where id = 'h-5-av';
  insert into verifications(scope, scope_id, field, value, at, source) values ('vessel', 'h-5-av', 'bridgePhone', '+4700055501', '2026-10-01T12:00:00Z', 'test');
  insert into number_history(id, vessel_id, number, replaced_at, replaced_by, status, verified_at, source, show_on_profile) values ('hx', 'h-5-av', '+4700055500', '2026-09-01', '+4700055501', 'confirmed', '2026-09-01', 'Rederiet', true);
  insert into reports(id, vessel_id, field, reason, current_value, suggested) values ('rx', 'h-5-av', 'bridgePhone', 'Feil nummer', '+4700055501', '+4700055599');`);
const contactSnapshot = async () => JSON.stringify(await one(`select
  (select row_to_json(x) from (select bridge_phone, alt_phone, email, updated_at from vessels where id = 'h-5-av') x) v,
  (select json_agg(row_to_json(x) order by id) from (select id, value, at from verifications) x) ver,
  (select json_agg(row_to_json(x) order by id) from (select * from number_history) x) hist,
  (select json_agg(row_to_json(x) order by id) from (select id, status, suggested from reports) x) rep,
  (select count(*) from memberships) mem`));
const contactBefore = await contactSnapshot();

// ---- Kildedata (slik Edge Function sender dem: vasket, uten personnavn)
const base = [
  { id: '2001014950', name: 'A Jensen', regNr: 'N-56-B', callsign: 'LK7381', municipalityCode: '1804', municipality: 'Bodø', length: '14,99 m', width: '5.8', enginePower: 403, buildYear: 2001, registerDate: '2012-04-17', tonnageType: 'OC',
    owners: [{ type: 'COMPANY', orgnr: '998076803', name: 'A. Jensen AS', postalCode: '8003', city: 'Bodø' }] },
  { id: '2002000001', name: 'Gammel', regNr: 'M-1-A', callsign: 'LX1', municipalityCode: '1508', municipality: 'Ålesund', length: '9 m',
    owners: [{ type: 'COMPANY', orgnr: '911111111', name: 'Gamle Rederi AS' }] },
  { id: '2003000002', name: 'Helt Annet', regNr: 'F-2-V', callsign: 'LF9', municipalityCode: '5634', municipality: 'Vardø', length: '8 m',
    owners: [{ type: 'COMPANY', orgnr: '911111111', name: 'Gamle Rederi AS' }] },
  { id: '2005000005', name: 'Kontaktbåt', regNr: 'H-5-AV', callsign: 'LH5', municipalityCode: '4627', municipality: 'Austevoll', length: '20 m',
    owners: [{ type: 'COMPANY', orgnr: '922222222', name: 'Kontaktrederiet AS' }] },
  { id: '0012345678', name: 'Nybåt', regNr: 'T-9-T', callsign: 'LT9', municipalityCode: '5501', municipality: 'Tromsø', length: '11 m',
    owners: [{ type: 'COMPANY', orgnr: '944444444', name: 'Nybåt Fiske AS', city: 'Tromsø' }, { type: 'PERSON' }] },
  { id: '2006000006', name: 'Flereier', regNr: 'N-7-VV', callsign: 'LN7', municipalityCode: '1860', municipality: 'Vestvågøy', length: '10 m',
    owners: [{ type: 'COMPANY', orgnr: '998076803', name: 'A. Jensen AS' }, { type: 'PERSON' }, { type: 'COMPANY', orgnr: '955555555', name: 'Medeier AS' }] }
];
const clone = x => JSON.parse(JSON.stringify(x));
async function runSync(rows, { mode = 'apply', trigger = 'schedule', total = rows.length, approve = null } = {}) {
  await svc();
  const st = await call(`select registry_start_run('fiskeridir', $1, $2, null) r`, [mode, trigger]);
  if (st.err) return { err: st.err };
  const { id, mode: eff } = st.rows[0].r;
  await call(`select registry_set_source($1, $2, 'test')`, [id, total]);
  const stg = await call(`select registry_stage($1, $2::jsonb) r`, [id, JSON.stringify(rows)]);
  if (stg.err) return { err: stg.err, id };
  const an = await call(`select registry_analyze($1) r`, [id]);
  if (an.err) { await call(`select registry_fail_run($1, $2)`, [id, an.err]); return { err: an.err, id, mode: eff }; }
  let counts = an.rows[0].r;
  if (eff === 'apply') { const ap = await call(`select registry_apply($1, null) r`, [id]); if (ap.err) return { err: ap.err, id }; counts = ap.rows[0].r; }
  return { id, mode: eff, counts, staged: stg.rows[0].r };
}

// ---- 1. Tilgang
await as('kari');
ok(/permission denied/.test((await call(`select registry_start_run('fiskeridir','apply','manual',null)`)).err || ''), 'Vanlig innlogget kan ikke starte synkronisering');
ok(/permission denied/.test((await call(`select registry_apply(1, null)`)).err || ''), 'Vanlig innlogget kan ikke bruke endringer');
ok((await call(`select registry_overview()`)).err === 'forbidden', 'Vanlig innlogget ser ikke registeroversikten');
await as(null, 'anon');
ok(/permission denied/.test((await call(`select registry_stage(1, '[]'::jsonb)`)).err || ''), 'Anonym kan ikke sende data til staging');
ok(/permission denied/.test((await call(`select * from registry_staging`)).err || '') || (await call(`select count(*)::int n from registry_staging`)).rows?.[0].n === 0, 'Anonym kan ikke lese staging');

// ---- 2. Første import: tvunget forhåndsvisning
let r1 = await runSync(clone(base));
ok(r1.mode === 'preview', 'Første import blir forhåndsvisning selv om planlagt kjøring ber om å bruke endringer');
ok(r1.counts.link === 3 && r1.counts.new === 2 && r1.counts.ambiguous === 1 && r1.counts.missing === 1,
   'Forhåndsvisning: 3 koblet, 2 nye, 1 uklar, 1 mangler ' + JSON.stringify(r1.counts));
await sys();
ok(await val(`select count(*)::int from vessel_identifiers`) === 0 && await val(`select count(*)::int from vessels`) === 5, 'Forhåndsvisning endrer ingenting');
await as('ola');
const prev = (await call(`select registry_preview($1) p`, [r1.id])).rows[0].p;
ok(prev.new.length === 2 && prev.ambiguous[0].note.includes('verken navn eller kallesignal') && prev.missing[0].name === 'Forsvunnet', 'Plattformadmin ser detaljer i forhåndsvisningen');
await svc();
ok((await call(`select registry_apply($1, null)`, [r1.id])).err === 'forbidden', 'Forhåndsvisning kan ikke godkjennes uten plattformadministrator');
ok((await call(`select registry_apply($1, $2)`, [r1.id, U.kari])).err === 'forbidden', 'Forhåndsvisning kan ikke godkjennes av vanlig bruker');
const ap1 = await call(`select registry_apply($1, $2) r`, [r1.id, U.ola]);
ok(!ap1.err && (await one(`select status, approved_by from registry_runs where id = $1`, [r1.id])).approved_by === U.ola, 'Plattformadmin godkjenner første import');

await sys();
ok(await val(`select external_id from vessel_identifiers where vessel_id = 'fd-0012345678'`) === '0012345678', 'Ledende nuller i FARTOY_ID beholdes (0012345678)');
ok(await val(`select count(*)::int from vessel_identifiers where vessel_id in ('n-56-b','m-1-a','h-5-av')`) === 3, 'Eksisterende fartøy koblet på merke + kallesignal/navn');
ok(await val(`select count(*)::int from vessel_identifiers where vessel_id = 'f-2-v'`) === 0, 'Uklart treff (bare merket stemmer) kobles ikke');
ok(await val(`select registry_status from vessels where id = 'f-2-v'`) === 'active', 'Kandidat i uklart treff merkes ikke som manglende');
ok(await val(`select registry_status from vessels where id = 'r-3-k'`) === 'missing' && await val(`select count(*)::int from vessels where id = 'r-3-k'`) === 1, 'Fartøy som mangler i registeret merkes, men slettes ikke');
ok(await val(`select count(*)::int from registry_reviews where status = 'open' and kind = 'missing'`) === 1 && await val(`select count(*)::int from registry_reviews where status = 'open' and kind = 'ambiguous_match'`) === 1, 'Saker til gjennomgang for manglende og uklart treff');
ok(await val(`select company_id from vessels where id = 'fd-0012345678'`) === 'org-944444444' && await val(`select name from companies where orgnr = '944444444'`) === 'Nybåt Fiske AS', 'Nytt fartøy knyttet til nytt rederi fra eierlisten');
ok(await val(`select string_agg(owner_type || coalesce(':' || orgnr, ''), ',' order by position) from vessel_owners where vessel_id = 'fd-2006000006'`) === 'COMPANY:998076803,PERSON,COMPANY:955555555', 'Flere eiere lagres i rekkefølge, personer uten navn/ID');
ok(await val(`select municipality_code from vessels where id = 'n-56-b'`) === '1804', 'Nye registerfelt fylt inn ved kobling');
ok(await contactSnapshot() === contactBefore, 'Kontaktinfo, gamle numre, bekreftelser, meldinger og tilganger er uendret');
ok(await val(`select bridge_phone from vessels where id = 'fd-0012345678'`) === null, 'Nye fartøy får ingen oppdiktet kontaktinfo');

// ---- 3. Idempotens: samme kilde igjen
const nChanges = await val(`select count(*)::int from registry_changes`);
const nReviews = await val(`select count(*)::int from registry_reviews`);
const stampsBefore = JSON.stringify((await db.query(`select id, updated_at, registry_changed_at, company_id from vessels order by id`)).rows);
const r2 = await runSync(clone(base));
ok(r2.mode === 'apply' && r2.counts.updated === 0 && r2.counts.new === 0 && r2.counts.unchanged === 5, 'Ny kjøring med samme data: ingen endringer ' + JSON.stringify(r2.counts));
await sys();
ok(await val(`select count(*)::int from registry_changes`) === nChanges, 'Ingen nye revisjonsrader når ingenting er endret');
ok(await val(`select count(*)::int from registry_reviews`) === nReviews, 'Ingen dupliserte saker');
ok(JSON.stringify((await db.query(`select id, updated_at, registry_changed_at, company_id from vessels order by id`)).rows) === stampsBefore, 'Ingen tidsstempler endret');
ok(await val(`select count(*)::int from vessels`) === 7, 'Ingen dupliserte fartøy');

// ---- 4. Endrede registerfelt
let rows = clone(base); rows[0].name = 'A Jensen II'; rows[0].length = '15,2 m';
const r3 = await runSync(rows);
await sys();
ok(r3.counts.updated === 1 && await val(`select name from vessels where id = 'n-56-b'`) === 'A Jensen II', 'Endret navn oppdateres');
const diff = await val(`select details from registry_changes where vessel_id = 'n-56-b' and change = 'updated' order by id desc limit 1`);
ok(Object.keys(diff).sort().join(',') === 'length,name' && diff.name.fra === 'A Jensen', 'Revisjonen viser bare endrede felt med fra/til');
ok(await contactSnapshot() === contactBefore, 'Kontaktinfo fortsatt uendret etter feltendring');

// ---- 5. Eierskifte
rows = clone(base); rows[0].name = 'A Jensen II'; rows[0].length = '15,2 m';
rows[3].owners = [{ type: 'COMPANY', orgnr: '933333333', name: 'Fjerde AS' }];            // Kontaktbåt (i bruk) → ny eier
rows[1].owners = [{ type: 'COMPANY', orgnr: '933333333', name: 'Fjerde AS' }];            // Gammel (ikke i bruk) → ny eier
const r4 = await runSync(rows);
await sys();
ok(r4.counts.owner_review === 1 && r4.counts.owner_auto === 1, 'Eierskifte: ett til gjennomgang, ett automatisk ' + JSON.stringify(r4.counts));
ok(await val(`select company_id from vessels where id = 'h-5-av'`) === 'org-922222222', 'Fartøy i bruk flyttes ikke automatisk til ny eier (ingen tilgangsoverføring)');
ok(await val(`select company_id from vessels where id = 'm-1-a'`) === 'org-933333333', 'Fartøy som ikke er i bruk følger registrert eier');
ok(await val(`select count(*)::int from registry_reviews where status = 'open' and kind = 'owner_change' and vessel_id = 'h-5-av'`) === 1, 'Sak om eierskifte opprettet');
ok(await contactSnapshot() === contactBefore, 'Eierskifte endrer ikke kontaktinfo eller tilganger');
// Gjentatt kjøring lager ikke ny sak
await runSync(rows); await sys();
ok(await val(`select count(*)::int from registry_reviews where kind = 'owner_change' and vessel_id = 'h-5-av'`) === 1, 'Samme eierskifte gir ikke ny sak ved neste kjøring');

// ---- 6. Gjennomgang
await as('kari');
const revId = await (async () => { await sys(); return val(`select id from registry_reviews where status = 'open' and kind = 'owner_change'`); })();
await as('kari');
ok((await call(`select registry_resolve_review($1, 'switch')`, [revId])).err === 'forbidden', 'Vanlig bruker kan ikke behandle registersaker');
await as('ola');
ok(!(await call(`select registry_resolve_review($1, 'keep')`, [revId])).err, 'Plattformadmin beholder nåværende rederi');
await runSync(rows); await sys();
ok(await val(`select count(*)::int from registry_reviews where status = 'open' and kind = 'owner_change'`) === 0, '«Behold» huskes: samme eierskifte spørres ikke om igjen');
const ambId = await val(`select id from registry_reviews where status = 'open' and kind = 'ambiguous_match'`);
await as('ola');
ok((await call(`select registry_resolve_review($1, 'link', 'n-56-b')`, [ambId])).err === 'invalid', 'Uklart treff kan bare kobles til en av kandidatene');
ok(!(await call(`select registry_resolve_review($1, 'link', 'f-2-v')`, [ambId])).err, 'Plattformadmin kobler uklart treff manuelt');
await sys();
ok(await val(`select vessel_id from vessel_identifiers where external_id = '2003000002'`) === 'f-2-v', 'Manuell kobling lagret');
const r5 = await runSync(rows); await sys();
ok(await val(`select name from vessels where id = 'f-2-v'`) === 'Helt Annet', 'Neste synk oppdaterer det manuelt koblede fartøyet');

// ---- 7. Tilbake i registeret
rows.push({ id: '2004000004', name: 'Forsvunnet', regNr: 'R-3-K', callsign: 'LR3', length: '12 m', municipality: 'Karmøy', municipalityCode: '1149', owners: [{ type: 'COMPANY', orgnr: '911111111', name: 'Gamle Rederi AS' }] });
const r6 = await runSync(rows); await sys();
ok(r6.counts.reappeared === 1 && await val(`select registry_status from vessels where id = 'r-3-k'`) === 'active', 'Fartøy som dukker opp igjen blir aktivt');
ok(await val(`select count(*)::int from registry_reviews where status = 'open' and kind = 'missing'`) === 0, 'Sak om manglende fartøy lukkes automatisk');

// ---- 8. Ufullstendig kilde og feil
const r7 = await runSync(rows.slice(0, 2), { total: rows.length });
ok(r7.err === 'incomplete', 'Halvtomt svar stoppes (' + r7.err + ')');
await sys();
ok(await val(`select status from registry_runs where id = $1`, [r7.id]) === 'failed' && await val(`select count(*)::int from vessels where registry_status = 'missing'`) === 0, 'Mislykket kjøring endrer ingen fartøy');
const r8 = await runSync(rows, { total: rows.length + 5 });
await sys();
ok(r8.counts.complete === false && r8.counts.missing === null && await val(`select count(*)::int from vessels where registry_status = 'missing'`) === 0, 'Når kilden ikke er fullstendig, merkes ingen som manglende');

// ---- 9. Samtidighet og gamle kjøringer
await svc();
const a = await call(`select registry_start_run('fiskeridir','apply','manual',null) r`);
const b = await call(`select registry_start_run('fiskeridir','apply','manual',null) r`);
ok(!a.err && b.err === 'busy', 'To kjøringer samtidig hindres');
await sys(); await db.query(`update registry_runs set heartbeat_at = now() - interval '20 minutes' where id = $1`, [a.rows[0].r.id]);
await svc();
const c = await call(`select registry_start_run('fiskeridir','apply','manual',null) r`);
ok(!c.err, 'Kjøring uten livstegn regnes som avbrutt, ny kjøring tillates');
await call(`select registry_fail_run($1, 'test')`, [c.rows[0].r.id]);
const pv = await runSync(rows, { mode: 'preview', trigger: 'manual' });
await sys(); await db.query(`update registry_runs set started_at = now() - interval '13 hours' where id = $1`, [pv.id]);
await svc();
ok((await call(`select registry_apply($1, $2)`, [pv.id, U.ola])).err === 'stale', 'Gammel forhåndsvisning kan ikke godkjennes');

// ---- 10. Duplikater i kilden
const dup = await runSync([...rows, rows[0]]);
ok(dup.staged.received === rows.length + 1 && dup.staged.staged === rows.length, 'Duplikat-ID i kilden lagres bare én gang');
await svc();
ok(/check/.test((await call(`insert into vessel_identifiers(register, external_id, vessel_id) values ('fiskeridir', '12345678', 'n-56-b')`)).err || ''), 'Feil format på FARTOY_ID avvises av databasen');

// ---- 11. Søk etter import
await as(null, 'anon');
const s = async q => (await one(`select search_directory($1) r`, [q])).r;
let res = await s('nyb'); ok(res.ids[0] === 'fd-0012345678', 'Søk på navn finner importert fartøy');
res = await s('LT9');    ok(res.ids[0] === 'fd-0012345678', 'Søk på kallesignal');
res = await s('T-9-T');  ok(res.ids[0] === 'fd-0012345678', 'Søk på registreringsmerke');
res = await s('nybåt fiske'); ok(res.ids.includes('fd-0012345678'), 'Søk på rederinavn');
res = await s('helt anet'); ok(res.ids.includes('f-2-v'), 'Søk tåler skrivefeil');
res = await s('000 555 01'); ok(res.ids[0] === 'h-5-av', 'Søk på nåværende telefonnummer');
res = await s('+47 000 55 500'); ok(res.history[0]?.vesselId === 'h-5-av' && res.ids.includes('h-5-av'), 'Søk på tidligere telefonnummer');
ok(res.vessels.length <= 40 && !JSON.stringify(res).includes('verified_by'), 'Søk returnerer bare treff, uten hvem som bekreftet');
const home = (await one(`select get_home() r`)).r;
ok(home.exampleIds.length === 3 && home.settings.verifyMonths === 6, 'Forsiden henter eksempler og innstillinger');
ok(JSON.stringify(await one(`select get_vessel_public('fd-0012345678') r`)).includes('"source": "fiskeridir"') || (await one(`select get_vessel_public('fd-0012345678') r`)).r.vessels[0].source === 'fiskeridir', 'Fartøykort viser at data er fra Fiskeridirektoratet');

// ---- 12. Be om tilgang til et importert fartøy
await sys(); await db.query(`insert into auth.users values ('77777777-7777-7777-7777-777777777777', 'ny@eksempel.no')`);
await db.query(`select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false), set_config('request.jwt.claims', '{"email":"ny@eksempel.no"}', false)`);
await db.exec('set role authenticated');
ok(!(await call(`select request_access('944444444', 'fullmakt', 'Nils Ny', 'fd-0012345678')`)).err, 'Rederi kan be om tilgang til et importert fartøy');
await sys();
ok(await val(`select vessel_id from access_requests where full_name = 'Nils Ny'`) === 'fd-0012345678' && await val(`select count(*)::int from memberships`) === 0, 'Søknaden gir ingen tilgang før den er godkjent');

// ---- 13. Personopplysninger
await sys();
const dump = JSON.stringify((await db.query(`select (select json_agg(t) from registry_staging t) a, (select json_agg(t) from vessel_owners t) b, (select json_agg(t) from registry_reviews t) c, (select json_agg(t) from registry_changes t) d`)).rows);
ok(!/"type": ?"PERSON", ?"[a-z]/i.test(dump) && !dump.includes('"PERSON","name"'), 'Ingen personnavn lagret');

// ---- 14. Plattformoversikt
await as('ola');
const ov = (await one(`select registry_overview() r`)).r;
ok(ov.imported === 7 && ov.initialDone === true && ov.last && ov.runs.length > 0 && typeof ov.openReviews.owner_change === 'number', 'Plattformadmin ser oversikt over registeret ' + JSON.stringify({ imported: ov.imported, open: ov.openReviews }));

await sys();
ok(await contactSnapshot() === contactBefore, 'Til slutt: kontaktinfo, gamle numre, bekreftelser, meldinger og tilganger er fortsatt uendret');
console.log(fails ? `${fails} feilet` : 'Alle registertester bestått');
process.exit(fails ? 1 : 0);
