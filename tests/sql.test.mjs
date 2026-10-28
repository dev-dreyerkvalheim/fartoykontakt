// Tester databasefunksjoner og tilgangsregler i en lokal Postgres (PGlite). Kjør: npm test
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../supabase/', import.meta.url));
const db = new PGlite({ extensions: { pg_trgm } });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// Etterligner Supabase sin auth-del
await db.exec(`
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon; create role authenticated; create role service_role bypassrls;
`);
await db.exec(fs.readFileSync(R + 'migrations/20261027000001_schema.sql', 'utf8'));
await db.exec(fs.readFileSync(R + 'migrations/20261027000002_functions.sql', 'utf8'));
await db.exec(fs.readFileSync(R + 'migrations/20261027000003_hardening.sql', 'utf8'));
await db.exec(fs.readFileSync(R + 'migrations/20261027000004_register_import.sql', 'utf8'));
await db.exec(fs.readFileSync(R + 'migrations/20261028000005_fiskeridir_sync.sql', 'utf8'));
await db.exec(fs.readFileSync(R + 'migrations/20261028000007_registry_perf.sql', 'utf8'));
await db.exec(fs.readFileSync(R + 'seed.sql', 'utf8'));
const U = { kari:'11111111-1111-1111-1111-111111111111', jonas:'22222222-2222-2222-2222-222222222222', per:'33333333-3333-3333-3333-333333333333', ola:'44444444-4444-4444-4444-444444444444', berg:'55555555-5555-5555-5555-555555555555' };
for (const [n, id] of Object.entries(U)) await db.query(`insert into auth.users values ($1, $2)`, [id, n + '@eksempel.no']);
const as = async (who) => { await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [who ? U[who] : '', who ? JSON.stringify({ email: who + '@eksempel.no' }) : '']); };
const call = async (sql, params = []) => { try { const r = await db.query(sql, params); return { rows: r.rows }; } catch (e) { return { err: e.message }; } };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

await as(null);
ok((await call(`select grant_membership('kari@eksempel.no','froyanes','admin','Kari Nordvik')`)).rows[0].grant_membership.startsWith('OK'), 'grant_membership fra SQL Editor');
await call(`select grant_membership('jonas@eksempel.no','froyanes','member','Jonas Vik')`);
await call(`select grant_membership('per@eksempel.no','froyanes','admin','Per Hansen')`);
await call(`select grant_membership('berg@eksempel.no','bergholm','admin','Berit Berg')`);
await call(`select make_platform_admin('ola@eksempel.no','Ola Drift')`);

// Offentlig katalog
const dir = (await one(`select get_directory() d`)).d;
ok(dir.vessels.length === 13 && dir.companies.length === 11, 'get_directory: 13 fartøy, 10 rederier + «Privat eier»');
ok(!JSON.stringify(dir.verifications).includes('"by"'), 'Bekreftelser offentlig uten hvem som bekreftet');
ok(!JSON.stringify(dir).includes('+4700097101'), 'Bergholm sitt skjulte gamle nummer er ikke i katalogen');
ok(dir.numberInfo.some(n => n.number === '+4700098401'), 'Frøyanes sitt viste gamle nummer er med');
const nordAlt = dir.verifications.filter(v => v.scopeId === 'nordsjobas' && v.field === 'altPhone').length;
ok(nordAlt === 0, 'Nordsjøbas alt-nummer ubekreftet (delvis)');

// Søk på gammelt nummer
for (const q of ['+47 000 98 401', '00098401', '004700098401']) {
  const r = (await one(`select search_number_history($1) r`, [q])).r;
  ok(r.length === 1 && r[0].vesselId === 'froyanes', `Søk gammelt nummer «${q}»`);
}
ok((await one(`select search_number_history('000 97 101') r`)).r[0]?.vesselId === 'bergholm', 'Skjult gammelt nummer er søkbart');
ok((await one(`select search_number_history('000') r`)).r.length === 0, 'For kort søk gir ingenting');

// Innmelding fra publikum
await as(null);
const rid = (await one(`select submit_report('lofotkyst','bridgePhone','Fartøyet har fått nytt nummer','000 88 199','','') id`)).id;
const rep = await one(`select * from reports where id=$1`, [rid]);
ok(rep.suggested === '+4700088199' && rep.current_value === '+4700088101', 'Innmelding lagrer normalisert forslag, endrer ikke fartøyet');
ok((await call(`select submit_report('lofotkyst','bridgePhone','x','12','','')`)).err === 'invalid', 'Ugyldig forslag avvises');

// Tilgang: publikum/uinnlogget
ok((await call(`select verify_vessel('froyanes', '{}'::jsonb)`)).err === 'forbidden', 'Uinnlogget kan ikke bekrefte');
ok((await call(`select get_admin_data()`)).err === 'forbidden', 'Uinnlogget får ikke admindata');

// Kontekst
await as('kari'); const ctx = (await one(`select my_context() c`)).c;
ok(ctx.role === 'admin' && ctx.companyId === 'froyanes' && ctx.name === 'Kari Nordvik', 'my_context for Kari');
await as('ola'); ok((await one(`select my_context() c`)).c.role === 'platform', 'my_context for plattformadmin');

// Admindata scoping
await as('kari'); let ad = (await one(`select get_admin_data() a`)).a;
ok(ad.reports.length === 3 && ad.reports.every(r => ['froyvik','froyanes'].includes(r.vesselId)), 'Kari ser bare Frøyanes-rederiets meldinger');
await as('jonas'); ad = (await one(`select get_admin_data() a`)).a;
ok(ad.reports.length === 0 && ad.numberHistory.length > 0, 'Medarbeider ser ikke meldinger, men ser nummerhistorikk');
await as('ola'); ad = (await one(`select get_admin_data() a`)).a;
ok(ad.reports.length === 5, 'Plattformadmin ser alle meldinger');

// Godta endring
const exp = async id => { const r = await one(`select bridge_phone, alt_phone, email from vessels where id=$1`, [id]); const c = await one(`select c.phone, c.email from companies c join vessels v on v.company_id=c.id where v.id=$1`, [id]); return { bridgePhone: r.bridge_phone || '', altPhone: r.alt_phone || '', email: r.email || '', 'co.phone': c.phone || '', 'co.email': c.email || '' }; };
await as('kari');
let res = await call(`select accept_report('r2','+47 000 11 205','+4700011201', true) a`);
ok(res.rows?.[0].a.verified === true, 'Kari godtar r2 → bekreftet');
ok((await one(`select bridge_phone from vessels where id='froyanes'`)).bridge_phone === '+4700011205', 'Nummer oppdatert');
ok((await one(`select count(*)::int n from number_history where vessel_id='froyanes' and number='+4700011201' and status='confirmed' and show_on_profile`)).n === 1, 'Gammelt nummer i historikk');
ok((await one(`select count(*)::int n from verifications where scope='vessel' and scope_id='froyanes' and field='bridgePhone' and value='+4700011205' and verified_by=$1`, [U.kari])).n === 1, 'Bekreftelse med eksakt verdi og hvem');
ok((await call(`select accept_report('r2','+4700011299','+4700011205')`)).err === 'already', 'Kan ikke godkjennes to ganger');
ok((await one(`select count(*)::int n from outbox where to_email='per@eksempel.no' and key='change:froyanes'`)).n === 1, 'Per (annen admin) varslet');
ok((await one(`select count(*)::int n from outbox where to_email='kari@eksempel.no' and key='change:froyanes'`)).n === 0, 'Kari ikke varslet om egen endring');
// Konflikt
ok((await call(`select accept_report('r3','x@y.no','feil@verdi.no')`)).err === 'conflict', 'Konflikt ved utdatert forventet verdi');
// Avvis
ok(!(await call(`select reject_report('r1','Opplysningen stemmer')`)).err && (await one(`select status from reports where id='r1'`)).status === 'rejected', 'Avvis melding');
// Uautorisert
await as('berg'); ok((await call(`select reject_report('r3','')`)).err === 'forbidden', 'Admin i annet rederi kan ikke behandle');
await as('jonas'); ok((await call(`select reject_report('r3','')`)).err === 'forbidden', 'Medarbeider kan ikke behandle');
// Plattformadmin godtar → ikke bekreftet
await as('ola'); res = await call(`select accept_report('r4','+4700022109','+4700022101') a`);
ok(res.rows?.[0].a.verified === false && (await one(`select count(*)::int n from verifications where scope_id='bergholm' and value='+4700022109'`)).n === 0, 'Plattformadmin: endret, men ikke bekreftet');

// Bekreft fartøy
await as('jonas'); ok((await call(`select verify_vessel('froyvik', $1::jsonb)`, [JSON.stringify(await exp('froyvik'))])).err === 'forbidden', 'Medarbeider kan ikke bekrefte');
await as('ola'); ok((await call(`select verify_vessel('froyvik', $1::jsonb)`, [JSON.stringify(await exp('froyvik'))])).err === 'forbidden', 'Plattformadmin kan ikke bekrefte for rederiet');
await as('kari'); ok((await call(`select verify_vessel('bergholm', $1::jsonb)`, [JSON.stringify(await exp('bergholm'))])).err === 'forbidden', 'Kari kan ikke bekrefte Bergholm');
const e1 = await exp('froyvik');
res = await call(`select verify_vessel('froyvik', $1::jsonb, $2::jsonb) v`, [JSON.stringify(e1), JSON.stringify({ altPhone: '000 11 499' })]);
ok(JSON.stringify(res.rows?.[0].v.changed) === '["altPhone"]', 'Bekreft med retting');
ok((await one(`select alt_phone from vessels where id='froyvik'`)).alt_phone === '+4700011499', 'Retting lagret');
ok((await one(`select count(*)::int n from verifications where scope_id='froyvik' and at > now() - interval '1 minute'`)).n >= 3, 'Alle felt bekreftet nå');
// Samtidig: Per endrer, Kari bekrefter med gammel visning
const old = await exp('froyfjord');
await as('per'); ok(!(await call(`select submit_change('froyfjord', $1::jsonb)`, [JSON.stringify([{ field:'altPhone', from:'+4700011302', to:'+4700011399' }])])).err, 'Per endrer alt-nummer');
await as('kari'); ok((await call(`select verify_vessel('froyfjord', $1::jsonb)`, [JSON.stringify(old)])).err === 'conflict', 'Karis gamle visning stoppes');
ok((await call(`select submit_change('froyfjord', $1::jsonb)`, [JSON.stringify([{ field:'altPhone', from:'+4700011302', to:'+4700011300' }])])).err === 'conflict', 'Lagring fra gammel visning stoppes');
// Medarbeider foreslår → admin godkjenner
await as('jonas'); res = await call(`select submit_change('froyfjord', $1::jsonb) r`, [JSON.stringify([{ field:'email', from:'bro@froyfjord.eksempel.no', to:'ny@froyfjord.eksempel.no' }])]);
ok(res.rows?.[0].r.published === false && (await one(`select email from vessels where id='froyfjord'`)).email === 'bro@froyfjord.eksempel.no', 'Medarbeiders forslag venter');
ok((await call(`select submit_change('froyfjord', $1::jsonb)`, [JSON.stringify([{ field:'email', from:'bro@froyfjord.eksempel.no', to:'ny2@froyfjord.eksempel.no' }])])).err === 'dup:email', 'Dobbelt forslag på samme felt avvises');
const cid = (await one(`select id from changes where vessel_id='froyfjord' and status='pending'`)).id;
await as('jonas'); ok((await call(`select decide_change($1, true)`, [cid])).err === 'forbidden', 'Medarbeider kan ikke godkjenne');
await as('per'); ok(!(await call(`select decide_change($1, true)`, [cid])).err && (await one(`select email from vessels where id='froyfjord'`)).email === 'ny@froyfjord.eksempel.no', 'Per godkjenner');
ok((await one(`select count(*)::int n from verifications where scope_id='froyfjord' and field='email' and value='ny@froyfjord.eksempel.no' and verified_by=$1`, [U.per])).n === 1, 'Godkjent verdi bekreftet av godkjenner');
ok((await one(`select count(*)::int n from outbox where to_email='jonas@eksempel.no'`)).n === 1, 'Jonas varslet om godkjenning');
// Gjenbrukt nummer
await as('kari'); const e2 = await exp('froyvik');
await call(`select verify_vessel('froyvik', $1::jsonb, $2::jsonb)`, [JSON.stringify(e2), JSON.stringify({ bridgePhone: '+4700098401' })]);
ok((await one(`select status from number_history where vessel_id='froyanes' and number='+4700098401'`)).status === 'reassigned', 'Gammelt nummer brukt av annet fartøy → «tatt i bruk av andre»');
// Innstilling
ok((await call(`select set_verify_months(12)`)).err === 'forbidden', 'Rederiadmin kan ikke endre utløpstid');
await as('ola'); ok(!(await call(`select set_verify_months(12)`)).err, 'Plattformadmin endrer utløpstid');
// Påminnelser dempes
await as('kari'); await call(`select set_config('request.jwt.claim.sub', $1, false)`, [U.kari]);
await db.exec(`update verifications set at = now() - interval '2 years' where scope_id='brattholm'`);
await as('kari'); await call(`update verifications set at = now() - interval '2 years' where scope_id='froyanes'`);
await call(`select run_reminders('froyanes')`); await call(`select run_reminders('froyanes')`);
ok((await one(`select count(*)::int n from outbox where to_email='kari@eksempel.no' and key='remind:froyanes'`)).n === 1, 'Påminnelse bare én gang');
// Gamle numre
const h9 = 'h9';
await as('jonas'); ok((await call(`select set_number_status($1,'confirmed')`, [h9])).err === 'forbidden', 'Medarbeider kan ikke bekrefte gamle numre');
await as('kari'); ok(!(await call(`select set_number_status($1,'confirmed')`, [h9])).err, 'Admin bekrefter gammelt nummer');


// Import av fartøyregisteret
const rows = [
  { id:'n-56-b', regNr:'N-56-B', callsign:'LK7381', name:'A Jensen', length:'14,99 m', width:'5.8', enginePower:'403', buildYear:'2001', registerDate:'2012-04-17', municipality:'Bodø', imo:'', ownerType:'COMPANY', ownerName:'A. Jensen AS', orgnr:'998076803', postalCode:'8003', city:'Bodø' },
  { id:'tr-2-nr', regNr:'TR-2-NR', callsign:'', name:'A-Bas', length:'6,8 m', width:'2.4', enginePower:'82', buildYear:'1969', registerDate:'2018-02-13', municipality:'Nærøysund', imo:'', ownerType:'PERSON', ownerName:'', orgnr:'', postalCode:'', city:'' },
  { id:'demo-1', regNr:'DEMO-1', callsign:'X', name:'Kapring', ownerType:'COMPANY', ownerName:'X AS', orgnr:'123456789' }
];
await as('kari'); ok((await call(`select import_register($1::jsonb)`, [JSON.stringify(rows)])).err === 'forbidden', 'Rederiadmin kan ikke importere');
await as('ola'); const imp0 = await call(`select import_register($1::jsonb) r`, [JSON.stringify(rows)]); let imp = imp0.rows[0].r;
ok(imp.new === 2 && imp.skipped === 1, 'Import: 2 nye, demofartøy kan ikke overskrives (' + JSON.stringify(imp) + ')');
ok((await one(`select company_id from vessels where reg_nr='TR-2-NR'`)).company_id === 'privat', 'Privat eier kobles til «Privat eier»');
ok((await one(`select name, source from companies where orgnr='998076803'`)).source === 'fiskeridir', 'Rederi opprettet fra registeret');
imp = (await call(`select import_register($1::jsonb) r`, [JSON.stringify(rows.slice(0, 2).map(r => ({ ...r, name: r.name + ' II' })))])).rows[0].r;
ok(imp.updated === 2 && (await one(`select name from vessels where reg_nr='N-56-B'`)).name === 'A Jensen II', 'Ny import oppdaterer registerdata');
await db.query(`update vessels set bridge_phone='+4799999999' where reg_nr='N-56-B'`);
await call(`select import_register($1::jsonb)`, [JSON.stringify(rows.slice(0, 1))]);
ok((await one(`select bridge_phone from vessels where reg_nr='N-56-B'`)).bridge_phone === '+4799999999', 'Import endrer aldri kontaktinfo');
ok((await one(`select companies_to_check() c`)).c.includes('998076803'), 'Rederi venter på Brreg-sjekk');
ok((await one(`select set_company_names($1::jsonb) n`, [JSON.stringify([{ orgnr:'998076803', name:'A. Jensen AS', place:'Bodø', status:'' }])])).n === 1, 'Navn fra Enhetsregisteret lagret');
ok(!(await one(`select companies_to_check() c`)).c.includes('998076803'), 'Sjekket rederi tas ikke med igjen');
const dir2 = (await one(`select get_directory() d`)).d;
ok(dir2.vessels.find(v => v.regNr === 'N-56-B').homePort === 'Bodø' && dir2.vessels.find(v => v.regNr === 'DEMO-1').demo === true, 'Katalogen viser kommune og demomerke');
await as('kari'); ok((await one(`select my_context() c`)).c.platform === false, 'my_context: platform-flagg');

// RLS: direkte tabellesing som anon
await db.exec(`grant usage on schema public to anon, authenticated; grant select on all tables in schema public to anon, authenticated;`);
await as(null); await db.exec(`set role anon`);
ok((await db.query(`select count(*)::int n from verifications`)).rows[0].n === 0, 'RLS: anon kan ikke lese bekreftelser direkte');
let rr = ''; try { rr = (await db.query(`select count(*)::int n from reports`)).rows[0].n; } catch (e) { rr = 'nektet'; }
ok(rr === 0 || rr === 'nektet', 'RLS: anon kan ikke lese meldinger (' + rr + ')');
let fx = ''; try { await db.query(`select verify_vessel('froyanes', '{}'::jsonb)`); } catch (e) { fx = e.message; }
ok(/permission denied/.test(fx), 'anon kan ikke kalle funksjoner som krever innlogging');
let nh = ''; try { nh = (await db.query(`select count(*)::int n from number_history`)).rows[0].n; } catch (e) { nh = 'nektet'; }
ok(nh === 0 || nh === 'nektet', 'RLS: anon kan ikke lese nummerhistorikk (' + nh + ')');
ok((await db.query(`select jsonb_array_length(get_directory()->'vessels') n`)).rows[0].n === 15, 'anon kan hente katalogen');
ok((await db.query(`select count(*)::int n from vessels`)).rows[0].n === 15, 'RLS: anon kan lese fartøy');
let w = ''; try { await db.query(`update vessels set bridge_phone='+4799999999' where id='froyanes'`); } catch (e) { w = e.message; }
ok((await db.query(`select bridge_phone from vessels where id='froyanes'`)).rows[0].bridge_phone !== '+4799999999', 'RLS: anon kan ikke endre fartøy (' + (w || '0 rader') + ')');
await db.exec(`reset role`);
await as('berg'); await db.exec(`set role authenticated`);
ok((await db.query(`select count(*)::int n from reports r join vessels v on v.id=r.vessel_id where v.company_id='froyanes'`)).rows[0].n === 0, 'RLS: Bergholm-admin ser ikke Frøyanes-meldinger');
await db.exec(`reset role`);
console.log(fails ? `${fails} feilet` : 'Alle SQL-tester bestått');
process.exit(fails ? 1 : 0);
