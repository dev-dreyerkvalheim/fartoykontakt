// Profilfonter (Dreyer Kvalheim), lagret med siden: ingen kall til Google, og bare latinske tegn (inkl. æøå)
import '@fontsource/syne/latin-600.css';
import '@fontsource/syne/latin-700.css';
import '@fontsource/poppins/latin-300.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/playfair-display/latin-400-italic.css';
import './styles.css';
import { createClient } from '@supabase/supabase-js';

/* =====================================================================
   OPPSETT
   Med VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY satt kjører siden mot Supabase
   (felles data, ekte innlogging og tilgangssjekk i databasen). Uten dem kjører den som
   lokal demo med data i nettleseren, slik prototypen gjorde.
   ===================================================================== */
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const SB_URL = ENV.VITE_SUPABASE_URL || '';
const SB_KEY = ENV.VITE_SUPABASE_PUBLISHABLE_KEY || ENV.VITE_SUPABASE_ANON_KEY || '';
const REMOTE = !!(SB_URL && SB_KEY);
const sb = REMOTE ? createClient(SB_URL, SB_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } }) : null;

'use strict';
/* =====================================================================
   DEMODATA
   Registerfelt (regNr, callsign, type, length, homePort) kommer senere fra
   Fiskeridirektoratets fartøyregister. Rederifelt (name, orgnr) fra
   Enhetsregisteret. Kontaktfelt eies av rederiet og lagres i egen backend.
   ===================================================================== */
const SEED = {
  v: 4,
  settings: { verifyMonths: 6 },  // plattformadministrator kan endre
  verifications: [],              // fylles av seedVerifications() under
  session: null,
  users: {
    kari:  { id:'kari',  name:'Kari Nordvik', role:'admin',  companyId:'froyanes', email:'kari@froyanes-rederi.eksempel.no' },
    jonas: { id:'jonas', name:'Jonas Vik',    role:'member', companyId:'froyanes', email:'jonas@froyanes-rederi.eksempel.no' },
    per:   { id:'per',   name:'Per Hansen',   role:'admin',  companyId:'froyanes', email:'per@froyanes-rederi.eksempel.no' },
    ola:   { id:'ola',   name:'Ola Drift',    role:'platform', companyId:null, email:'drift@fartoykontakt.eksempel.no' }
  },
  companies: [
    { id:'froyanes',  name:'Frøyanes Rederi AS',     orgnr:'000111222', phone:'+4700011200', email:'post@froyanes-rederi.eksempel.no', place:'Fosnavåg' },
    { id:'bergholm',  name:'Bergholm Fiskeri AS',    orgnr:'000222333', phone:'+4700022100', email:'post@bergholm.eksempel.no', place:'Austevoll' },
    { id:'nordsjo',   name:'Nordsjø Pelagic AS',     orgnr:'000333444', phone:'+4700033100', email:'post@nordsjopelagic.eksempel.no', place:'Karmøy' },
    { id:'havbris',   name:'Havbris AS',             orgnr:'000444555', phone:'+4700044100', email:'post@havbris.eksempel.no', place:'Ballstad' },
    { id:'kvitholmen',name:'Kvitholmen Kystfiske AS',orgnr:'000555666', phone:'', email:'', place:'Myre' },
    { id:'solvtind',  name:'Sølvtind Havfiske AS',   orgnr:'000666777', phone:'+4700055100', email:'post@solvtind.eksempel.no', place:'Tromsø' },
    { id:'brattholm', name:'Brattholm Rederi AS',    orgnr:'000777888', phone:'+4700066100', email:'post@brattholm.eksempel.no', place:'Ålesund' },
    { id:'vestbris',  name:'Vestbris AS',            orgnr:'000888999', phone:'+4700077100', email:'post@vestbris.eksempel.no', place:'Bergen' },
    { id:'lofotkyst', name:'Lofotkyst Fiskeri AS',   orgnr:'000999111', phone:'+4700088100', email:'post@lofotkyst.eksempel.no', place:'Svolvær' },
    { id:'gronnes',   name:'Grønnes Fiske AS',       orgnr:'000123456', phone:'', email:'', place:'Frøya' }
  ],
  vessels: [
    { id:'froyanes', name:'Frøyanes', companyId:'froyanes', regNr:'M-111-HØ', callsign:'LKFR', type:'Ringnotsnurper', length:'76,4 m', homePort:'Fosnavåg', claimed:true,
      bridgePhone:'+4700011201', altPhone:'+4700011202', email:'bro@froyanes.eksempel.no', verifiedAt:'2026-10-14', updatedAt:'2026-10-12' },
    { id:'froyfjord', name:'Frøyfjord', companyId:'froyanes', regNr:'M-112-HØ', callsign:'LKFJ', type:'Tråler', length:'58,0 m', homePort:'Fosnavåg', claimed:true,
      bridgePhone:'+4700011301', altPhone:'+4700011302', email:'bro@froyfjord.eksempel.no', verifiedAt:'2026-08-02', updatedAt:'2026-08-02' },
    { id:'froyvik', name:'Frøyvik', companyId:'froyanes', regNr:'M-113-HØ', callsign:'LKFV', type:'Kystnotsnurper', length:'24,9 m', homePort:'Fosnavåg', claimed:true,
      bridgePhone:'+4700011401', altPhone:'', email:'froyvik@froyanes-rederi.eksempel.no', verifiedAt:'2026-02-11', updatedAt:'2026-02-11' },
    { id:'bergholm', name:'Bergholm', companyId:'bergholm', regNr:'H-24-AV', callsign:'LJBH', type:'Ringnotsnurper', length:'69,9 m', homePort:'Austevoll', claimed:true,
      bridgePhone:'+4700022101', altPhone:'+4700022102', email:'bro@bergholm.eksempel.no', verifiedAt:'2026-09-30', updatedAt:'2026-09-28' },
    { id:'malmoy', name:'Malmøy', companyId:'bergholm', regNr:'H-25-AV', callsign:'LJMY', type:'Pelagisk tråler', length:'61,2 m', homePort:'Austevoll', claimed:true,
      bridgePhone:'+4700022201', altPhone:'', email:'bro@malmoy.eksempel.no', verifiedAt:'2026-05-20', updatedAt:'2026-05-20' },
    { id:'nordsjobas', name:'Nordsjøbas', companyId:'nordsjo', regNr:'R-3-K', callsign:'LNSB', type:'Ringnotsnurper', length:'72,0 m', homePort:'Karmøy', claimed:true,
      bridgePhone:'+4700033101', altPhone:'+4700033102', email:'bro@nordsjobas.eksempel.no', verifiedAt:'2026-10-20', updatedAt:'2026-10-20' },
    { id:'havbris', name:'Havbris', companyId:'havbris', regNr:'N-7-VV', callsign:'LHBR', type:'Autoliner', length:'49,9 m', homePort:'Ballstad', claimed:true,
      bridgePhone:'+4700044101', altPhone:'', email:'bro@havbris.eksempel.no', verifiedAt:'2025-12-10', updatedAt:'2025-12-10' },
    { id:'kvitholmen', name:'Kvitholmen', companyId:'kvitholmen', regNr:'N-112-Ø', callsign:'LKVH', type:'Snurrevadbåt', length:'21,3 m', homePort:'Myre', claimed:false,
      bridgePhone:'', altPhone:'', email:'', verifiedAt:null, updatedAt:null },
    { id:'solvtind', name:'Sølvtind', companyId:'solvtind', regNr:'T-22-T', callsign:'LSVT', type:'Fabrikktråler', length:'64,5 m', homePort:'Tromsø', claimed:true,
      bridgePhone:'+4700055101', altPhone:'+870000055102', email:'bro@solvtind.eksempel.no', verifiedAt:'2026-07-15', updatedAt:'2026-07-15' },
    { id:'brattholm', name:'Brattholm', companyId:'brattholm', regNr:'M-80-A', callsign:'LBRA', type:'Autoliner', length:'44,0 m', homePort:'Ålesund', claimed:true,
      bridgePhone:'+4700066101', altPhone:'', email:'bro@brattholm.eksempel.no', verifiedAt:'2026-06-02', updatedAt:'2026-06-02' },
    { id:'vestbris', name:'Vestbris', companyId:'vestbris', regNr:'H-9-B', callsign:'LVST', type:'Ringnotsnurper', length:'70,1 m', homePort:'Bergen', claimed:true,
      bridgePhone:'+4700077101', altPhone:'+4700077102', email:'bro@vestbris.eksempel.no', verifiedAt:'2026-10-03', updatedAt:'2026-10-03' },
    { id:'lofotkyst', name:'Lofotkyst', companyId:'lofotkyst', regNr:'N-55-MS', callsign:'LLOF', type:'Snurrevadbåt', length:'27,5 m', homePort:'Svolvær', claimed:true,
      bridgePhone:'+4700088101', altPhone:'+4700093101', email:'bro@lofotkyst.eksempel.no', verifiedAt:'2026-09-11', updatedAt:'2026-09-11' },
    { id:'gronnes', name:'Grønnes', companyId:'gronnes', regNr:'ST-12-F', callsign:'LGRN', type:'Kystnotsnurper', length:'19,9 m', homePort:'Frøya', claimed:false,
      bridgePhone:'', altPhone:'', email:'', verifiedAt:null, updatedAt:null }
  ],
  changes: [
    { id:'c1', vesselId:'froyanes', field:'bridgePhone', from:'+4700098401', to:'+4700011201', by:'kari', byName:'Kari Nordvik', at:'2026-10-12T09:14', status:'published', showPrevious:true, note:'Byttet til ny satellittløsning' },
    { id:'c2', vesselId:'froyanes', field:'confirm', from:'', to:'', by:'kari', byName:'Kari Nordvik', at:'2026-10-14T13:02', status:'confirmed' },
    { id:'c3', vesselId:'froyfjord', field:'altPhone', from:'+4700011302', to:'+4700011312', by:'jonas', byName:'Jonas Vik', at:'2026-10-26T16:40', status:'pending' },
    { id:'c4', vesselId:'froyvik', field:'email', from:'post@froyanes-rederi.eksempel.no', to:'froyvik@froyanes-rederi.eksempel.no', by:'kari', byName:'Kari Nordvik', at:'2026-02-11T10:05', status:'published' }
  ],
  /* Innmeldte feil fra publikum (DEMODATA). field = hvilket felt meldingen gjelder,
     current = verdien da meldingen kom, suggested = forslag fra innmelder (aldri verifisert). */
  reports: [
    { id:'r1', vesselId:'froyvik',  field:'bridgePhone', reason:'Telefonnummeret virker ikke', current:'+4700011401', suggested:null,
      details:'Fikk beskjed om at nummeret ikke er i bruk.', contact:'', at:'2026-10-22T07:51', status:'new' },
    { id:'r2', vesselId:'froyanes', field:'bridgePhone', reason:'Fartøyet har fått nytt nummer', current:'+4700011201', suggested:'+4700011205',
      details:'Skipperen ga meg dette nummeret på kaia i går.', contact:'ola.fisk@eksempel.no', at:'2026-10-26T18:12', status:'new' },
    { id:'r3', vesselId:'froyanes', field:'email', reason:'Feil e-postadresse', current:'bro@froyanes.eksempel.no', suggested:'bro.froyanes@eksempel.no',
      details:'', contact:'', at:'2026-10-25T09:30', status:'new' },
    { id:'r4', vesselId:'bergholm', field:'bridgePhone', reason:'Telefonnummeret virker ikke', current:'+4700022101', suggested:'+4700022109',
      details:'', contact:'', at:'2026-10-24T14:05', status:'new' }
  ],
  /* Tidligere telefonnumre (DEMODATA, oppdiktede numre).
     status: confirmed   = rederiet har bekreftet at nummeret var fartøyets
             unconfirmed = kommer fra eldre lister eller publikum, ikke bekreftet
             reassigned  = nummeret er tatt i bruk av noen andre
             rejected    = rederiet sier det aldri var deres (søkes ikke)
     showOnProfile: rederiet har valgt å vise nummeret på fartøysiden. */
  numberHistory: [
    { id:'h1', vesselId:'froyanes',   number:'+4700098401', replacedAt:'2026-10-12', replacedBy:'+4700011201', status:'confirmed',   verifiedAt:'2026-10-14', source:'Rederiet', showOnProfile:true },
    { id:'h2', vesselId:'froyanes',   number:'+4700098400', replacedAt:'2019-05-02', replacedBy:'+4700098401', status:'confirmed',   verifiedAt:'2019-05-02', source:'Rederiet', showOnProfile:false },
    { id:'h3', vesselId:'bergholm',   number:'+4700097101', replacedAt:'2026-09-28', replacedBy:'+4700022101', status:'confirmed',   verifiedAt:'2026-09-30', source:'Rederiet', showOnProfile:false },
    { id:'h4', vesselId:'malmoy',     number:'+4700092201', replacedAt:'2026-04-15', replacedBy:'+4700022201', status:'confirmed',   verifiedAt:'2026-05-20', source:'Rederiet', showOnProfile:false },
    { id:'h5', vesselId:'nordsjobas', number:'+4700096301', replacedAt:'2026-10-20', replacedBy:'+4700033101', status:'confirmed',   verifiedAt:'2026-10-20', source:'Rederiet', showOnProfile:true },
    { id:'h6', vesselId:'vestbris',   number:'+4700095701', replacedAt:'2026-10-03', replacedBy:'+4700077101', status:'confirmed',   verifiedAt:'2026-10-03', source:'Rederiet', showOnProfile:true },
    { id:'h7', vesselId:'havbris',    number:'+4700094101', replacedAt:null,         replacedBy:null,          status:'unconfirmed', verifiedAt:null,         source:'Eldre kontaktliste', showOnProfile:false },
    { id:'h8', vesselId:'solvtind',   number:'+4700093101', replacedAt:'2025-11-01', replacedBy:'+4700055101', status:'reassigned',  verifiedAt:'2026-08-14', source:'Rederiet', showOnProfile:false },
    { id:'h9', vesselId:'froyfjord',  number:'+4700098501', replacedAt:null,         replacedBy:null,          status:'unconfirmed', verifiedAt:null,         source:'Meldt inn av publikum', showOnProfile:false }
  ],
  applications: [],
  outbox: []
};

/* =====================================================================
   LAGRING (lokalt i nettleseren — kun for demo)
   ===================================================================== */
const STORE_KEY = 'fartoykontakt-demo-v4';
const clone = o => JSON.parse(JSON.stringify(o));
function load(){
  try { const raw = localStorage.getItem(STORE_KEY); if (raw){ const d = JSON.parse(raw); if (d && d.v === 4) return d; } } catch(e){}
  const d = clone(SEED); seedVerifications(d); return d;
}
/* DEMODATA: lager bekreftelser ut fra datoene i eksempeldataene.
   Nordsjøbas sitt alternative nummer er lagt inn uten bekreftelse, for å vise «delvis bekreftet». */
function seedVerifications(d){
  const by = co => co === 'froyanes' ? 'kari' : 'rep-' + co;
  const latest = {};
  for (const v of d.vessels){
    if (!v.verifiedAt) continue;
    for (const f of ['bridgePhone','altPhone','email']){
      if (!v[f] || (v.id === 'nordsjobas' && f === 'altPhone')) continue;
      d.verifications.push({ id:'vs-'+v.id+'-'+f, scope:'vessel', scopeId:v.id, field:f, value:v[f], at:v.verifiedAt+'T12:00', by:by(v.companyId), source:'demo' });
    }
    if (!latest[v.companyId] || v.verifiedAt > latest[v.companyId]) latest[v.companyId] = v.verifiedAt;
  }
  for (const c of d.companies) for (const f of ['phone','email'])
    if (c[f] && latest[c.id]) d.verifications.push({ id:'vs-'+c.id+'-'+f, scope:'company', scopeId:c.id, field:f, value:c[f], at:latest[c.id]+'T12:00', by:by(c.id), source:'demo' });
}
function save(){ if (REMOTE) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch(e){} }
function emptyDb(){ return { v:4, settings:{ verifyMonths:6 }, verifications:[], session:null, users:{}, companies:[], vessels:[], changes:[], reports:[], numberHistory:[], publicHistory:[], applications:[], outbox:[] }; }
let db = REMOTE ? emptyDb() : load();

/* =====================================================================
   DATALAG — alle kall går gjennom disse objektene.
   Bytt ut innmaten senere med:
     api      → Supabase (tabeller: vessels, contacts, changes, reports, memberships)
     registry → Fiskeridirektoratets fartøyregister + Enhetsregisteret (Brreg)
     auth     → BankID via OIDC-leverandør (identitet) + egen sjekk av rolle i rederiet
     notify   → E-posttjeneste (varsler ved endringer)
   ===================================================================== */
const wait = ms => new Promise(r => setTimeout(r, ms));
function requireOnline(){ if (!navigator.onLine) { const e = new Error('offline'); e.code = 'offline'; throw e; } }
const nowISO = () => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const notify = {
  /* Senere: send e-post. Nå: legg i en lokal utboks.
     key + windowHours demper støy: samme type varsel til samme person sendes ikke på nytt innen vinduet. */
  queue(to, subject, key, windowHours){
    if (!to) return false;
    if (key){
      const since = Date.now() - (windowHours || 1) * 3600000;
      if (db.outbox.some(m => m.to === to && m.key === key && new Date(m.at).getTime() >= since)) return false;
    }
    db.outbox.push({ to, subject, key: key || null, at: nowISO(), sent:false });
    return true;
  }
};
function notifyOtherAdmins(v, actor, subject){
  adminsOf(v.companyId).filter(a => !actor || a.id !== actor.id).forEach(a => notify.queue(a.email, subject, 'change:' + v.id, 1));
}

const api = {
  async search(q){ await wait(120); return searchLocal(q); },
  getVessel(id){ return db.vessels.find(v => v.id === id) || null; },
  company(id){ return db.companies.find(c => c.id === id) || null; },
  vesselsFor(companyId){ return db.vessels.filter(v => v.companyId === companyId); },
  pendingFor(vesselId){ return db.changes.filter(c => c.vesselId === vesselId && c.status === 'pending'); },
  historyFor(vesselId){ return db.changes.filter(c => c.vesselId === vesselId).sort((a,b) => b.at.localeCompare(a.at)); },

  async submitChange(vesselId, fields, showPrevious, user){
    await wait(450); requireOnline();
    const v = api.getVessel(vesselId);
    if (!v || !user || v.companyId !== user.companyId) throw fail('forbidden');
    const at = nowISO(); const isAdmin = user.role === 'admin';
    // Avvis endringer basert på gammel visning (noen andre kan ha endret feltet i mellomtiden)
    for (const f of fields) if ((v[f.field] || '') !== (f.from || '')) throw fail('conflict');
    for (const f of fields){
      if (!isAdmin && api.pendingFor(vesselId).some(c => c.field === f.field)) { const e = new Error('dup'); e.code='dup'; e.field=f.field; throw e; }
    }
    const created = fields.map((f,i) => ({ id:'c'+Date.now()+i, vesselId, field:f.field, from:f.from, to:f.to, by:user.id, byName:user.name, at,
      status: isAdmin ? 'published' : 'pending', showPrevious: f.field === 'bridgePhone' ? !!showPrevious : false }));
    db.changes.push(...created);
    if (isAdmin) created.forEach(c => applyChange(v, c, user));
    notifyOtherAdmins(v, user, isAdmin ? `${user.name} har endret kontaktinfo for ${v.name}` : `${user.name} har foreslått endring for ${v.name}`);
    save();
    return { published: isAdmin, count: created.length };
  },
  async confirm(vesselId, user, expected){ return api.verifyVessel(vesselId, { expected, edits:{} }, user); },

  /* ---- Bekreftet av rederiet ----
     BACKEND: verify_vessel(vessel_id, expected, edits) som databasefunksjon:
       – finn rederiet fra fartøyet i databasen, og krev at brukeren er administrator der
       – sammenlign «expected» med det som er lagret nå; avvis hvis noe er endret i mellomtiden
       – lagre eventuelle rettinger, og deretter én bekreftelse per felt med eksakt verdi
       – tidspunktet settes av databasen (now()); nettleseren kan ikke sende inn dato */
  async verifyVessel(vesselId, { expected, edits } = {}, user){
    await wait(400); requireOnline();
    const v = api.getVessel(vesselId);
    if (!v) throw fail('notfound');
    if (!isCompanyAdmin(user, v)) throw fail('forbidden');
    const c = api.company(v.companyId);
    const cur = snapshotOf(v);
    for (const k of Object.keys(cur)) if (((expected || {})[k] ?? '') !== cur[k]) throw fail('conflict');
    const clean = {};
    for (const [k, raw] of Object.entries(edits || {})){
      if (!(k in cur)) throw fail('invalid');
      const isMail = k.endsWith('email');
      const val = isMail ? String(raw || '').trim() : normPhone(raw);
      if (k === 'bridgePhone' && !val){ const e = fail('required'); e.field = k; throw e; }
      if (val && (isMail ? !validEmail(val) : !validPhone(val))){ const e = fail('invalid'); e.field = k; throw e; }
      if (val !== cur[k]) clean[k] = val;
    }
    const at = nowISO();
    for (const [k, val] of Object.entries(clean)){
      const ch = { id:'c'+Date.now()+k, vesselId:v.id, field:k, from:cur[k], to:val, by:user.id, byName:user.name, at, status:'published', via:'verify' };
      db.changes.push(ch);
      if (k.startsWith('co.')){ c[k.slice(3)] = val; }
      else applyChange(v, ch, user);
    }
    for (const f of contactFields(v)) addVerification(f.scope, f.scopeId, f.field, f.value, user, 'confirm');
    db.changes.push({ id:'c'+Date.now()+'v', vesselId:v.id, field:'confirm', from:'', to:'', by:user.id, byName:user.name, at, status:'confirmed' });
    closeReports(v.id, null, user.name, 'Bekreftet at opplysningene stemmer');
    if (Object.keys(clean).length) notifyOtherAdmins(v, user, `${user.name} har endret kontaktinfo for ${v.name}`);
    save();
    return { changed: Object.keys(clean) };
  },
  async setVerifyMonths(months, user){
    await wait(200); requireOnline();
    if (!user || user.role !== 'platform') throw fail('forbidden');
    if (![3,6,12].includes(Number(months))) throw fail('invalid');
    db.settings.verifyMonths = Number(months); save();
  },
  async decide(changeId, approve, user){
    await wait(350); requireOnline();
    const c = db.changes.find(x => x.id === changeId);
    if (!c || !isCompanyAdmin(user, api.getVessel(c.vesselId))) throw fail('forbidden');
    if (c.status !== 'pending') throw fail('already');
    const v = api.getVessel(c.vesselId);
    if ((v[c.field] || '') !== (c.from || '')) throw fail('conflict');
    c.status = approve ? 'approved' : 'rejected'; c.decidedBy = user.name; c.decidedAt = nowISO();
    if (approve) applyChange(v, c, user);
    const author = db.users[c.by]; if (author) notify.queue(author.email, approve ? 'Endringen din er godkjent' : 'Endringen din ble avvist');
    save();
  },
  async report(vesselId, data){
    await wait(500); requireOnline();
    const v = api.getVessel(vesselId);
    // Forslaget lagres som et uverifisert forslag. Det publiseres aldri uten at en administrator godtar det.
    db.reports.push({ id:'r'+Date.now(), vesselId, field:data.field || null, reason:data.reason, current: data.field ? (v[data.field] || '') : '',
      suggested:data.suggested || null, details:data.details, contact:data.contact, at:nowISO(), status:'new' });
    adminsOf(v.companyId).forEach(a => notify.queue(a.email, 'Nye innmeldte feil om fartøyene deres', 'reports:' + v.companyId, 1));
    save();
  },
  /* ---- Innmeldte feil ----
     BACKEND: acceptReport og rejectReport må kjøres på serveren, f.eks. som én databasefunksjon i en transaksjon:
       1. Hent meldingen med id, og finn fartøy og rederi i databasen. Stol aldri på fartøy- eller rederi-id fra nettleseren.
       2. Sjekk at innlogget bruker er administrator i rederiet som eier fartøyet, eller plattformadministrator.
       3. Lås raden (SELECT … FOR UPDATE), og avvis hvis meldingen allerede er behandlet.
       4. Avvis hvis feltet er endret siden administratoren åpnet meldingen (sammenlign med «expected»).
       5. Oppdater kontaktinfo, lagre gammelt nummer i nummerhistorikken, skriv endringslogg og send varsler.
     I prototypen gjøres det samme lokalt. JavaScript kjører én ting om gangen, så statussjekken hindrer dobbel godkjenning. */
  reportsFor(user){
    if (!user) return [];
    if (user.role === 'platform' || user.platform) return db.reports.slice();
    if (user.role !== 'admin') return [];
    return db.reports.filter(r => { const v = api.getVessel(r.vesselId); return v && v.companyId === user.companyId; });
  },
  openReportCount(user){ return api.reportsFor(user).filter(r => r.status === 'new').length; },
  _checkReport(reportId, user){
    const r = db.reports.find(x => x.id === reportId);
    if (!r) throw fail('notfound');
    const v = api.getVessel(r.vesselId);
    if (!canManage(user, v)) throw fail('forbidden');
    if (r.status !== 'new') throw fail('already');
    return { r, v };
  },
  async acceptReport(reportId, { value, expected, showPrevious }, user){
    await wait(450); requireOnline();
    const { r, v } = api._checkReport(reportId, user);
    const f = r.field; if (!f) throw fail('nofield');
    const val = f === 'email' ? (value || '').trim() : normPhone(value);
    if (f === 'email' ? !validEmail(val) : !validPhone(val)) throw fail('invalid');
    if ((v[f] || '') !== (expected || '')) throw fail('conflict');
    if (val === (v[f] || '')) throw fail('same');
    const at = nowISO();
    const c = { id:'c'+Date.now(), vesselId:v.id, field:f, from:v[f] || '', to:val, by:user.id, byName:user.name, at, status:'published',
      showPrevious: f === 'bridgePhone' && !!showPrevious, via:'report', reportId:r.id };
    db.changes.push(c);
    applyChange(v, c, user);   // bekrefter feltet bare hvis brukeren er administrator i rederiet
    r.status = val === r.suggested ? 'accepted' : 'corrected';
    r.resolvedBy = user.name; r.resolvedAt = at; r.resolvedValue = val;
    notifyOtherAdmins(v, user, `${user.name} har endret kontaktinfo for ${v.name} etter innmeldt feil`);
    if (r.contact) notify.queue(r.contact, `Takk! Kontaktinfo for ${v.name} er rettet`);
    save();
    return { vessel:v, value:val, verified: isCompanyAdmin(user, v) };
  },
  async rejectReport(reportId, reason, user){
    await wait(300); requireOnline();
    const { r, v } = api._checkReport(reportId, user);
    const at = nowISO();
    r.status = 'rejected'; r.resolvedBy = user.name; r.resolvedAt = at; r.rejectReason = (reason || '').trim();
    db.changes.push({ id:'c'+Date.now(), vesselId:v.id, field:'report', from:r.reason, to:r.rejectReason || 'Ingen begrunnelse', by:user.id, byName:user.name,
      at, status:'rejected', decidedBy:user.name, reportId:r.id });
    save();
  },

  /* Tidligere numre. Senere: egen tabell number_history i backend. */
  numbersFor(vesselId){
    return db.numberHistory.filter(h => h.vesselId === vesselId && h.status !== 'rejected')
      .sort((a,b) => (b.replacedAt || '').localeCompare(a.replacedAt || ''));
  },
  async setNumberStatus(historyId, status, user){
    await wait(300); requireOnline();
    const h = db.numberHistory.find(x => x.id === historyId);
    const v = h && api.getVessel(h.vesselId);
    if (!h || !v || v.companyId !== user.companyId || user.role !== 'admin') throw new Error('forbidden');
    h.status = status; h.verifiedAt = nowISO().slice(0,10);
    db.changes.push({ id:'c'+Date.now(), vesselId:v.id, field:'history', from:fmtPhone(h.number), to:HIST_LABEL[status], by:user.id, byName:user.name, at:nowISO(), status:'published' });
    save();
  }
};
const HIST_LABEL = { confirmed:'Bekreftet som fartøyets nummer', unconfirmed:'Ikke bekreftet', reassigned:'Tatt i bruk av andre', rejected:'Ikke fartøyets nummer' };
function fail(code){ const e = new Error(code); e.code = code; return e; }
function isCompanyAdmin(user, v){ return !!user && !!v && user.role === 'admin' && user.companyId === v.companyId; }
function canManage(user, v){ return !!user && !!v && (user.role === 'platform' || user.platform || (user.role === 'admin' && user.companyId === v.companyId)); }
function adminsOf(companyId){ return Object.values(db.users).filter(u => u.companyId === companyId && u.role === 'admin'); }
/* Når rederiet selv retter eller bekrefter et felt, lukkes åpne meldinger om samme felt — med navn i loggen. */
function closeReports(vesselId, field, byName, note){
  db.reports.forEach(r => {
    if (r.vesselId !== vesselId || r.status !== 'new') return;
    if (field && r.field && r.field !== field) return;
    r.status = 'resolved'; r.resolvedBy = byName || ''; r.resolvedAt = nowISO(); r.resolution = note || 'Rettet av rederiet';
  });
}
/* actor = den som publiserer eller godkjenner. Er det en administrator i rederiet, regnes den nye
   verdien som bekreftet av rederiet. Ellers blir feltet «Ikke bekreftet» til rederiet bekrefter det. */
function applyChange(v, c, actor){
  const day = c.at.slice(0,10);
  if ((c.field === 'bridgePhone' || c.field === 'altPhone') && c.to){
    const newKey = phoneKey(c.to);
    // Et nummer som nå er bekreftet i bruk, kan ikke lenger peke til et annet fartøy.
    db.numberHistory.forEach(h => {
      if (phoneKey(h.number) !== newKey) return;
      if (h.vesselId === v.id) h.status = 'rejected-reused';
      else if (h.status !== 'rejected') { h.status = 'reassigned'; h.verifiedAt = day; }
    });
    db.numberHistory = db.numberHistory.filter(h => h.status !== 'rejected-reused');
  }
  if ((c.field === 'bridgePhone' || c.field === 'altPhone') && c.from){
    db.numberHistory.push({ id:'h'+Date.now()+c.field, vesselId:v.id, number:c.from, replacedAt:day, replacedBy:c.to || null,
      status:'confirmed', verifiedAt:day, verifiedBy:c.byName, validUntil:day, source:'Rederiet', showOnProfile: c.field === 'bridgePhone' && !!c.showPrevious });
  }
  v[c.field] = c.to;
  v.updatedAt = c.at.slice(0,10);
  if (isCompanyAdmin(actor, v) && c.to) addVerification('vessel', v.id, c.field, c.to, actor, c.via || 'change');
  closeReports(v.id, c.field, c.decidedBy || c.byName, 'Rettet av rederiet');
}

/* =====================================================================
   BEKREFTET AV REDERIET — avledet status
   En bekreftelse gjelder én bestemt verdi i ett felt. Endres verdien, gjelder ikke
   bekreftelsen lenger, fordi vi alltid sammenligner med verdien som ble bekreftet.
   BACKEND: tabell verifications(scope, scope_id, field, value, verified_at default now(), verified_by).
   Bare databasefunksjoner som sjekker rolle kan skrive dit. Offentlig visning leser bare et view
   med status og dato — aldri hvem som bekreftet.
   ===================================================================== */
const VESSEL_FIELDS = ['bridgePhone','altPhone','email'];
const COMPANY_FIELDS = ['phone','email'];
const VLABEL = { bridgePhone:'Telefon til broen', altPhone:'Alternativt nummer', email:'E-post til fartøyet', 'co.phone':'Rederiets telefon', 'co.email':'Rederiets e-post' };
function verifyMonths(){ return (db.settings && db.settings.verifyMonths) || 6; }
function isFresh(at){
  if (!at) return false;
  const d = new Date(at.slice(0,10) + 'T12:00'); d.setMonth(d.getMonth() + verifyMonths());
  return d.getTime() >= Date.now();
}
function addVerification(scope, scopeId, field, value, user, source){
  // Kalles bare fra «server»-funksjonene over. Tidspunktet settes her, aldri fra skjermen.
  db.verifications.push({ id:'vf'+Date.now()+Math.random().toString(36).slice(2,7), scope, scopeId, field, value, at: nowISO(), by: user.id, source });
}
function fieldState(scope, scopeId, field, value){
  let best = null;
  for (const x of db.verifications) if (x.scope === scope && x.scopeId === scopeId && x.field === field && x.value === value && (!best || x.at > best.at)) best = x;
  if (!best) return { state:'unverified', at:null };
  return { state: isFresh(best.at) ? 'verified' : 'stale', at: best.at };
}
function snapshotOf(v){
  const c = api.company(v.companyId) || {};
  return { bridgePhone:v.bridgePhone || '', altPhone:v.altPhone || '', email:v.email || '', 'co.phone':c.phone || '', 'co.email':c.email || '' };
}
/* Alt som vises offentlig for et fartøy: fartøyets felt + rederiets kontaktinfo */
function contactFields(v){
  const c = api.company(v.companyId);
  const out = [];
  for (const f of VESSEL_FIELDS) if (v[f]) out.push({ key:f, scope:'vessel', scopeId:v.id, field:f, value:v[f], label:VLABEL[f], ...fieldState('vessel', v.id, f, v[f]) });
  for (const f of COMPANY_FIELDS) if (c && c[f]) out.push({ key:'co.'+f, scope:'company', scopeId:c.id, field:f, value:c[f], label:VLABEL['co.'+f], ...fieldState('company', c.id, f, c[f]) });
  return out;
}
function vesselVerification(v){
  const fields = contactFields(v);
  if (!fields.some(f => f.scope === 'vessel')) return { state:'unclaimed', at:null, fields };
  const st = fields.map(f => f.state);
  const dates = fields.filter(f => f.at).map(f => f.at).sort();
  let state;
  if (st.every(x => x === 'verified')) state = 'verified';
  else if (st.every(x => x !== 'unverified')) state = 'stale';
  else if (st.some(x => x !== 'unverified')) state = 'partial';
  else state = 'unverified';
  // Datoen er den eldste bekreftelsen: «alt er bekreftet siden …»
  return { state, at: (state === 'verified' || state === 'stale') ? dates[0] : null, fields };
}
function fieldTag(f){
  if (!f) return '';
  if (f.state === 'verified') return `<span class="ftag ftag-ok" title="Bekreftet av rederiet ${esc(fmtDate(f.at))}">${ICON.check}Bekreftet ${esc(fmtDate(f.at, true))}</span>`;
  if (f.state === 'stale') return `<span class="ftag ftag-warn" title="Sist bekreftet ${esc(fmtDate(f.at))}">${ICON.clock}Bør bekreftes på nytt</span>`;
  return `<span class="ftag ftag-none">${ICON.dash}Ikke bekreftet</span>`;
}
/* Påminnelser: én samlet melding per administrator, høyst hver 14. dag. */
function runReminders(){
  if (REMOTE){ const u = auth.current(); if (u && u.companyId) remoteRpc('run_reminders', { p_company: u.companyId }).catch(() => {}); return; }
  for (const co of db.companies){
    const need = db.vessels.filter(v => v.companyId === co.id && ['stale','partial','unverified'].includes(vesselVerification(v).state));
    if (!need.length) continue;
    adminsOf(co.id).forEach(a => notify.queue(a.email, need.length === 1 ? `${need[0].name} må bekreftes på nytt` : `${need.length} fartøy må bekreftes på nytt`, 'remind:' + co.id, 24 * 14));
  }
  save();
}

const auth = {
  // Senere: BankID-pålogging. BankID bekrefter bare hvem personen er.
  async startBankId(){ await wait(1200); return { simulated:true }; },
  current(){ return db.session ? db.users[db.session] : null; },
  signIn(id){ db.session = id; save(); },
  signOut(){ db.session = null; save(); }
};
const registry = {
  // Senere: oppslag i Enhetsregisteret (navn, roller, signatur).
  async lookupOrg(orgnr){ await wait(800); requireOnline();
    const known = db.companies.find(c => c.orgnr === orgnr);
    return { orgnr, name: known ? known.name : 'Eksempel Kystrederi AS', simulated:true };
  }
};

/* =====================================================================
   SØK — tåler skrivefeil, æøå, mellomrom og bindestrek
   ===================================================================== */
function norm(s){ return (s||'').toLowerCase().replace(/æ/g,'ae').replace(/ø/g,'o').replace(/å/g,'a').normalize('NFD').replace(/[̀-ͯ]/g,''); }
function compact(s){ return norm(s).replace(/[^a-z0-9]/g,''); }
function digits(s){ return (s||'').replace(/\D/g,''); }
function osa(a, b){
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({length:m+1}, (_,i) => { const r = new Array(n+1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++){
    const cost = a[i-1] === b[j-1] ? 0 : 1;
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost);
    if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) d[i][j] = Math.min(d[i][j], d[i-2][j-2]+1);
  }
  return d[m][n];
}
/* Telefonnumre lagres som +47XXXXXXXX. For søk lages en felles nøkkel, slik at
   «+47 000 11 201», «00011201» og «004700011201» blir det samme:
   norske nummer → 8 siffer, utenlandske → landskode + nummer. */
function phoneKey(raw){
  const s = (raw || '').trim(); let d = digits(s);
  let intl = s.startsWith('+');
  if (!intl && d.startsWith('00') && (d.length > 8 || d.startsWith('0047'))){ d = d.slice(2); intl = true; }
  if (intl) return d.startsWith('47') ? d.slice(2) : d;
  if (d.length === 10 && d.startsWith('47')) return d.slice(2);
  return d;
}
function currentPhoneOwners(){
  const m = new Map();
  for (const v of db.vessels) for (const f of ['bridgePhone','altPhone']) if (v[f]) m.set(phoneKey(v[f]), v.id);
  return m;
}
/* Et gammelt nummer som nå brukes av et annet fartøy, regnes alltid som tatt i bruk av andre. */
function histStatus(h, owners){
  owners = owners || currentPhoneOwners();
  const owner = owners.get(phoneKey(h.number));
  if (owner && owner !== h.vesselId) return 'reassigned';
  return h.status;
}
function searchLocal(raw, extraHistory, onlyIds){
  const histAll = extraHistory && extraHistory.length ? [...db.numberHistory.filter(h => !extraHistory.some(x => x.id === h.id)), ...extraHistory] : db.numberHistory;
  const q = norm(raw).trim().replace(/^(ms|mv|m\/s|fv)\s+/, '');
  const qc = compact(q);
  if (!qc) return { results:[], fuzzy:false, phoneQuery:null };
  const qk = phoneKey(raw);
  const isPhoneQuery = /^[\d\s+()-]+$/.test(raw.trim()) && qk.length >= 4;
  const owners = isPhoneQuery ? currentPhoneOwners() : null;
  const out = [];
  for (const v of db.vessels){
    if (onlyIds && !onlyIds.has(v.id)) continue;
    const c = api.company(v.companyId);
    let best = null;
    const consider = (score, field, extra) => { if (!best || score > best.score) best = { score, field, fuzzy:false, ...extra }; };
    if (isPhoneQuery){
      // 1) Nåværende numre (alltid først)
      for (const f of ['bridgePhone','altPhone']){
        const k = phoneKey(v[f]); if (!k) continue;
        if (k === qk) consider(200, 'phone', { phoneField:f, exact:true });
        else if (k.includes(qk)) consider(120, 'phone', { phoneField:f });
      }
      // 2) Tidligere numre — hele nummeret, eller minst 6 siffer
      for (const h of histAll){
        if (h.vesselId !== v.id || h.status === 'rejected' || !h.number) continue;
        const k = phoneKey(h.number);
        const exact = k === qk;
        if (!exact && !(qk.length >= 6 && k.includes(qk))) continue;
        const st = histStatus(h, owners);
        const score = (st === 'confirmed' ? 90 : st === 'unconfirmed' ? 70 : 40) + (exact ? 10 : 0);
        consider(score, 'history', { hist:h, histStatus:st, exact });
      }
    }
    const fields = [['name', v.name, 100], ['callsign', v.callsign, 96], ['regNr', v.regNr, 96], ['company', c.id === 'privat' ? '' : c.name, 80], ['port', v.homePort, 40]];
    for (const [f, val, w] of fields){
      const vc = compact(val);
      if (vc.startsWith(qc)) consider(w, f);
      else if (norm(val).split(/[^a-z0-9]+/).some(t => t && t.startsWith(qc))) consider(w - 8, f);
      else if (qc.length >= 3 && vc.includes(qc)) consider(w - 25, f);
    }
    if (!best && qc.length >= 3 && !/^\d+$/.test(qc)){
      const max = qc.length <= 4 ? 1 : 2;
      for (const [f, val, w] of [['name', v.name, 60], ['company', c.name, 45]]){
        const toks = [compact(val), ...norm(val).split(/[^a-z0-9]+/).filter(t => t.length > 2)];
        for (const t of toks){
          let dist = Infinity;
          for (const L of [qc.length-1, qc.length, qc.length+1]) if (L > 0 && L <= t.length) dist = Math.min(dist, osa(qc, t.slice(0, L)));
          if (dist <= max) consider(w - dist*8, f, { fuzzy:true });
        }
      }
    }
    if (best) out.push({ v, c, ...best });
  }
  out.sort((a,b) => b.score - a.score || a.v.name.localeCompare(b.v.name, 'nb'));
  const fuzzy = out.length > 0 && out.every(r => r.fuzzy);
  return { results: out, fuzzy, phoneQuery: isPhoneQuery ? raw.trim() : null };
}

/* =====================================================================
   HJELPERE
   ===================================================================== */
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const DAY = 86400000;
function daysSince(iso){ if (!iso) return Infinity; return Math.floor((Date.now() - new Date(iso.slice(0,10)+'T12:00').getTime()) / DAY); }
function fmtDate(iso, short){
  if (!iso) return '';
  const d = new Date(iso.slice(0,10)+'T12:00');
  try { return d.toLocaleDateString('nb-NO', short ? { day:'numeric', month:'short', year:'numeric' } : { day:'numeric', month:'long', year:'numeric' }); }
  catch(e){ return iso.slice(0,10); }
}
function fmtTime(iso){ return iso && iso.length > 10 ? ` kl. ${iso.slice(11,16)}` : ''; }
function normPhone(s){
  let t = (s||'').trim(); if (!t) return '';
  t = t.replace(/[\s().-]/g, '');
  if (t.startsWith('00') && t.length > 8) t = '+' + t.slice(2);
  if (/^47\d{8}$/.test(t)) t = '+' + t;
  if (/^\d{8}$/.test(t)) t = '+47' + t;
  return t;
}
const validPhone = t => /^\+\d{8,15}$/.test(t);
const validEmail = t => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
function fmtPhone(t){
  if (!t) return '';
  if (t.startsWith('+47') && t.length === 11){ const d = t.slice(3); return `+47 ${d.slice(0,3)} ${d.slice(3,5)} ${d.slice(5)}`; }
  const m = t.match(/^(\+\d{3})(\d+)$/);
  return m ? m[1] + ' ' + m[2].replace(/(\d{3})(?=\d)/g, '$1 ') : t;
}
const fmtOrg = o => (o||'').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
const FIELD_LABEL = { bridgePhone:'Telefon til broen', altPhone:'Alternativt nummer', email:'E-post til fartøyet', history:'Tidligere nummer', report:'Innmeldt feil' };
const fmtValue = (field, val) => !val ? '(tomt)' : (field === 'email' || field === 'history' || field === 'report') ? val : fmtPhone(val);

const ICON = {
  phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  dash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  search: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  ok: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>',
  bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  pencil: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>'
};

function statusOf(v){ return vesselVerification(v).state; }
function statusPill(v){
  const vv = vesselVerification(v);
  if (vv.state === 'verified') return `<span class="pill pill-ok" title="Sist bekreftet ${esc(fmtDate(vv.at))}">${ICON.check}Bekreftet av rederiet</span>`;
  if (vv.state === 'stale') return `<span class="pill pill-warn" title="Sist bekreftet ${esc(fmtDate(vv.at))}">${ICON.clock}Bør bekreftes på nytt</span>`;
  if (vv.state === 'partial') return `<span class="pill pill-neutral">${ICON.dash}Delvis bekreftet</span>`;
  if (vv.state === 'unverified') return `<span class="pill pill-neutral">${ICON.dash}Ikke bekreftet</span>`;
  return `<span class="pill pill-neutral">${ICON.dash}Rederiet har ikke lagt inn kontaktinfo</span>`;
}
/* Offentlig merke på fartøysiden. Viser aldri hvem som bekreftet. */
function verifyBadge(vv){
  const d = vv.at ? fmtDate(vv.at) : '';
  const m = verifyMonths();
  const cfg = {
    verified:   { cls:'vb-ok',      icon:ICON.check, label:'Bekreftet av rederiet',        text:'Kontaktinformasjonen er bekreftet av en godkjent representant for rederiet.' },
    stale:      { cls:'vb-warn',    icon:ICON.clock, label:'Bør bekreftes på nytt',        text:`Rederiet bekreftet kontaktinformasjonen for over ${m} måneder siden. Den kan fortsatt stemme, men er ikke sjekket nylig.` },
    partial:    { cls:'vb-neutral', icon:ICON.dash,  label:'Delvis bekreftet av rederiet', text:'Noe av kontaktinformasjonen er bekreftet av en godkjent representant for rederiet. Se merkingen ved hvert nummer.' },
    unverified: { cls:'vb-neutral', icon:ICON.dash,  label:'Ikke bekreftet',               text:'Rederiet har ikke bekreftet denne kontaktinformasjonen.' }
  }[vv.state];
  if (!cfg) return '';
  return `<div class="vbadge-wrap">
    <button type="button" class="vbadge ${cfg.cls}" aria-expanded="false" aria-controls="vb-exp" title="${esc(cfg.text)}${d ? ' Sist bekreftet ' + esc(d) + '.' : ''}" data-vbadge>${cfg.icon}${cfg.label}</button>
    ${d ? `<span class="vdate">Sist bekreftet ${esc(d)}</span>` : ''}
    <div class="vexplain" id="vb-exp" hidden>
      <p>${esc(cfg.text)}</p>${d ? `<p>Sist bekreftet ${esc(d)}.</p>` : ''}
      <p class="hint">Fartøykontakt har ikke selv ringt nummeret for å teste det. ${REMOTE ? '' : '<span class="demo-tag">Demo</span> Bekreftelsene i prototypen er oppdiktet.'}</p>
    </div>
  </div>`;
}
/* Siste bekreftede nummerbytte for et fartøy */
function lastSwitch(v){
  return db.numberHistory.filter(h => h.vesselId === v.id && h.replacedAt && (h.status === 'confirmed' || h.status === 'reassigned'))
    .sort((a,b) => b.replacedAt.localeCompare(a.replacedAt))[0] || null;
}
function newNumberPill(v){
  const h = lastSwitch(v);
  if (h && daysSince(h.replacedAt) <= 60) return `<span class="pill pill-new">Nytt nummer fra ${esc(fmtDate(h.replacedAt, true))}</span>`;
  return '';
}

/* Toast */
let toastTimer;
function toast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }

/* Kopiering — med reserveløsning */
function copyText(text, label){
  const done = ok => toast(ok ? `${label} er kopiert` : 'Kunne ikke kopiere. Marker teksten og kopier den selv.');
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch(e){} ta.remove(); done(ok);
  };
  try { navigator.clipboard.writeText(text).then(() => done(true), fallback); } catch(e){ fallback(); }
}

/* =====================================================================
   RUTER
   ===================================================================== */
const app = document.getElementById('app');
const state = { query:'', searchToken:0, lastRoute:null };

function route(){
  const h = location.hash.replace(/^#/, '') || 'sok';
  document.body.classList.remove('has-callbar');
  document.querySelector('.callbar')?.remove();
  renderNav();
  let m;
  if (h === 'sok') return viewHome();
  // Fartøy som ikke er lagret på enheten (delt lenke, bokmerke): hent det fra databasen først
  if (REMOTE && (m = h.match(/^(?:fartoy|meld-feil|rediger)-([a-z0-9-]+)$/)) && !api.getVessel(m[1])) return routeWhenLoaded(m[1], location.hash);
  if ((m = h.match(/^fartoy-([a-z0-9-]+)$/))) return viewVessel(m[1]);
  if ((m = h.match(/^meld-feil-([a-z0-9-]+)$/))) return viewReport(m[1]);
  if (REMOTE && (m = h.match(/^be-om-tilgang-([a-z0-9-]+)$/))) return api.getVessel(m[1]) ? startClaim(m[1]) : routeWhenLoaded(m[1], location.hash);
  if (h === 'logg-inn') return viewLogin();
  if (h === 'registrer-rederi') return viewRegister();
  if (h === 'mine-fartoy') return viewDashboard();
  if (h === 'innmeldte-feil') return viewDashboard({ focusReports:true });
  if (h === 'importer' || h === 'fartoyregister') return viewRegistry();
  if ((m = h.match(/^rediger-([a-z0-9-]+)$/))) return viewEdit(m[1]);
  return viewNotFound();
}
function go(hash){ if (location.hash === '#'+hash) route(); else location.hash = hash; }
function focusTitle(){ const t = document.getElementById('page-title'); if (t) t.focus({ preventScroll:true }); }
window.addEventListener('hashchange', () => { route(); window.scrollTo(0,0); focusTitle(); });

function renderNav(){
  const u = auth.current();
  const n = u ? api.openReportCount(u) : 0;
  document.getElementById('nav').innerHTML = u
    ? `${n ? `<a class="nav-badge" href="#innmeldte-feil" aria-label="${n === 1 ? '1 innmeldt feil' : n + ' innmeldte feil'}">${ICON.bell}<span>${n}</span></a>` : ''}
       <a class="btn btn-secondary btn-sm" href="#mine-fartoy">${u.role === 'platform' ? 'Innmeldte feil' : 'Mine fartøy'}</a>`
    : `<a class="btn btn-secondary btn-sm" href="#logg-inn">Logg inn</a>`;
}

/* =====================================================================
   FORSIDE + SØK
   ===================================================================== */
function viewHome(){
  app.innerHTML = `
    <section class="hero ${state.query ? 'is-compact' : ''}" id="hero">
      <h1 id="page-title" tabindex="-1">Hvem skal du <em class="accent">kontakte</em>?</h1>
      <p class="lede">Finn oppdatert kontaktinformasjon til norske fiskefartøy.</p>
      <form class="search" role="search" id="search-form" autocomplete="off">
        <label for="q" class="sr-only">Søk etter fartøy, rederi eller kallesignal</label>
        <div class="search-box">
          ${ICON.search}
          <input id="q" name="q" type="search" inputmode="search" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="Søk etter fartøy, rederi eller kallesignal..." value="${esc(state.query)}" aria-controls="results" aria-describedby="search-hint">
          <button type="button" class="clear" id="clear" aria-label="Tøm søkefeltet" ${state.query ? '' : 'hidden'}>${ICON.x}</button>
        </div>
      </form>
      <p class="search-hint" id="search-hint">Du kan også søke på registreringsnummer eller et gammelt telefonnummer.</p>
    </section>
    <section class="results" id="results" aria-live="polite"></section>`;
  const input = document.getElementById('q');
  const clear = document.getElementById('clear');
  const hero = document.getElementById('hero');
  let t;
  input.addEventListener('input', () => {
    state.query = input.value;
    clear.hidden = !input.value;
    hero.classList.toggle('is-compact', !!input.value.trim());
    clearTimeout(t); t = setTimeout(() => runSearch(input.value), 90);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown'){ const first = document.querySelector('#results .result-name a'); if (first){ e.preventDefault(); first.focus(); } }
    if (e.key === 'Escape' && input.value){ input.value = ''; input.dispatchEvent(new Event('input')); }
  });
  document.getElementById('search-form').addEventListener('submit', e => {
    e.preventDefault();
    const first = document.querySelector('#results .result-name a');
    if (first && document.querySelectorAll('#results .result').length === 1) first.click();
    else input.blur();
  });
  clear.addEventListener('click', () => { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); });
  if (!isTouch && state.lastRoute !== 'home') input.focus();
  state.lastRoute = 'home';
  runSearch(state.query, true);
}

/* Eksempler under søkefeltet: faste i demoen, ekte fartøy (som skifter hver dag) med Supabase */
function exampleChips(){
  let items;
  if (!REMOTE) items = [['Frøyanes'], ['Bergholm'], ['LNSB'], ['+47 000 98 401', '(gammelt nummer)']];
  else {
    const pool = cache.exampleIds.map(id => api.getVessel(id)).filter(Boolean);
    if (pool.length < 3) return '';
    items = [[pool[0].name], [pool[1].name], [pool[2].callsign, '(kallesignal)']];
  }
  return `<div class="examples"><span>Prøv:</span>
    ${items.map(([q, note]) => `<button class="chip" type="button" data-try="${esc(q)}">${esc(q)}${note ? ` <span class="chip-note">${esc(note)}</span>` : ''}</button>`).join('')}
  </div>`;
}
function renderIntro(){
  const recent = (REMOTE ? cache.recentIds.map(id => api.getVessel(id)).filter(Boolean) : db.vessels).map(v => ({ v, h: lastSwitch(v) })).filter(x => x.h && daysSince(x.h.replacedAt) <= 60)
    .sort((a,b) => b.h.replacedAt.localeCompare(a.h.replacedAt)).map(x => x.v);
  return `<div class="intro">
    ${exampleChips()}
    ${recent.length ? `<div><h2 class="section-title">Har byttet nummer nylig</h2><ul class="list">${recent.map(v => resultRow({ v, c: api.company(v.companyId), field:'name' })).join('')}</ul></div>` : ''}
  </div>`;
}
function skeleton(){ return `<div class="list" aria-label="Søker …">${[0,1,2].map(() => `<div class="skel"><i style="width:40%"></i><i style="width:65%"></i></div>`).join('')}</div>`; }
function prettyQueryNumber(q){ const n = normPhone(q); return validPhone(n) ? fmtPhone(n) : q.trim(); }

async function runSearch(q, immediate){
  const box = document.getElementById('results'); if (!box) return;
  const token = ++state.searchToken;
  if (!q.trim()){ box.innerHTML = renderIntro(); state.histHits = {}; return; }
  if (!immediate) box.innerHTML = skeleton();
  const { results, fuzzy, phoneQuery } = await api.search(q);
  if (token !== state.searchToken || !document.getElementById('results')) return;
  state.histHits = {};
  results.forEach(r => { if (r.field === 'history') state.histHits[r.v.id] = { number: r.hist.number, status: r.histStatus }; });
  if (!results.length){
    box.innerHTML = phoneQuery ? `<div class="empty">
      <h2>Fant ingen fartøy med nummeret <span class="num">${esc(prettyQueryNumber(q))}</span></h2>
      <p>Nummeret kan være et privat nummer, eller rederiet har ikke registrert det her.</p>
      <p>Prøv å søke på navnet til fartøyet eller rederiet i stedet.</p>
    </div>` : `<div class="empty">
      <h2>Fant ingen fartøy for «${esc(q.trim())}»</h2>
      <p>Sjekk stavemåten, eller søk på kallesignal (for eksempel LKFR) eller registreringsnummer (for eksempel M-111-HØ).</p>
      <p>Finner du fortsatt ikke fartøyet, kan det hende rederiet ikke har registrert seg ennå. Ring rederiet direkte.</p>
    </div>`;
    return;
  }
  const shown = results.slice(0, 20);
  const head = phoneQuery ? `Treff på nummeret <span class="num">${esc(prettyQueryNumber(q))}</span>` : (results.length === 1 ? '1 fartøy' : results.length + ' fartøy');
  box.innerHTML = `
    ${fuzzy ? `<p class="fuzzy-note">Ingen fartøy heter akkurat «${esc(q.trim())}». Mente du <button class="linkbtn" type="button" data-try="${esc(shown[0].v.name)}">${esc(shown[0].v.name)}</button>?</p>` : ''}
    <div class="results-head"><span>${head}</span></div>
    <ul class="list">${shown.map(resultRow).join('')}</ul>`;
}

/* Ring er hovedvalget, Kopier er sekundært. tel:-lenken bruker alltid internasjonalt format (+47…),
   mens skjermen viser lesbart norsk format. */
function telHref(n){ return 'tel:' + normPhone(n); }
function callButtons(number, who, opts = {}){
  const f = fmtPhone(normPhone(number));
  const label = opts.label || 'Ring';
  return `<a class="btn ${opts.primary === false ? 'btn-secondary' : 'btn-primary'} ${opts.size || ''}" href="${esc(telHref(number))}" aria-label="${esc(label)}: ${esc(who)}, ${esc(f)}">${ICON.phone}${esc(label)}</a>
    <button type="button" class="btn btn-secondary ${opts.size || ''} ${opts.compact ? 'copy-compact' : ''}" data-copy="${esc(f)}" data-label="Nummeret" aria-label="Kopier nummeret ${esc(f)}">${ICON.copy}<span class="lbl">Kopier</span></button>`;
}

function resultHead(v, c, extra){
  return `<div class="result-main">
      <h3 class="result-name"><a href="#fartoy-${esc(v.id)}">${esc(v.name)}</a></h3>
      <p class="result-meta">${esc(c.name)} · <span class="num">${esc(v.regNr)}</span>${v.homePort ? ` · ${esc(v.homePort)}` : ''}</p>
      <div class="badges">${statusPill(v)}${newNumberPill(v)}${v.demo ? '<span class="pill pill-neutral">Demofartøy</span>' : ''}</div>
      ${extra || ''}
    </div>`;
}

function resultRow(r){
  const { v, c, field } = r;
  if (field === 'history') return historyRow(r);
  let match = '';
  if (field === 'callsign') match = `Kallesignal <mark>${esc(v.callsign)}</mark>`;
  else if (field === 'regNr') match = `Registreringsnummer <mark>${esc(v.regNr)}</mark>`;
  else if (field === 'port') match = `Hjemmehavn <mark>${esc(v.homePort)}</mark>`;
  else if (field === 'phone') match = r.phoneField === 'altPhone'
    ? `Treff på alternativt nummer <mark class="num">${esc(fmtPhone(v.altPhone))}</mark>`
    : `Treff på nåværende nummer`;
  const phone = v.bridgePhone;
  const call = phone
    ? `<div class="call-num"><span class="label">Telefon til broen</span><a class="phone" href="${esc(telHref(phone))}" tabindex="-1">${esc(fmtPhone(phone))}</a></div>
       <div class="call-btns">${callButtons(phone, v.name, { compact:true })}</div>`
    : `<span class="nophone">Telefon ikke oppgitt</span>`;
  return `<li class="result">
    ${resultHead(v, c, match ? `<p class="match">${match}</p>` : '')}
    <div class="result-call">${call}</div>
  </li>`;
}

/* Treff på et tidligere nummer: forklar hvorfor fartøyet vises, og fremhev det nye nummeret.
   Bare bekreftede og ferske koblinger får «Ring nytt nummer» som hovedknapp. */
function historyRow(r){
  const { v, c, hist, histStatus: st } = r;
  const cur = v.bridgePhone;
  const stale = st === 'confirmed' && daysSince(hist.verifiedAt) > 365;
  const sure = st === 'confirmed' && !stale;
  let why, warn = '';
  if (st === 'reassigned'){
    why = `Nummeret du søkte på ble tidligere brukt av ${v.name}.`;
    warn = `Nummeret er nå tatt i bruk av noen andre. Ringer du det, kommer du ikke til ${v.name}.`;
  } else {
    why = 'Du søkte på et tidligere telefonnummer til dette fartøyet.';
    if (st === 'unconfirmed') warn = `Det er ikke bekreftet at nummeret tilhørte ${v.name} (kilde: ${hist.source.toLowerCase()}). Sjekk at det er riktig fartøy før du ringer.`;
    else if (stale) warn = `Opplysningen om det gamle nummeret ble sist bekreftet ${fmtDate(hist.verifiedAt)}, for over ett år siden. Sjekk at det er riktig fartøy.`;
  }
  return `<li class="result result-hist">
    ${resultHead(v, c)}
    <div class="hist">
      <p class="hist-why">${esc(why)}</p>
      <dl class="hist-nums">
        <dt>Tidligere nummer</dt>
        <dd><s class="num">${esc(fmtPhone(hist.number))}</s>${hist.replacedAt ? ` <span class="hint">· byttet ${esc(fmtDate(hist.replacedAt, true))}</span>` : ''}</dd>
        <dt>${st === 'reassigned' ? `Nummeret til ${esc(v.name)} nå` : 'Nåværende nummer'}</dt>
        <dd class="hist-now">${cur ? `<a class="num" href="${esc(telHref(cur))}" tabindex="-1">${esc(fmtPhone(cur))}</a>` : '<span class="nophone">Ikke oppgitt</span>'}</dd>
      </dl>
      ${warn ? `<div class="notice notice-warn">${ICON.warn}<p>${esc(warn)}</p></div>` : ''}
      ${cur ? `<div class="hist-actions">${callButtons(cur, v.name, { label: sure ? 'Ring nytt nummer' : `Ring ${v.name}`, primary: sure })}</div>`
        : c.phone ? `<div class="hist-actions">${callButtons(c.phone, c.name, { label:'Ring rederiet', primary:false })}</div>` : ''}
    </div>
  </li>`;
}

/* Piltaster mellom treff */
document.addEventListener('keydown', e => {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest('#results .result-name')) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const links = [...document.querySelectorAll('#results .result-name a')];
  const i = links.indexOf(a);
  e.preventDefault();
  if (e.key === 'ArrowDown' && links[i+1]) links[i+1].focus();
  if (e.key === 'ArrowUp') (links[i-1] || document.getElementById('q')).focus();
});

/* =====================================================================
   FARTØYPROFIL
   ===================================================================== */
function backToSearch(){ return `<a class="back" href="#sok">${ICON.back}${state.query ? 'Tilbake til søket' : 'Til søket'}</a>`; }

/* «Er du fra rederiet?» — fører til innlogging og søknad om tilgang, med fartøyet fylt inn.
   Tilgang gis aldri automatisk; en plattformadministrator må godkjenne. */
const CLAIM_KEY = 'fartoykontakt-krav';
function claimLink(v){
  const u = auth.current();
  if (u && canManage(u, v)) return `<p class="hint" style="margin-top:10px"><a href="#rediger-${esc(v.id)}">Legg inn kontaktinformasjon</a></p>`;
  if (!REMOTE) return `<p class="hint" style="margin-top:10px">Er du fra rederiet? <a href="#logg-inn">Logg inn og legg inn kontaktinformasjon</a>.</p>`;
  if (u && u.role !== 'none') return '';
  return `<p class="hint" style="margin-top:10px">Er du fra rederiet? <a href="#be-om-tilgang-${esc(v.id)}">Be om tilgang til fartøyet</a></p>`;
}
function startClaim(id){
  const v = api.getVessel(id); if (!v) return viewNotFound();
  const c = api.company(v.companyId);
  const claim = { vesselId: v.id, vesselName: v.name, orgnr: c && c.id !== 'privat' ? c.orgnr : '' };
  state.claim = claim;
  try { localStorage.setItem(CLAIM_KEY, JSON.stringify(claim)); } catch(e){}
  const u = auth.current();
  if (!u) return viewLoginRemote(true);
  if (u.role === 'none') return viewNoAccess(u);
  go('mine-fartoy');
}
function currentClaim(){
  if (state.claim) return state.claim;
  try { return JSON.parse(localStorage.getItem(CLAIM_KEY) || 'null'); } catch(e){ return null; }
}

function viewVessel(id){
  state.lastRoute = 'vessel';
  const v = api.getVessel(id); if (!v) return viewNotFound();
  if (REMOTE && state.fetched !== id) refreshVesselInBackground(id);
  const c = api.company(v.companyId);
  const vv = vesselVerification(v);
  // Merking per felt vises bare når ikke alt er bekreftet
  const tagFor = k => vv.state === 'verified' ? '' : fieldTag(vv.fields.find(f => f.key === k));
  // Vis gammelt nummer bare når rederiet har valgt det, koblingen er bekreftet og byttet er nylig.
  const owners = currentPhoneOwners();
  const shownPrev = db.numberHistory.filter(h => h.vesselId === v.id && h.showOnProfile && h.replacedAt
      && histStatus(h, owners) === 'confirmed' && daysSince(h.replacedAt) <= 183)
    .sort((a,b) => b.replacedAt.localeCompare(a.replacedAt))[0];
  const cameFrom = state.histHits && state.histHits[v.id] && state.query ? state.histHits[v.id] : null;

  const contactRows = [];
  if (v.altPhone) contactRows.push(`<div class="row"><div class="row-main"><div class="k">Alternativt nummer ${tagFor('altPhone')}</div><a class="v num phone-link" href="${esc(telHref(v.altPhone))}" tabindex="-1">${esc(fmtPhone(v.altPhone))}</a></div>
    <div class="row-actions">${callButtons(v.altPhone, v.name + ', alternativt nummer', { size:'btn-sm', primary:false })}</div></div>`);
  if (v.email) contactRows.push(`<div class="row"><div class="row-main"><div class="k">E-post til fartøyet ${tagFor('email')}</div><div class="v">${esc(v.email)}</div></div>
    <div class="row-actions"><a class="btn btn-ghost btn-sm" href="mailto:${esc(v.email)}">${ICON.mail}Skriv</a><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(v.email)}" data-label="E-postadressen">${ICON.copy}Kopier</button></div></div>`);

  app.innerHTML = `
    ${backToSearch()}
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">${esc(v.name)}</h1>
      <p class="sub">${esc([c.name, v.type].filter(Boolean).join(' · '))}</p>
      <div class="badges">${vv.state === 'unclaimed' ? statusPill(v) : ''}${newNumberPill(v)}</div>
    </header>

    ${cameFrom ? (cameFrom.status === 'confirmed'
      ? `<div class="notice notice-info" style="margin-bottom:14px">${ICON.info}<p>Du søkte på <s class="num">${esc(fmtPhone(cameFrom.number))}</s>. Det er et tidligere nummer til ${esc(v.name)}. Bruk nummeret under.</p></div>`
      : `<div class="notice notice-warn" style="margin-bottom:14px">${ICON.warn}<p>Du søkte på <span class="num">${esc(fmtPhone(cameFrom.number))}</span>. ${cameFrom.status === 'reassigned' ? `Det nummeret er nå tatt i bruk av noen andre, ikke ${esc(v.name)}.` : `Det er ikke bekreftet at nummeret tilhørte ${esc(v.name)}.`}</p></div>`) : ''}

    ${v.bridgePhone ? `
    <section class="card call-card" aria-labelledby="call-h">
      ${verifyBadge(vv)}
      <h2 class="call-label" id="call-h">Telefon til broen ${tagFor('bridgePhone')}</h2>
      <a class="call-number" href="${esc(telHref(v.bridgePhone))}" tabindex="-1">${esc(fmtPhone(v.bridgePhone))}</a>
      <div class="call-actions">${callButtons(v.bridgePhone, v.name, { label:'Ring broen' })}</div>
      ${shownPrev ? `<p class="prev-note">Fartøyet byttet nummer ${esc(fmtDate(shownPrev.replacedAt))}. Det gamle nummeret <s class="num">${esc(fmtPhone(shownPrev.number))}</s> er ikke lenger i bruk.</p>` : ''}
      ${contactRows.length ? `<div class="rows" style="margin-top:12px">${contactRows.join('')}</div>` : ''}
    </section>` : contactRows.length ? `
    <section class="card" aria-labelledby="contact-h">
      ${verifyBadge(vv)}
      <h2 id="contact-h">Kontakt fartøyet</h2>
      <p class="hint" style="margin-top:6px">Telefon til broen er ikke oppgitt.</p>
      <div class="rows" style="margin-top:12px">${contactRows.join('')}</div>
    </section>` : `
    <section class="card no-contact">
      <h2>Kontaktinformasjon er ikke registrert ennå.</h2>
      <p class="hint" style="margin-top:6px">${c.phone ? 'Prøv å ringe rederiet.' : 'Vi viser bare opplysninger fra fartøyregisteret.'}</p>
      ${claimLink(v)}
    </section>`}
    ${c.id === 'privat' ? `<section class="card">
      <h2>Eier</h2>
      <p class="hint" style="margin-top:6px">Fartøyet eies av en privatperson. Vi viser ikke navn på private eiere.</p>
    </section>` : `<section class="card">
      <h2>Rederiet</h2>
      ${c.status ? `<div class="notice notice-warn" style="margin-top:10px">${ICON.warn}<p>Enhetsregisteret: ${esc(c.status)}</p></div>` : ''}
      <div class="rows" style="margin-top:8px">
        <div class="row"><div class="row-main"><div class="k">Navn</div><div class="v">${esc(c.name)}</div></div></div>
        ${c.phone ? `<div class="row"><div class="row-main"><div class="k">Telefon ${tagFor('co.phone')}</div><a class="v num phone-link" href="${esc(telHref(c.phone))}" tabindex="-1">${esc(fmtPhone(c.phone))}</a></div>
          <div class="row-actions">${callButtons(c.phone, c.name, { size:'btn-sm', primary:false })}</div></div>` : ''}
        ${c.email ? `<div class="row"><div class="row-main"><div class="k">E-post ${tagFor('co.email')}</div><div class="v">${esc(c.email)}</div></div>
          <div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(c.email)}" data-label="E-postadressen">${ICON.copy}Kopier</button></div></div>` : ''}
        <div class="row"><div class="row-main"><div class="k">Organisasjonsnummer</div><div class="v num">${esc(fmtOrg(c.orgnr))}</div></div></div>
      </div>
    </section>`}

    <section class="card">
      <h2>Om fartøyet</h2>
      <dl class="facts">
        ${[['Registreringsmerke', v.regNr], ['Kallesignal', v.callsign], ['Type', v.type], ['Lengde', v.length], ['Byggeår', v.buildYear], ['IMO-nummer', v.imo], [v.demo ? 'Hjemmehavn' : 'Kommune', v.homePort]]
          .filter(([, val]) => val).map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('')}
      </dl>
      ${v.missing ? `<div class="notice notice-warn" style="margin-top:10px">${ICON.warn}<p>Fartøyet finnes ikke lenger i Fiskeridirektoratets fartøyregister. Opplysningene kan være utdaterte.</p></div>` : ''}
      <p class="source">${v.demo || !REMOTE ? 'Demofartøy med oppdiktede opplysninger.'
        : v.source === 'fiskeridir' ? 'Kilde for fartøyopplysninger: Fiskeridirektoratet (<a href="https://data.norge.no/nlod/no/2.0" target="_blank" rel="noopener">NLOD</a>).' + (v.bridgePhone || v.altPhone || v.email ? ' Kontaktinformasjonen er lagt inn av rederiet.' : '')
        : 'Fra fartøyregisteret.'}</p>
    </section>

    <section class="card report-cta">
      <p>Er noe feil eller utdatert?</p>
      <a class="btn btn-secondary" href="#meld-feil-${esc(v.id)}">Meld fra om feil</a>
    </section>`;

  if (isTouch && v.bridgePhone){
    const bar = document.createElement('div');
    bar.className = 'callbar';
    bar.innerHTML = `<a class="btn btn-primary" href="tel:${esc(v.bridgePhone)}">${ICON.phone}Ring broen · <span class="num">${esc(fmtPhone(v.bridgePhone))}</span></a>`;
    document.body.appendChild(bar);
    document.body.classList.add('has-callbar');
  }
}

/* =====================================================================
   MELD FRA OM FEIL (offentlig — endrer aldri data direkte)
   ===================================================================== */
function viewReport(id){
  state.lastRoute = 'report';
  const v = api.getVessel(id); if (!v) return viewNotFound();
  const reasons = [
    ['Telefonnummeret virker ikke', 'Ingen svarer, eller du får beskjed om at nummeret ikke er i bruk.', 'bridgePhone'],
    ['Fartøyet har fått nytt nummer', 'Skriv gjerne det nye nummeret under.', 'bridgePhone'],
    ['Feil e-postadresse', '', 'email'],
    ['Noe annet er feil', '', '']
  ];
  app.innerHTML = `
    <a class="back" href="#fartoy-${esc(v.id)}">${ICON.back}Tilbake til ${esc(v.name)}</a>
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">Meld fra om feil</h1>
      <p class="sub">${esc(v.name)} · ${esc(api.company(v.companyId).name)}</p>
    </header>
    <form id="report-form" class="card stack" novalidate>
      <fieldset>
        <legend class="legend">Hva er feil?</legend>
        <div class="choices">
          ${reasons.map(([r, sub, f], i) => `<label class="choice"><input type="radio" name="reason" id="reason-${i}" value="${esc(r)}" data-field="${f}"><span>${esc(r)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`).join('')}
        </div>
        <p class="err" id="reason-err" hidden>${ICON.warn}Velg hva som er feil.</p>
      </fieldset>
      <div class="field" id="suggest-field" hidden>
        <label for="suggested" id="suggest-label">Riktig nummer, hvis du vet det <span class="hint">(valgfritt)</span></label>
        <input class="input" id="suggested" type="tel" inputmode="tel" autocomplete="off" maxlength="40">
        <p class="err" id="suggest-err" hidden></p>
      </div>
      <div class="field">
        <label for="details">Noe mer rederiet bør vite? <span class="hint">(valgfritt)</span></label>
        <textarea class="input" id="details" maxlength="500"></textarea>
      </div>
      <div class="field">
        <label for="contact">Din e-post eller telefon <span class="hint">(valgfritt)</span></label>
        <input class="input" id="contact" type="text" autocomplete="email" maxlength="120">
        <p class="hint">Bare hvis rederiet kan kontakte deg om meldingen.</p>
      </div>
      <div class="notice notice-info">${ICON.info}<p>Meldingen går til rederiet. Den endrer ikke kontaktinformasjonen. Bare rederiet kan endre den.</p></div>
      <p class="err" id="report-err" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit" id="report-submit">Send melding</button></div>
    </form>`;
  const sField = document.getElementById('suggest-field'), sInput = document.getElementById('suggested'), sErr = document.getElementById('suggest-err');
  const curField = () => { const r = document.querySelector('input[name="reason"]:checked'); return r ? r.dataset.field : ''; };
  document.getElementById('report-form').addEventListener('change', e => {
    if (e.target.name !== 'reason') return;
    const f = curField();
    sField.hidden = !f;
    sInput.type = f === 'email' ? 'email' : 'tel';
    sInput.setAttribute('inputmode', f === 'email' ? 'email' : 'tel');
    document.getElementById('suggest-label').innerHTML = (f === 'email' ? 'Riktig e-postadresse' : 'Riktig nummer') + ', hvis du vet det <span class="hint">(valgfritt)</span>';
    sErr.hidden = true;
  });
  document.getElementById('report-form').addEventListener('submit', async e => {
    e.preventDefault();
    const reason = document.querySelector('input[name="reason"]:checked');
    const rErr = document.getElementById('reason-err');
    rErr.hidden = !!reason;
    if (!reason){ document.getElementById('reason-0').focus(); return; }
    const field = curField();
    let suggested = '';
    if (field && sInput.value.trim()){
      suggested = field === 'email' ? sInput.value.trim() : normPhone(sInput.value);
      const okVal = field === 'email' ? validEmail(suggested) : validPhone(suggested);
      sErr.innerHTML = okVal ? '' : ICON.warn + (field === 'email' ? 'E-postadressen ser ikke riktig ut. Den skal se slik ut: navn@firma.no' : 'Nummeret ser ikke riktig ut. Skriv 8 siffer, eller landskode med + foran.');
      sErr.hidden = okVal; sInput.setAttribute('aria-invalid', okVal ? 'false' : 'true');
      if (!okVal){ sInput.focus(); return; }
    }
    const btn = document.getElementById('report-submit'); const err = document.getElementById('report-err');
    btn.disabled = true; btn.textContent = 'Sender …'; err.hidden = true;
    try {
      await api.report(v.id, { reason: reason.value, field, suggested, details: document.getElementById('details').value.trim(), contact: document.getElementById('contact').value.trim() });
      app.innerHTML = `
        <header class="page-head"><h1 id="page-title" tabindex="-1">Takk for at du sa fra</h1></header>
        <div class="card stack">
          <div class="notice notice-ok">${ICON.ok}<p>Rederiet bak ${esc(v.name)} har fått beskjed og sjekker opplysningene.</p></div>
          <p class="hint">Til det er sjekket, kan du prøve rederiets eget telefonnummer.</p>
          <div class="form-actions"><a class="btn btn-primary" href="#fartoy-${esc(v.id)}">Tilbake til ${esc(v.name)}</a><a class="btn btn-secondary" href="#sok">Nytt søk</a></div>
        </div>`;
      focusTitle();
    } catch(ex){
      btn.disabled = false; btn.textContent = 'Send melding';
      err.innerHTML = `${ICON.warn}${ex.code === 'offline' ? 'Meldingen ble ikke sendt fordi du er uten nett. Det du har skrevet er ikke borte. Prøv igjen når du har nett.' : 'Noe gikk galt, og meldingen ble ikke sendt. Prøv igjen.'}`;
      err.hidden = false;
    }
  });
}

/* =====================================================================
   INNLOGGING (simulert BankID)
   ===================================================================== */
function viewLogin(){
  if (REMOTE) return viewLoginRemote();
  state.lastRoute = 'login';
  if (auth.current()) return go('mine-fartoy');
  app.innerHTML = `
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">Logg inn for rederier</h1>
      <p class="sub">Her kan rederier oppdatere telefonnummer og e-post for egne fartøy. Du trenger ikke logge inn for å søke.</p>
    </header>
    <div class="card stack" id="login-box">
      <button type="button" class="btn btn-primary btn-block" id="bankid" style="min-height:56px;font-size:18px">Logg inn med BankID</button>
      <p class="hint"><span class="demo-tag">Demo</span> Ingen ekte BankID brukes. Du velger en demobruker i neste steg.</p>
      <div class="notice notice-info">${ICON.info}<p>BankID bekrefter hvem du er. At du kan representere rederiet, sjekker vi i tillegg.</p></div>
    </div>
    <p class="hint" style="margin-top:18px;text-align:center">Er ikke rederiet ditt registrert? <a href="#registrer-rederi">Registrer rederiet</a></p>`;
  document.getElementById('bankid').addEventListener('click', async () => {
    const box = document.getElementById('login-box');
    box.innerHTML = `<div style="text-align:center;padding:20px 0" role="status"><div class="spinner"></div><p style="margin-top:14px;font-weight:500">Venter på BankID …</p><p class="hint">Simulert innlogging</p></div>`;
    await auth.startBankId();
    box.innerHTML = `
      <p class="notice notice-ok" style="margin:0">${ICON.ok}<span><strong>Identitet bekreftet (simulert)</strong></span></p>
      <p style="font-weight:500">Velg hvem du vil logge inn som:</p>
      <button type="button" class="persona" data-user="kari"><span><strong>Kari Nordvik</strong><span>Frøyanes Rederi AS · Administrator</span></span>${ICON.back.replace('M15 18l-6-6 6-6','M9 18l6-6-6-6')}</button>
      <button type="button" class="persona" data-user="jonas"><span><strong>Jonas Vik</strong><span>Frøyanes Rederi AS · Medarbeider</span></span>${ICON.back.replace('M15 18l-6-6 6-6','M9 18l6-6-6-6')}</button>
      <button type="button" class="persona" data-user="ola"><span><strong>Ola Drift</strong><span>Fartøykontakt · Plattformadministrator</span></span>${ICON.back.replace('M15 18l-6-6 6-6','M9 18l6-6-6-6')}</button>
      <p class="hint">Administrator kan endre og godkjenne. Medarbeider kan foreslå endringer som en administrator må godkjenne. Plattformadministrator ser innmeldte feil for alle rederier.</p>`;
    box.querySelectorAll('[data-user]').forEach(b => b.addEventListener('click', () => {
      auth.signIn(b.dataset.user); toast(`Du er logget inn som ${db.users[b.dataset.user].name}`); go('mine-fartoy');
    }));
    box.querySelector('[data-user]').focus();
  });
}

/* =====================================================================
   REGISTRER REDERI (identitet → rederi → fullmakt → venter)
   ===================================================================== */
function viewRegister(){
  if (REMOTE) return auth.current() ? go('mine-fartoy') : viewLoginRemote(true);
  state.lastRoute = 'register';
  const st = { step:1, orgnr:'', company:null, basis:'' };
  const stepsBar = () => `<ol class="steps" aria-label="Steg">
    ${['Hvem du er','Rederiet','Din rolle'].map((t,i) => `<li class="${i+1 < st.step ? 'done' : i+1 === st.step ? 'now' : ''}" ${i+1 === st.step ? 'aria-current="step"' : ''}>${i+1}. ${t}</li>`).join('')}</ol>`;
  const draw = () => {
    let body = '';
    if (st.step === 1) body = `
      <h2>Bekreft hvem du er</h2>
      <p class="hint">Vi bruker BankID for å vite hvem som gjør endringer.</p>
      <button type="button" class="btn btn-primary btn-block" id="r-bankid">Bekreft med BankID</button>
      <p class="hint"><span class="demo-tag">Demo</span> Ingen ekte BankID brukes.</p>`;
    if (st.step === 2) body = `
      <h2>Hvilket rederi gjelder det?</h2>
      <div class="field"><label for="orgnr">Organisasjonsnummer</label>
        <input class="input" id="orgnr" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="9 siffer" value="${esc(st.orgnr)}">
        <p class="hint">Står i Brønnøysundregistrene og på fakturaer fra rederiet.</p>
        <p class="err" id="org-err" hidden></p></div>
      <div id="org-result"></div>
      <div class="form-actions"><button type="button" class="btn btn-primary" id="org-next">Finn rederiet</button></div>`;
    if (st.step === 3) body = `
      <h2>Kan du representere ${esc(st.company.name)}?</h2>
      <fieldset><legend class="sr-only">Din rolle i rederiet</legend><div class="choices">
        <label class="choice"><input type="radio" name="basis" value="signatur" id="basis-1"><span>Jeg er daglig leder eller har signaturrett<small>Vi sjekker dette mot Enhetsregisteret.</small></span></label>
        <label class="choice"><input type="radio" name="basis" value="fullmakt" id="basis-2"><span>Jeg har fullmakt fra rederiet<small>Daglig leder får en e-post og må godkjenne deg.</small></span></label>
      </div></fieldset>
      <p class="err" id="basis-err" hidden>${ICON.warn}Velg ett av alternativene.</p>
      <div class="form-actions"><button type="button" class="btn btn-primary" id="basis-send">Send søknad</button></div>`;
    if (st.step === 4) body = `
      <div class="notice notice-warn">${ICON.clock}<p><strong>Søknaden venter på godkjenning</strong>Vi sjekker at du kan representere ${esc(st.company.name)}. Du får svar på e-post, vanligvis innen én arbeidsdag.</p></div>
      <p class="hint">Når du er godkjent, ser du fartøyene til rederiet under «Mine fartøy».</p>
      <p class="hint"><span class="demo-tag">Demo</span> Søknaden lagres bare i denne nettleseren og blir ikke behandlet.</p>
      <div class="form-actions"><a class="btn btn-secondary" href="#logg-inn">Prøv innlogging med demobruker</a></div>`;
    app.innerHTML = `
      <a class="back" href="#logg-inn">${ICON.back}Tilbake til innlogging</a>
      <header class="page-head"><h1 id="page-title" tabindex="-1">Registrer rederiet</h1></header>
      ${st.step <= 3 ? stepsBar() : ''}
      <div class="card stack">${body}</div>`;
    bind();
  };
  const bind = () => {
    document.getElementById('r-bankid')?.addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'Venter på BankID …';
      await auth.startBankId(); st.step = 2; draw(); document.getElementById('orgnr').focus();
    });
    document.getElementById('org-next')?.addEventListener('click', async e => {
      const raw = document.getElementById('orgnr').value; const o = digits(raw); st.orgnr = raw;
      if (st.company && st.company.orgnr === o){ st.step = 3; draw(); return; }
      st.company = null;
      const err = document.getElementById('org-err');
      if (o.length !== 9){ err.innerHTML = `${ICON.warn}Organisasjonsnummeret må ha 9 siffer.`; err.hidden = false; document.getElementById('orgnr').setAttribute('aria-invalid','true'); return; }
      err.hidden = true; e.target.disabled = true; e.target.textContent = 'Søker …';
      try {
        const res = await registry.lookupOrg(o); st.company = res;
        document.getElementById('org-result').innerHTML = `<div class="notice notice-info">${ICON.info}<p><strong>${esc(res.name)}</strong>Org.nr. ${esc(fmtOrg(o))}. Demodata, ikke hentet fra Brønnøysundregistrene.</p></div>`;
        e.target.disabled = false; e.target.textContent = 'Dette er riktig rederi';
      } catch(ex){
        e.target.disabled = false; e.target.textContent = 'Finn rederiet';
        err.innerHTML = `${ICON.warn}${ex.code === 'offline' ? 'Du er uten nett. Prøv igjen når du har nett.' : 'Fant ikke rederiet. Sjekk nummeret.'}`; err.hidden = false;
      }
    });
    document.getElementById('basis-send')?.addEventListener('click', () => {
      const b = document.querySelector('input[name="basis"]:checked');
      document.getElementById('basis-err').hidden = !!b;
      if (!b) return;
      db.applications.push({ orgnr: st.company.orgnr, name: st.company.name, basis: b.value, at: nowISO(), status:'pending' }); save();
      st.step = 4; draw(); focusTitle();
    });
  };
  draw();
}

/* =====================================================================
   MINE FARTØY (rederi)
   ===================================================================== */
function requireUser(){ const u = auth.current(); if (!u){ go('logg-inn'); return null; } return u; }

function viewDashboard(opts = {}){
  state.lastRoute = 'dash';
  state.pendingRefresh = false;
  const u = requireUser(); if (!u) return;
  if (u.role === 'none') return viewNoAccess(u);
  renderNav();
  const isPlatform = u.role === 'platform';
  const isAdmin = u.role === 'admin';
  const co = isPlatform ? null : api.company(u.companyId);
  const vessels = co ? api.vesselsFor(co.id) : [];
  const pending = db.changes.filter(c => c.status === 'pending' && vessels.some(v => v.id === c.vesselId));
  const roleName = isPlatform ? 'plattformadministrator' : isAdmin ? 'administrator' : 'medarbeider';
  const people = co ? Object.values(db.users).filter(p => p.companyId === co.id) : [];
  const open = api.openReportCount(u);
  if (isAdmin) runReminders();
  // Fartøy som trenger oppmerksomhet først
  const needs = v => (['stale','partial','unverified','unclaimed'].includes(vesselVerification(v).state)
    || db.reports.some(r => r.vesselId === v.id && r.status === 'new') || api.pendingFor(v.id).length) ? 0 : 1;
  const sortedVessels = vessels.slice().sort((a,b) => needs(a) - needs(b) || a.name.localeCompare(b.name, 'nb'));
  const needCount = vessels.filter(v => needs(v) === 0).length;
  const myMail = db.outbox.filter(m => m.to === u.email).slice(-8).reverse();

  app.innerHTML = `
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">${isPlatform ? 'Innmeldte feil' : 'Mine fartøy'}</h1>
      <p class="sub">${isPlatform ? 'Fartøykontakt · alle rederier' : `${esc(co.name)} · Org.nr. <span class="num">${esc(fmtOrg(co.orgnr))}</span>`}</p>
      <div class="who"><span>Logget inn som <strong style="color:var(--text)">${esc(u.name)}</strong>, ${roleName}${REMOTE ? '' : ' <span class="demo-tag">Demo</span>'}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="logout">Logg ut</button></div>
      ${open && !isPlatform ? `<a class="alert-link" href="#innmeldte-feil">${ICON.bell}${open === 1 ? '1 innmeldt feil' : open + ' innmeldte feil'}</a>` : ''}
    </header>

    ${u.role === 'member' ? `<div class="notice notice-info" style="margin-bottom:18px">${ICON.info}<p>Endringer du gjør, må godkjennes av en administrator i rederiet før de vises.</p></div>` : ''}

    ${isAdmin && pending.length ? `<section class="dash-section" style="margin-top:0;margin-bottom:28px" aria-labelledby="ap-h">
      <h2 id="ap-h">Venter på din godkjenning</h2>
      ${pending.map(c => { const v = api.getVessel(c.vesselId); return `<div class="approval">
        <strong>${esc(v.name)}: ${esc(FIELD_LABEL[c.field])}</strong>
        <div class="diff"><s>${esc(fmtValue(c.field, c.from))}</s><span aria-hidden="true">→</span><span>${esc(fmtValue(c.field, c.to))}</span></div>
        <p class="hint" style="margin-top:6px">Foreslått av ${esc(c.byName)} ${esc(fmtDate(c.at, true))}${fmtTime(c.at)}</p>
        <div class="form-actions" style="margin-top:12px"><button type="button" class="btn btn-primary" data-approve="${esc(c.id)}">Godkjenn</button><button type="button" class="btn btn-danger" data-reject-change="${esc(c.id)}">Avvis</button></div>
      </div>`; }).join('')}
    </section>` : ''}

    ${(isAdmin || isPlatform) ? `<div id="reports-slot">${renderReports(u)}</div>` : ''}

    ${state.vflash ? `<div class="notice notice-ok" role="status" style="margin-bottom:12px">${ICON.ok}<p>${state.vflash}</p></div>` : ''}
    ${!isPlatform ? `<section aria-labelledby="vl-h" class="dash-section" id="fartoy-liste" ${(isAdmin && api.reportsFor(u).length) || pending.length ? '' : 'style="margin-top:0"'}>
      <h2 id="vl-h">Fartøy${needCount ? ` <span class="hint vl-need">· ${needCount === 1 ? '1 trenger' : needCount + ' trenger'} oppmerksomhet</span>` : ''}</h2>
      <ul class="vlist">${sortedVessels.map(v => vesselRow(v, u)).join('')}</ul>
    </section>` : ''}

    ${isPlatform || u.platform ? `<section class="dash-section" aria-labelledby="set-h">
      <h2 id="set-h">${isPlatform ? 'Innstillinger' : 'Plattform'}</h2>
      <div class="card stack">
        ${REMOTE ? `<div class="form-actions"><a class="btn btn-secondary" href="#fartoyregister">Fartøyregister</a></div>
          <p class="hint">Synkronisering med Fiskeridirektoratet, eierskifter og saker til gjennomgang.</p>` : ''}
        <div class="field">
          <label for="verify-months">Hvor lenge gjelder en bekreftelse fra rederiet?</label>
          <select class="input" id="verify-months">${[3,6,12].map(n => `<option value="${n}" ${n === verifyMonths() ? 'selected' : ''}>${n} måneder</option>`).join('')}</select>
          <p class="hint">Etter dette vises «Bør bekreftes på nytt» på fartøysiden, og rederiet får en påminnelse.</p>
        </div>
      </div>
    </section>` : ''}

    ${isAdmin && myMail.length ? `<section class="dash-section">
      <details class="history"><summary>Dine varsler (${myMail.length})</summary>
        <ul class="timeline">${myMail.map(m => `<li><time datetime="${esc(m.at)}">${esc(fmtDate(m.at, true))}${fmtTime(m.at)}</time>${esc(m.subject)}</li>`).join('')}</ul>
        <p class="hint" style="margin-top:8px"><span class="demo-tag">Demo</span> E-post sendes ikke i prototypen. Like varsler samles, så du ikke får det samme flere ganger på kort tid.</p>
      </details>
    </section>` : ''}

    ${isAdmin ? `<section class="dash-section">
      <details class="history"><summary>Hvem har tilgang (${people.length})</summary>
        <ul class="people">${people.map(p => `<li><span>${esc(p.name)}</span><span class="hint">${p.role === 'admin' ? 'Administrator' : 'Medarbeider'}</span></li>`).join('')}</ul>
        <p class="hint" style="margin-top:8px">Nye personer får tilgang når vi har sjekket at de kan representere rederiet. Alle endringer lagres med navn og tidspunkt.</p>
      </details>
    </section>` : ''}`;

  document.getElementById('logout').addEventListener('click', () => { auth.signOut(); toast('Du er logget ut'); go('sok'); });
  app.querySelectorAll('[data-approve],[data-reject-change]').forEach(b => b.addEventListener('click', async () => {
    const approve = !!b.dataset.approve; b.disabled = true;
    try { await api.decide(b.dataset.approve || b.dataset.rejectChange, approve, u); toast(approve ? 'Godkjent. Det nye nummeret vises nå.' : 'Endringen er avvist'); viewDashboard(); }
    catch(ex){ b.disabled = false; toast(ex.code === 'offline' ? 'Du er uten nett. Prøv igjen.' : 'Noe gikk galt. Prøv igjen.'); }
  }));
  bindReports(u);
  state.vflash = null;
  app.querySelectorAll('[data-verify]').forEach(b => b.addEventListener('click', () => {
    const li = b.closest('.vrow'); openVerify(li, api.getVessel(li.dataset.vessel), u);
  }));
  document.getElementById('verify-months')?.addEventListener('change', async e => {
    try { await api.setVerifyMonths(e.target.value, u); toast(`En bekreftelse gjelder nå i ${e.target.value} måneder`); }
    catch(ex){ toast(ex.code === 'offline' ? 'Du er uten nett. Prøv igjen.' : 'Kunne ikke lagre innstillingen.'); }
  });
  if (opts.openVerify){ const li = app.querySelector(`.vrow[data-vessel="${opts.openVerify}"]`); if (li) openVerify(li, api.getVessel(opts.openVerify), u); }
  if (opts.focusReports){
    setTimeout(() => { const sec = document.getElementById('innmeldte-feil'); if (sec){ sec.scrollIntoView({ block:'start' }); sec.focus({ preventScroll:true }); } }, 0);
  }
}

/* =====================================================================
   MINE FARTØY — status og «Bekreft kontaktinformasjon»
   ===================================================================== */
function vesselRow(v, u){
  const vv = vesselVerification(v);
  const reports = db.reports.filter(r => r.vesselId === v.id && r.status === 'new').length;
  const pend = api.pendingFor(v.id).length;
  const canVerify = isCompanyAdmin(u, v);
  const d = vv.at ? fmtDate(vv.at) : '';
  const m = verifyMonths();
  let head, cls, line = '', remind = '', btn = '';
  if (vv.state === 'verified'){
    head = `${ICON.check}Kontaktinformasjonen er bekreftet`; cls = 'vs-ok'; line = `Sist bekreftet: ${esc(d)}`;
    if (canVerify) btn = `<button type="button" class="btn btn-secondary" data-verify>Bekreft på nytt</button>`;
  } else if (vv.state === 'stale'){
    head = `${ICON.clock}Bør bekreftes på nytt`; cls = 'vs-warn'; line = `Sist bekreftet: ${esc(d)}`;
    remind = `<p class="reminder">Det er over ${m} måneder siden kontaktinformasjonen ble bekreftet.</p>`;
    if (canVerify) btn = `<button type="button" class="btn btn-primary" data-verify>Bekreft nå</button>`;
  } else if (vv.state === 'unclaimed'){
    head = `${ICON.dash}Kontaktinformasjon mangler`; cls = 'vs-need'; line = 'Legg inn telefon og e-post under «Administrer».';
  } else {
    const okN = vv.fields.filter(f => f.state === 'verified').length;
    head = `${ICON.dash}Kontaktinformasjonen må bekreftes`; cls = 'vs-need';
    line = vv.state === 'partial' ? `${okN} av ${vv.fields.length} opplysninger er bekreftet` : 'Ikke bekreftet ennå';
    if (canVerify) btn = `<button type="button" class="btn btn-primary" data-verify>Bekreft kontaktinformasjon</button>`;
  }
  return `<li class="vrow" data-vessel="${esc(v.id)}">
    <div class="vrow-main">
      <h3>${esc(v.name)}</h3>
      <p class="meta"><span class="num">${esc(v.regNr)}</span></p>
      <p class="vstate ${cls}">${head}</p>
      ${line ? `<p class="hint">${line}</p>` : ''}
      ${remind}
      ${reports || pend ? `<div class="badges">
        ${reports ? `<a class="pill pill-warn pill-link" href="#innmeldte-feil">${ICON.bell}${reports === 1 ? '1 innmeldt feil' : reports + ' innmeldte feil'}</a>` : ''}
        ${pend ? `<span class="pill pill-warn">${ICON.clock}Endring venter på godkjenning</span>` : ''}</div>` : ''}
    </div>
    <div class="vrow-actions"><a class="btn btn-secondary" href="#rediger-${esc(v.id)}" aria-label="Administrer ${esc(v.name)}">Administrer</a>${btn}</div>
    <div class="verify-panel" hidden></div>
  </li>`;
}

/* Kompakt oversikt: se alt, rett det som er feil, bekreft med ett klikk. */
function openVerify(li, v, u){
  const panel = li.querySelector('.verify-panel');
  const actions = li.querySelector('.vrow-actions');
  const expected = snapshotOf(v);              // det administratoren ser nå
  const edits = {};
  const fields = contactFields(v);
  const isMail = k => k.endsWith('email');
  const show = (k, val) => val ? (isMail(k) ? val : fmtPhone(val)) : '(tomt)';
  const valueHtml = f => {
    const k = f.key;
    if (k in edits) return `<button type="button" class="suggest num" data-vedit="${k}" title="Klikk for å rette">${esc(show(k, edits[k]))}${ICON.pencil}</button>
      <span class="changed-tag">Endret</span> <s class="hint num">${esc(show(k, expected[k]))}</s>`;
    return `<button type="button" class="suggest num" data-vedit="${k}" title="Klikk for å rette">${esc(show(k, expected[k]))}${ICON.pencil}</button>`;
  };
  const draw = () => {
    const changed = Object.keys(edits).length;
    panel.innerHTML = `
      <p class="vp-title"><strong>Stemmer dette for ${esc(v.name)}?</strong></p>
      <ul class="vp-list">${fields.map(f => `<li data-key="${f.key}">
        <span class="vp-label">${esc(f.label)} ${f.key in edits ? '' : fieldTag(f)}</span>
        <span class="vp-val">${valueHtml(f)}</span>
      </li>`).join('')}</ul>
      <p class="hint">Er noe feil? Klikk på det og rett det før du bekrefter.</p>
      <p class="err vp-err" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" data-vok>${changed ? 'Lagre og bekreft' : 'Ja, informasjonen stemmer'}</button>
        <button type="button" class="btn btn-ghost" data-vcancel>Avbryt</button>
      </div>`;
    bind();
  };
  const close = () => { panel.hidden = true; panel.innerHTML = ''; actions.hidden = false; li.querySelector('[data-verify]')?.focus(); if (state.pendingRefresh) viewDashboard(); };
  const err = (code, field) => {
    const box = panel.querySelector('.vp-err');
    const label = field ? (VLABEL[field] || '') : '';
    box.innerHTML = ICON.warn + esc(({
      conflict: 'Noen andre har endret kontaktinformasjonen mens du så på den. Lukk og åpne på nytt for å se det som gjelder nå.',
      forbidden: 'Bare administratorer i rederiet kan bekrefte kontaktinformasjon.',
      invalid: `${label || 'Verdien'} ser ikke riktig ut. Sjekk og prøv igjen.`,
      required: 'Telefon til broen kan ikke være tom.',
      offline: 'Du er uten nett, så ingenting ble lagret. Prøv igjen når du har nett.'
    })[code] || 'Noe gikk galt, og ingenting ble lagret. Prøv igjen.');
    box.hidden = false;
  };
  const bind = () => {
    panel.querySelector('[data-vcancel]').addEventListener('click', close);
    panel.querySelectorAll('[data-vedit]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.vedit;
      const slot = b.closest('.vp-val');
      const start = k in edits ? edits[k] : expected[k];
      slot.innerHTML = `<form class="inline-edit" novalidate>
        <label class="sr-only" for="ve-${k}">${esc(VLABEL[k])}</label>
        <input class="input input-inline" id="ve-${k}" type="${isMail(k) ? 'email' : 'tel'}" inputmode="${isMail(k) ? 'email' : 'tel'}" autocomplete="off" value="${esc(isMail(k) ? start : fmtPhone(start))}">
        <button type="submit" class="btn btn-primary btn-sm">Lagre</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cancel>Avbryt</button>
      </form>`;
      const input = slot.querySelector('input'); input.focus(); input.select();
      input.addEventListener('keydown', ev => { if (ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); draw(); panel.querySelector(`[data-vedit="${k}"]`)?.focus(); } });
      slot.querySelector('[data-cancel]').addEventListener('click', () => draw());
      slot.querySelector('form').addEventListener('submit', ev => {
        ev.preventDefault();
        const val = isMail(k) ? input.value.trim() : normPhone(input.value);
        const okVal = val ? (isMail(k) ? validEmail(val) : validPhone(val)) : k !== 'bridgePhone';
        if (!okVal){ input.setAttribute('aria-invalid', 'true'); err(val ? 'invalid' : 'required', k); input.focus(); return; }
        if (val === expected[k]) delete edits[k]; else edits[k] = val;
        draw();
        panel.querySelector('[data-vok]').focus();
      });
    }));
    panel.querySelector('[data-vok]').addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Lagrer …';
      try {
        const res = await api.verifyVessel(v.id, { expected, edits }, u);
        state.vflash = `${esc(v.name)} er bekreftet av rederiet i dag${res.changed.length ? ', med rettingene dine' : ''}. Fartøysiden er oppdatert. <a href="#fartoy-${esc(v.id)}">Se fartøysiden</a>`;
        toast('Kontaktinformasjonen er bekreftet');
        viewDashboard();
      } catch(ex){
        b.disabled = false; b.textContent = Object.keys(edits).length ? 'Lagre og bekreft' : 'Ja, informasjonen stemmer';
        err(ex.code, ex.field);
        if (ex.code === 'conflict'){ b.hidden = true; panel.querySelector('[data-vcancel]').textContent = 'Lukk'; state.pendingRefresh = true; }
      }
    });
  };
  panel.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.target.closest('.inline-edit')) close(); });
  actions.hidden = true;
  panel.hidden = false;
  draw();
  panel.querySelector('[data-vok]').focus();
}

/* =====================================================================
   INNMELDTE FEIL — godta, rediger selv, avvis
   ===================================================================== */
const REJECT_REASONS = ['Opplysningen stemmer', 'Gjelder ikke dette fartøyet', 'Nummeret er ikke vårt'];

function renderReports(u){
  const all = api.reportsFor(u);
  const open = all.filter(r => r.status === 'new').sort((a,b) => b.at.localeCompare(a.at));
  const done = all.filter(r => r.status !== 'new').sort((a,b) => (b.resolvedAt || '').localeCompare(a.resolvedAt || '')).slice(0, 6);
  if (!open.length && !done.length) return '';
  // Grupper per fartøy, nyeste melding først
  const groups = [];
  open.forEach(r => { let g = groups.find(x => x.vesselId === r.vesselId); if (!g){ g = { vesselId:r.vesselId, items:[] }; groups.push(g); } g.items.push(r); });
  const flash = state.flash; state.flash = null;
  return `<section class="dash-section reports" id="innmeldte-feil" tabindex="-1" aria-labelledby="rf-h" style="margin-top:0;margin-bottom:28px">
    <h2 id="rf-h">Innmeldte feil ${open.length ? `<span class="count" aria-label="${open.length} ubehandlede">${open.length}</span>` : ''}</h2>
    ${flash ? `<div class="notice notice-ok" role="status" style="margin-bottom:12px">${ICON.ok}<p>${flash}</p></div>` : ''}
    ${open.length ? groups.map(g => {
      const v = api.getVessel(g.vesselId);
      const showCo = u.role === 'platform' || u.platform;
      return `<div class="report-group">
        <h3 class="group-title">${esc(v.name)}${showCo ? ` <span class="hint">· ${esc(api.company(v.companyId).name)}</span>` : ''}${g.items.length > 1 ? ` <span class="hint">· ${g.items.length} meldinger</span>` : ''}</h3>
        ${g.items.map(r => reportCard(r, v, u)).join('')}
      </div>`;
    }).join('') : `<p class="hint">Ingen nye innmeldte feil. Bra jobbet.</p>`}
    ${done.length ? `<details class="history"><summary>Nylig behandlet (${done.length})</summary>
      <ul class="timeline">${done.map(r => { const v = api.getVessel(r.vesselId); return `<li>
        <time datetime="${esc(r.resolvedAt || '')}">${esc(fmtDate(r.resolvedAt))}${fmtTime(r.resolvedAt)}</time>
        <strong>${esc(v.name)}</strong>: ${esc(r.reason)}
        <div class="by">${resolutionText(r)}</div></li>`; }).join('')}</ul>
    </details>` : ''}
  </section>`;
}
function resolutionText(r){
  const who = esc(r.resolvedBy || 'rederiet');
  if (r.status === 'accepted') return `Forslaget ble godtatt av ${who}: <span class="num">${esc(fmtValue(r.field, r.resolvedValue))}</span>`;
  if (r.status === 'corrected') return `Rettet av ${who} til <span class="num">${esc(fmtValue(r.field, r.resolvedValue))}</span>`;
  if (r.status === 'rejected') return `Avvist av ${who}${r.rejectReason ? `: «${esc(r.rejectReason)}»` : ''}`;
  return `${esc(r.resolution || 'Behandlet')} (${who})`;
}

function reportCard(r, v, u){
  const f = r.field;
  const isEmail = f === 'email';
  const noun = isEmail ? 'e-post' : 'nummer';
  const title = f === 'bridgePhone' ? 'Innmeldt feil telefonnummer' : isEmail ? 'Innmeldt feil e-postadresse' : 'Innmeldt feil';
  const cur = f ? (v[f] || '') : '';
  const movedOn = f && (r.current || '') !== cur;
  return `<article class="report" data-report="${esc(r.id)}" data-expected="${esc(cur)}" aria-labelledby="rt-${esc(r.id)}">
    <h4 class="report-title" id="rt-${esc(r.id)}">${title}</h4>
    <p class="hint">${esc(r.reason)} · Meldt ${esc(fmtDate(r.at, true))}${fmtTime(r.at)}</p>
    ${r.details ? `<p class="report-quote">«${esc(r.details)}»</p>` : ''}
    ${f ? `<dl class="report-nums">
      <dt>Nåværende ${noun}</dt><dd class="num">${esc(fmtValue(f, cur))}</dd>
      <dt>Foreslått ${noun}</dt>
      <dd class="suggest-slot">${r.suggested
        ? `<button type="button" class="suggest num" data-edit title="Klikk for å endre">${esc(fmtValue(f, r.suggested))}${ICON.pencil}</button>`
        : `<span class="hint">Ingen forslag</span>`}</dd>
    </dl>` : ''}
    ${movedOn ? `<div class="notice notice-info">${ICON.info}<p>${isEmail ? 'E-posten' : 'Nummeret'} er endret etter at meldingen kom. Sjekk om meldingen fortsatt gjelder.</p></div>` : ''}
    <p class="err report-err" hidden></p>
    <div class="report-actions">
      ${f && r.suggested ? `<button type="button" class="btn btn-primary" data-accept>Godta endring</button>` : ''}
      ${f ? `<button type="button" class="btn btn-secondary" data-edit>${r.suggested ? 'Rediger selv' : (isEmail ? 'Skriv riktig e-post' : 'Skriv riktig nummer')}</button>`
          : (u.role === 'admin' ? `<a class="btn btn-secondary" href="#rediger-${esc(v.id)}">Åpne fartøyet</a>` : '')}
      <button type="button" class="btn btn-ghost btn-reject" data-reject>Avvis</button>
    </div>
    <div class="reject-panel" hidden>
      <p><strong>Avvise meldingen?</strong> Kontaktinformasjonen endres ikke.</p>
      <div class="reason-chips">${REJECT_REASONS.map(t => `<button type="button" class="chip" data-reason="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <label class="sr-only" for="rr-${esc(r.id)}">Begrunnelse</label>
      <input class="input input-sm" id="rr-${esc(r.id)}" maxlength="140" placeholder="Begrunnelse (valgfritt)">
      <div class="form-actions"><button type="button" class="btn btn-danger" data-reject-ok>Avvis meldingen</button><button type="button" class="btn btn-ghost" data-reject-cancel>Avbryt</button></div>
    </div>
    ${r.contact ? `<p class="hint">Den som meldte inn, kan kontaktes på ${esc(r.contact)}</p>` : ''}
  </article>`;
}

function reportErrorText(code, isEmail){
  return ({
    invalid: isEmail ? 'E-postadressen ser ikke riktig ut. Den skal se slik ut: navn@firma.no' : 'Nummeret ser ikke riktig ut. Skriv 8 siffer, eller landskode med + foran (for eksempel +47 912 34 567).',
    same: isEmail ? 'Dette er samme e-post som i dag. Avvis meldingen hvis den stemmer.' : 'Dette er samme nummer som i dag. Avvis meldingen hvis nummeret stemmer.',
    conflict: 'Noen andre har endret kontaktinformasjonen i mellomtiden. Vi har lastet inn det som gjelder nå.',
    already: 'Meldingen er allerede behandlet av noen andre.',
    forbidden: 'Du har ikke tilgang til å endre dette fartøyet.',
    notfound: 'Fant ikke meldingen. Den kan være slettet.',
    offline: 'Du er uten nett, så ingenting ble lagret. Prøv igjen når du har nett.'
  })[code] || 'Noe gikk galt, og ingenting ble lagret. Prøv igjen.';
}

function bindReports(u){
  const slot = document.getElementById('reports-slot'); if (!slot) return;
  slot.querySelectorAll('.report').forEach(card => {
    const r = db.reports.find(x => x.id === card.dataset.report); if (!r) return;
    const v = api.getVessel(r.vesselId);
    const isEmail = r.field === 'email';
    const err = card.querySelector('.report-err');
    const showErr = code => { err.innerHTML = ICON.warn + esc(reportErrorText(code, isEmail)); err.hidden = false; };
    const actions = card.querySelector('.report-actions');

    // Godta endring → bekreft
    card.querySelector('[data-accept]')?.addEventListener('click', e => {
      err.hidden = true;
      confirmChange({ r, v, value: r.suggested, expected: card.dataset.expected, opener: e.currentTarget });
    });

    // Rediger selv → nummeret blir et redigerbart felt på stedet
    card.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      if (card.querySelector('.inline-edit')) return;
      err.hidden = true;
      const slotEl = card.querySelector('.suggest-slot');
      const before = slotEl.innerHTML;
      const start = r.suggested || card.dataset.expected || '';
      slotEl.innerHTML = `<form class="inline-edit" novalidate>
        <label class="sr-only" for="ie-${esc(r.id)}">${isEmail ? 'Riktig e-postadresse' : 'Riktig telefonnummer'}</label>
        <input class="input input-inline" id="ie-${esc(r.id)}" type="${isEmail ? 'email' : 'tel'}" inputmode="${isEmail ? 'email' : 'tel'}" autocomplete="off" value="${esc(isEmail ? start : fmtPhone(start))}">
        <button type="submit" class="btn btn-primary btn-sm">Lagre</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cancel>Avbryt</button>
      </form>`;
      actions.hidden = true;
      const input = slotEl.querySelector('input');
      input.focus(); input.select();
      const cancel = () => { slotEl.innerHTML = before; actions.hidden = false; err.hidden = true; bindAfterCancel(); };
      const bindAfterCancel = () => { if (state.pendingRefresh) return refreshReports(u); card.querySelector('.suggest-slot [data-edit]')?.addEventListener('click', () => card.querySelector('.report-actions [data-edit]').click()); };
      input.addEventListener('keydown', ev => { if (ev.key === 'Escape'){ ev.preventDefault(); cancel(); card.querySelector('.report-actions [data-edit]')?.focus(); } });
      slotEl.querySelector('[data-cancel]').addEventListener('click', cancel);
      slotEl.querySelector('form').addEventListener('submit', ev => {
        ev.preventDefault();
        const val = isEmail ? input.value.trim() : normPhone(input.value);
        const okVal = isEmail ? validEmail(val) : validPhone(val);
        input.setAttribute('aria-invalid', okVal ? 'false' : 'true');
        if (!okVal){ showErr('invalid'); input.focus(); return; }
        if (val === card.dataset.expected){ showErr('same'); input.focus(); return; }
        err.hidden = true;
        confirmChange({ r, v, value: val, expected: card.dataset.expected, opener: input });
      });
    }));

    // Avvis → kort panel, begrunnelse er valgfri
    const panel = card.querySelector('.reject-panel');
    card.querySelector('[data-reject]').addEventListener('click', () => { panel.hidden = false; actions.hidden = true; panel.querySelector('[data-reject-ok]').focus(); });
    panel.querySelector('[data-reject-cancel]').addEventListener('click', () => { panel.hidden = true; actions.hidden = false; if (state.pendingRefresh) refreshReports(u); });
    panel.querySelectorAll('[data-reason]').forEach(c => c.addEventListener('click', () => { panel.querySelector('input').value = c.dataset.reason; }));
    panel.querySelector('[data-reject-ok]').addEventListener('click', async ev => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Avviser …';
      try {
        await api.rejectReport(r.id, panel.querySelector('input').value, u);
        state.flash = `Meldingen om ${esc(v.name)} er avvist. Kontaktinformasjonen er ikke endret.`;
        toast('Meldingen er avvist'); refreshReports(u);
      } catch(ex){
        b.disabled = false; b.textContent = 'Avvis meldingen'; showErr(ex.code);
        if (ex.code === 'already') setTimeout(() => refreshReports(u), 1600);
      }
    });
  });
}

function refreshReports(u){
  u = u || auth.current();
  if (state.lastRoute !== 'dash' || !u) return;
  viewDashboard();
}

/* Bekreftelsesdialog — samme for «Godta endring» og «Rediger selv» */
function confirmChange({ r, v, value, expected, opener }){
  const u = auth.current();
  const f = r.field, isEmail = f === 'email';
  const showPrevOption = f === 'bridgePhone' && !!expected;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title" aria-describedby="m-desc">
    <h2 id="m-title">${isEmail ? 'Bytte e-post' : 'Bytte nummer'} for ${esc(v.name)}?</h2>
    <div class="swap">
      <div><span class="k">Nå</span><s class="num">${esc(fmtValue(f, expected))}</s></div>
      <div aria-hidden="true" class="swap-arrow">→</div>
      <div><span class="k">Nytt</span><strong class="num">${esc(fmtValue(f, value))}</strong></div>
    </div>
    <p class="hint" id="m-desc">${isEmail ? 'Den nye e-posten vises med en gang på fartøysiden.' : 'Det nye nummeret vises med en gang i søket. Det gamle lagres, så de som søker på det, finner det nye.'}</p>
    ${u && u.role === 'platform' ? `<p class="hint">Du endrer som Fartøykontakt. ${isEmail ? 'E-posten' : 'Nummeret'} blir ikke merket som bekreftet av rederiet før rederiet selv bekrefter det.</p>` : ''}
    ${showPrevOption ? `<label class="choice choice-sm"><input type="checkbox" id="m-prev"><span>Vis det gamle nummeret på fartøysiden i 6 måneder</span></label>` : ''}
    <p class="err" id="m-err" hidden></p>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" id="m-ok">${isEmail ? 'Ja, bytt e-post' : 'Ja, bytt nummer'}</button>
      <button type="button" class="btn btn-secondary" id="m-cancel">Avbryt</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('modal-open');
  const okBtn = wrap.querySelector('#m-ok');
  okBtn.focus();
  const close = (after) => {
    wrap.remove(); document.body.classList.remove('modal-open'); document.removeEventListener('keydown', onKey, true);
    if (after) after(); else if (opener && document.contains(opener)) opener.focus();
    if (!after && state.pendingRefresh && !document.querySelector('.inline-edit')) refreshReports(u);
  };
  const onKey = e => {
    if (e.key === 'Escape'){ e.preventDefault(); close(); }
    if (e.key === 'Tab'){ // hold fokus i dialogen
      const items = [...wrap.querySelectorAll('button, input')].filter(x => !x.disabled);
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0){ e.preventDefault(); items[items.length-1].focus(); }
      else if (!e.shiftKey && i === items.length - 1){ e.preventDefault(); items[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('#m-cancel').addEventListener('click', () => close());
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true; okBtn.textContent = 'Lagrer …';
    const mErr = wrap.querySelector('#m-err');
    try {
      const res = await api.acceptReport(r.id, { value, expected, showPrevious: wrap.querySelector('#m-prev')?.checked }, u);
      close(() => {
        state.flash = `${esc(v.name)} har ${isEmail ? 'ny e-post' : 'nytt nummer'}: <strong class="num">${esc(fmtValue(f, res.value))}</strong>. Det vises nå for alle${res.verified ? ', merket som bekreftet av rederiet' : '. Det er ikke merket som bekreftet av rederiet før rederiet selv bekrefter det'}. <a href="#fartoy-${esc(v.id)}">Se fartøysiden</a>`;
        toast(isEmail ? 'E-posten er oppdatert' : 'Nummeret er oppdatert');
        refreshReports(u);
        setTimeout(() => document.querySelector('#innmeldte-feil .notice-ok')?.scrollIntoView({ block:'nearest' }), 0);
      });
    } catch(ex){
      okBtn.disabled = false; okBtn.textContent = isEmail ? 'Ja, bytt e-post' : 'Ja, bytt nummer';
      mErr.innerHTML = ICON.warn + esc(reportErrorText(ex.code, isEmail)); mErr.hidden = false;
      if (ex.code === 'conflict' || ex.code === 'already'){
        okBtn.hidden = true;
        wrap.querySelector('#m-cancel').textContent = 'Lukk';
        state.pendingRefresh = true;
      }
    }
  });
}

/* =====================================================================
   REDIGER FARTØY
   ===================================================================== */
function viewEdit(id){
  state.lastRoute = 'edit';
  const u = requireUser(); if (!u) return;
  const v = api.getVessel(id);
  if (!v || v.companyId !== u.companyId){
    app.innerHTML = `<header class="page-head"><h1 id="page-title" tabindex="-1">Du har ikke tilgang til dette fartøyet</h1></header>
      <p class="hint">Du kan bare endre fartøy som hører til ditt rederi.</p><p style="margin-top:16px"><a class="btn btn-secondary" href="#mine-fartoy">Til Mine fartøy</a></p>`;
    return;
  }
  const isAdmin = u.role === 'admin';
  const pending = api.pendingFor(v.id);
  const history = api.historyFor(v.id);
  const snap = snapshotOf(v);                   // verdiene slik de var da siden ble åpnet
  const vv = vesselVerification(v);
  const ftag = k => fieldTag(vv.fields.find(f => f.key === k));
  const fields = [
    ['bridgePhone', 'Telefon til broen', 'Nummeret folk skal ringe først.', 'tel', 'tel'],
    ['altPhone', 'Alternativt telefonnummer', 'For eksempel mobil eller satellitt om bord. Kan stå tomt.', 'tel', 'tel'],
    ['email', 'E-post til fartøyet', 'Kan stå tomt.', 'email', 'email']
  ];
  const statusLabel = c => ({ published:'Publisert', pending:'Venter på godkjenning', approved:`Godkjent av ${c.decidedBy||''}`, rejected:`Avvist av ${c.decidedBy||''}`, confirmed:'Bekreftet uten endring' }[c.status] || c.status);

  app.innerHTML = `
    <a class="back" href="#mine-fartoy">${ICON.back}Mine fartøy</a>
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">${esc(v.name)}</h1>
      <p class="sub"><span class="num">${esc(v.regNr)}</span> · ${esc(v.callsign)} · ${vv.at ? `Sist bekreftet ${esc(fmtDate(vv.at))}` : 'Ikke helt bekreftet'}</p>
    </header>

    ${pending.length ? `<div class="notice notice-warn" style="margin-bottom:14px">${ICON.clock}<p><strong>Venter på godkjenning</strong>${pending.map(c => `${esc(FIELD_LABEL[c.field])}: ${esc(fmtValue(c.field, c.from))} → ${esc(fmtValue(c.field, c.to))} (foreslått av ${esc(c.byName)})`).join('<br>')}
      ${isAdmin ? `<br><a href="#mine-fartoy">Godkjenn eller avvis under Mine fartøy</a>` : ''}</p></div>` : ''}

    <div id="edit-result"></div>

    <form id="edit-form" class="card stack" novalidate>
      ${fields.map(([f, label, hint, type, ac]) => `
        <div class="field">
          <label for="f-${f}">${label}<span class="changed-tag" id="tag-${f}" hidden>Endret</span> ${v[f] ? ftag(f) : ''}</label>
          <input class="input" id="f-${f}" name="${f}" type="${type}" autocomplete="off" ${type === 'tel' ? 'inputmode="tel"' : ''} value="${esc(f === 'email' ? v[f] : fmtPhone(v[f]))}" aria-describedby="h-${f} e-${f}">
          <p class="hint" id="h-${f}">${hint}</p>
          <p class="err" id="e-${f}" hidden></p>
        </div>`).join('')}
      <label class="choice" id="prev-choice" hidden>
        <input type="checkbox" id="show-prev">
        <span>Vis det gamle nummeret på fartøyets side i 6 måneder<small>Det gamle nummeret blir uansett søkbart, slik at folk som har det finner det nye. Det vises på siden bare hvis du krysser av her.</small></span>
      </label>
      <p class="hint" id="flow-hint">${isAdmin ? 'Endringer vises med en gang. Administratorer i rederiet får varsel.' : 'Endringen vises når en administrator har godkjent den.'}</p>
      <p class="err" id="form-err" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit" id="save">${ICON.check.replace('width="14" height="14"','width="18" height="18"')}Alt stemmer – bekreft</button>
        <a class="btn btn-secondary" href="#mine-fartoy">Avbryt</a>
      </div>
    </form>

    ${(() => {
      const nums = api.numbersFor(v.id); if (!nums.length) return '';
      const owners = currentPhoneOwners();
      return `<section class="card" aria-labelledby="old-h">
        <h2 id="old-h">Tidligere numre</h2>
        <p class="hint" style="margin-top:4px">Folk som søker på et gammelt nummer, finner ${esc(v.name)} og får det nye nummeret. Gamle numre vises ikke offentlig med mindre dere har valgt det.</p>
        <ul class="oldnums">${nums.map(h => {
          const st = histStatus(h, owners);
          const pill = st === 'confirmed' ? `<span class="pill pill-ok">${ICON.check}Bekreftet</span>`
            : st === 'unconfirmed' ? `<span class="pill pill-warn">${ICON.clock}Ikke bekreftet</span>`
            : `<span class="pill pill-neutral">${ICON.dash}Tatt i bruk av andre</span>`;
          const actions = !isAdmin ? '' : st === 'unconfirmed'
            ? `<button type="button" class="btn btn-primary btn-sm" data-hist="${esc(h.id)}" data-st="confirmed">Ja, det var vårt nummer</button><button type="button" class="btn btn-secondary btn-sm" data-hist="${esc(h.id)}" data-st="rejected">Ikke vårt nummer</button>`
            : st === 'confirmed' ? `<button type="button" class="btn btn-ghost btn-sm" data-hist="${esc(h.id)}" data-st="reassigned">Nummeret brukes nå av andre</button>` : '';
          return `<li><div class="oldnum-main"><span class="num oldnum">${esc(fmtPhone(h.number))}</span> ${pill}
            <p class="hint">${h.replacedAt ? `Byttet ${esc(fmtDate(h.replacedAt))}` : 'Dato for bytte ukjent'} · Kilde: ${esc(h.source)}${h.verifiedAt ? ` · Sjekket ${esc(fmtDate(h.verifiedAt, true))}` : ''}</p>
            ${st === 'unconfirmed' ? `<p class="hint">Søk på dette nummeret viser en advarsel til det er bekreftet.</p>` : ''}</div>
            ${actions ? `<div class="form-actions">${actions}</div>` : ''}</li>`;
        }).join('')}</ul>
        ${!isAdmin ? `<p class="hint" style="margin-top:8px">Bare administratorer kan bekrefte gamle numre.</p>` : ''}
      </section>`;
    })()}

    <details class="history card">
      <summary>Tidligere endringer (${history.length})</summary>
      ${history.length ? `<ol class="timeline">${history.map(c => `<li>
        <time datetime="${esc(c.at)}">${esc(fmtDate(c.at))}${fmtTime(c.at)}</time>
        ${c.field === 'confirm' ? 'Bekreftet at opplysningene stemmer' : `<strong>${esc(FIELD_LABEL[c.field])}</strong>: <span class="num">${esc(fmtValue(c.field, c.from))}</span> → <span class="num">${esc(fmtValue(c.field, c.to))}</span>`}
        <div class="by">${esc(c.byName)} · ${esc(statusLabel(c))}${c.via === 'report' ? ' · Fra innmeldt feil' : ''}${c.field === 'bridgePhone' && c.status !== 'pending' && c.status !== 'rejected' ? (c.showPrevious ? ' · Gammelt nummer vises' : ' · Gammelt nummer skjult') : ''}</div></li>`).join('')}</ol>` : '<p class="hint">Ingen endringer ennå.</p>'}
    </details>`;

  const form = document.getElementById('edit-form');
  const saveBtn = document.getElementById('save');
  const prevChoice = document.getElementById('prev-choice');
  const valOf = f => { const raw = document.getElementById('f-'+f).value; return f === 'email' ? raw.trim() : normPhone(raw); };
  const changed = () => fields.map(([f]) => f).filter(f => valOf(f) !== (snap[f] || ''));
  const refresh = () => {
    const ch = changed();
    fields.forEach(([f]) => document.getElementById('tag-'+f).hidden = !ch.includes(f));
    prevChoice.hidden = !(ch.includes('bridgePhone') && v.bridgePhone);
    saveBtn.innerHTML = ch.length ? (isAdmin ? 'Lagre endringer' : 'Send til godkjenning') : isAdmin ? `${ICON.check.replace('width="14" height="14"','width="18" height="18"')}Alt stemmer – bekreft` : 'Send til godkjenning';
    saveBtn.disabled = !isAdmin && !ch.length;   // bare administratorer kan bekrefte
  };
  form.addEventListener('input', refresh);
  app.querySelectorAll('[data-hist]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.setNumberStatus(b.dataset.hist, b.dataset.st, u); viewEdit(v.id); toast(HIST_LABEL[b.dataset.st]); }
    catch(ex){ b.disabled = false; toast(ex.code === 'offline' ? 'Du er uten nett. Prøv igjen.' : 'Noe gikk galt. Prøv igjen.'); }
  }));
  refresh();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    let firstBad = null;
    for (const [f] of fields){
      const el = document.getElementById('f-'+f), er = document.getElementById('e-'+f), val = valOf(f);
      let msg = '';
      if (f === 'bridgePhone' && !val) msg = 'Skriv inn telefonnummeret til broen.';
      else if (f !== 'email' && val && !validPhone(val)) msg = 'Nummeret ser ikke riktig ut. Skriv 8 siffer, eller landskode med + foran (for eksempel +47 912 34 567).';
      else if (f === 'email' && val && !validEmail(val)) msg = 'E-postadressen ser ikke riktig ut. Den skal se slik ut: navn@firma.no';
      er.innerHTML = msg ? ICON.warn + esc(msg) : ''; er.hidden = !msg; el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg && !firstBad) firstBad = el;
    }
    if (firstBad){ firstBad.focus(); return; }
    const ch = changed();
    const err = document.getElementById('form-err'); err.hidden = true;
    saveBtn.disabled = true; const label = saveBtn.innerHTML; saveBtn.textContent = 'Lagrer …';
    try {
      let msg;
      if (!ch.length){
        await api.confirm(v.id, u, snap);
        msg = `<div class="notice notice-ok">${ICON.ok}<p><strong>Takk, opplysningene er bekreftet</strong>Fartøysiden viser nå «Bekreftet av rederiet», sist bekreftet ${esc(fmtDate(nowISO()))}.</p></div>`;
      } else {
        const res = await api.submitChange(v.id, ch.map(f => ({ field:f, from:snap[f] || '', to:valOf(f) })), document.getElementById('show-prev').checked, u);
        msg = res.published
          ? `<div class="notice notice-ok">${ICON.ok}<p><strong>Endringen er lagret og vises nå i søket</strong>Andre administratorer og rederiets e-post får varsel. <span class="demo-tag">Demo</span> Ingen e-post sendes i prototypen.</p></div>`
          : `<div class="notice notice-warn">${ICON.clock}<p><strong>Sendt til godkjenning</strong>En administrator i rederiet har fått beskjed. Endringen vises når den er godkjent. <span class="demo-tag">Demo</span> Ingen e-post sendes i prototypen.</p></div>`;
      }
      viewEdit(v.id);
      document.getElementById('edit-result').innerHTML = `<div style="margin-bottom:14px" role="status">${msg}</div>`;
      toast(!ch.length ? 'Bekreftet' : 'Lagret');
      window.scrollTo(0,0);
    } catch(ex){
      saveBtn.disabled = false; saveBtn.innerHTML = label;
      const m = ex.code === 'offline' ? 'Endringen ble ikke lagret fordi du er uten nett. Det du har skrevet er ikke borte. Prøv igjen når du har nett.'
        : ex.code === 'conflict' ? 'Noen andre har endret kontaktinformasjonen mens du hadde siden åpen. Last siden på nytt for å se det som gjelder nå.'
        : ex.code === 'forbidden' ? 'Du har ikke tilgang til å gjøre dette.'
        : ex.code === 'dup' ? `Det venter allerede en endring på «${FIELD_LABEL[ex.field]}». Vent til den er godkjent eller avvist.`
        : 'Noe gikk galt, og endringen ble ikke lagret. Prøv igjen.';
      err.innerHTML = ICON.warn + esc(m); err.hidden = false;
    }
  });
}

function viewNotFound(){
  app.innerHTML = `<header class="page-head"><h1 id="page-title" tabindex="-1">Fant ikke siden</h1></header>
    <p class="hint">Lenken kan være feil, eller fartøyet er fjernet.</p><p style="margin-top:16px"><a class="btn btn-primary" href="#sok">Gå til søket</a></p>`;
}

/* =====================================================================
   GLOBALE HENDELSER
   ===================================================================== */
document.addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (c){ e.preventDefault(); copyText(c.dataset.copy, c.dataset.label || 'Teksten'); return; }
  const vb = e.target.closest('[data-vbadge]');
  if (vb){ const ex = document.getElementById(vb.getAttribute('aria-controls')); if (ex){ ex.hidden = !ex.hidden; vb.setAttribute('aria-expanded', String(!ex.hidden)); } return; }
  const t = e.target.closest('[data-try]');
  if (t){ const input = document.getElementById('q'); if (input){ input.value = t.dataset.try; input.dispatchEvent(new Event('input')); input.focus(); } }
});
document.getElementById('reset-demo').addEventListener('click', () => {
  db = clone(SEED); save(); state.query = ''; toast('Demodata er tilbakestilt'); go('sok');
});
/* Nye meldinger: andre faner (og senere sanntid fra backend) oppdaterer dashbordet.
   BACKEND: bytt ut med f.eks. Supabase Realtime på tabellen reports, filtrert på rederiet. */
function onDataChanged(before){
  const u = auth.current();
  renderNav();
  if (!u) return;
  const after = api.openReportCount(u);
  if (after > before) toast(after - before === 1 ? 'Ny innmeldt feil' : `${after - before} nye innmeldte feil`);
  if (state.lastRoute === 'dash'){
    const busy = document.querySelector('.inline-edit, .modal-backdrop') || [...document.querySelectorAll('.reject-panel, .verify-panel')].some(p => !p.hidden);
    if (busy) state.pendingRefresh = true; else viewDashboard();
  }
}
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY) return;
  const u = auth.current(); const before = u ? api.openReportCount(u) : 0;
  db = load(); onDataChanged(before);
});
document.getElementById('simulate-report').addEventListener('click', () => {
  toast('Sender en testmelding om litt …');
  setTimeout(() => {
    const u = auth.current(); const before = u ? api.openReportCount(u) : 0;
    const v = api.getVessel('froyfjord');
    const sug = '+47000113' + String(Math.floor(10 + Math.random() * 89));
    db.reports.push({ id:'r'+Date.now(), vesselId:v.id, field:'bridgePhone', reason:'Fartøyet har fått nytt nummer', current:v.bridgePhone,
      suggested:sug, details:'Testmelding fra demo-knappen.', contact:'', at:nowISO(), status:'new' });
    save(); onDataChanged(before);
  }, 1500);
});

const offlineBar = document.getElementById('offline');
const syncOnline = () => { offlineBar.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline); window.addEventListener('offline', syncOnline); syncOnline();


/* =====================================================================
   SUPABASE — brukes når siden er satt opp med Supabase-nøkler.
   All tilgangssjekk skjer i databasefunksjonene (supabase/migrations). Nettleseren laster aldri hele
   fartøyregisteret: søket skjer i databasen, og bare fartøyene som vises hentes. De sist viste
   fartøyene lagres lokalt, så siden virker med dårlig eller ingen dekning om bord.
   ===================================================================== */
const CACHE_KEY = 'fartoykontakt-kort-v2';
const CACHE_MAX = 300;   // fartøy som lagres lokalt
try { localStorage.removeItem('fartoykontakt-katalog-v1'); } catch(e){}   // gammel kopi av hele katalogen
const cache = { seen: new Map(), pinned: new Set(), adminHistory: [], recentIds: [], exampleIds: [] };

async function remoteRpc(name, args){
  let res;
  try { res = await sb.rpc(name, args || {}); }
  catch(e){ throw fail('offline'); }
  const { data, error } = res;
  if (error){
    const msg = String(error.message || '').trim();
    if (/fetch|network|Load failed/i.test(msg) || !navigator.onLine) throw fail('offline');
    if (msg.startsWith('dup:')){ const e = fail('dup'); e.field = msg.slice(4); throw e; }
    if (/^[a-z]+$/.test(msg)) throw fail(msg);
    console.error('Supabase:', name, error);
    throw fail('error');
  }
  return data;
}

/* Legger fartøykort fra databasen inn i den lokale kopien (erstatter det som var der for de samme fartøyene) */
function mergeCards(cards, opts = {}){
  if (!cards) return;
  const vids = new Set((cards.vessels || []).map(v => v.id));
  const cids = new Set((cards.companies || []).map(c => c.id));
  const upsert = (list, items) => { const m = new Map(list.map(x => [x.id, x])); for (const x of items || []) m.set(x.id, x); return [...m.values()]; };
  db.companies = upsert(db.companies, cards.companies);
  db.vessels = upsert(db.vessels, cards.vessels);
  db.verifications = [...db.verifications.filter(x => !(x.scope === 'vessel' ? vids.has(x.scopeId) : cids.has(x.scopeId))), ...(cards.verifications || [])];
  db.publicHistory = [...db.publicHistory.filter(h => !vids.has(h.vesselId)), ...(cards.numberInfo || [])];
  const now = Date.now();
  for (const id of vids){ cache.seen.set(id, now); if (opts.pin) cache.pinned.add(id); }
  rebuildHistory();
  if (!opts.noSave) saveCache();
}
function rebuildHistory(){
  const own = new Set(cache.adminHistory.map(h => h.id));
  db.numberHistory = [...db.publicHistory.filter(h => !own.has(h.id)), ...cache.adminHistory];
}
/* Lagrer de sist brukte fartøyene lokalt (begrenset antall) */
function saveCache(){
  try {
    const keep = new Set([...cache.recentIds, ...cache.exampleIds,
      ...[...cache.seen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)].slice(0, CACHE_MAX));
    const vessels = db.vessels.filter(v => keep.has(v.id));
    const cids = new Set(vessels.map(v => v.companyId));
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      at: Date.now(), settings: db.settings, recentIds: cache.recentIds, exampleIds: cache.exampleIds,
      seen: vessels.map(v => [v.id, cache.seen.get(v.id) || 0]),
      cards: { vessels, companies: db.companies.filter(c => cids.has(c.id)),
        verifications: db.verifications.filter(x => x.scope === 'vessel' ? keep.has(x.scopeId) : cids.has(x.scopeId)),
        numberInfo: db.publicHistory.filter(h => keep.has(h.vesselId)) }
    }));
  } catch(e){}
}
function loadCache(){
  let c; try { c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch(e){ c = null; }
  if (!c || !c.cards) return false;
  db.settings = c.settings || db.settings;
  cache.recentIds = c.recentIds || []; cache.exampleIds = c.exampleIds || [];
  mergeCards(c.cards, { noSave: true });
  for (const [id, t] of c.seen || []) cache.seen.set(id, t);
  return true;
}

/* Forsiden: innstillinger, fartøy som nylig har byttet nummer og dagens eksempler */
async function loadHome(){
  try {
    const d = await remoteRpc('get_home');
    db.settings = d.settings || { verifyMonths: 6 };
    cache.recentIds = d.recentIds || []; cache.exampleIds = d.exampleIds || [];
    mergeCards(d);
    state.fromCache = false;
  } catch(e){
    if (!loadCache()) throw e;
    state.fromCache = true;
  }
}

/* Henter ett fartøy (for eksempel fra en delt lenke) når det ikke finnes i den lokale kopien */
async function fetchVessel(id){
  const d = await remoteRpc('get_vessel_public', { p_id: id });
  mergeCards(d);
  return api.getVessel(id);
}
/* Fartøyprofilen vises straks fra lokal kopi; ferske data hentes i bakgrunnen */
function refreshVesselInBackground(id){
  const before = JSON.stringify([api.getVessel(id), db.verifications.filter(x => x.scopeId === id)]);
  const hash = location.hash;
  remoteRpc('get_vessel_public', { p_id: id }).then(d => {
    mergeCards(d);
    const after = JSON.stringify([api.getVessel(id), db.verifications.filter(x => x.scopeId === id)]);
    if (after !== before && location.hash === hash) route();
  }).catch(() => {});
}
async function routeWhenLoaded(id, hash){
  app.innerHTML = `<div style="padding:40px 0;text-align:center" role="status"><div class="spinner"></div><p class="hint" style="margin-top:12px">Henter fartøy …</p></div>`;
  let v = null;
  try { v = await fetchVessel(id); } catch(e){ if (e.code === 'offline' && location.hash === hash){ app.innerHTML = `<div class="empty"><h2>Du er uten nett</h2><p>Fartøyet er ikke lagret på denne enheten. Prøv igjen når du har dekning.</p></div>`; return; } }
  if (location.hash !== hash) return;
  if (!v) return viewNotFound();
  state.fetched = id; route(); state.fetched = null;
}

async function loadAdmin(){
  const { data: { session } } = await sb.auth.getSession();
  const clear = () => { Object.assign(db, { reports:[], changes:[], outbox:[] }); cache.adminHistory = []; cache.pinned.clear(); rebuildHistory(); };
  if (!session){ db.session = null; db.users = {}; clear(); return; }
  const ctx = await remoteRpc('my_context');
  if (!ctx){ db.session = null; return; }
  db.users = { [ctx.id]: ctx };
  db.session = ctx.id;
  if (ctx.role === 'none'){ clear(); return; }
  const a = await remoteRpc('get_admin_data');
  db.reports = a.reports; db.changes = a.changes; db.outbox = a.outbox;
  for (const u of a.users) if (!db.users[u.id]) db.users[u.id] = u;
  cache.adminHistory = a.numberHistory || [];
  cache.pinned.clear();
  mergeCards(a.cards, { pin: true });
}

async function refreshAll(){ await loadHome(); await loadAdmin(); renderNav(); }

function installRemote(){
  // Lesing
  api.search = async q => {
    let r;
    try { r = await remoteRpc('search_directory', { q }); }
    catch(e){ return searchLocal(q); }   // uten nett: søk i fartøyene som er lagret på enheten
    mergeCards(r);
    const ids = r.ids || [];
    const res = searchLocal(q, r.history, new Set(ids));
    // Treff databasen fant (for eksempel med skrivefeil) som det enkle lokale søket ikke kjenner igjen
    const have = new Set(res.results.map(x => x.v.id));
    for (const id of ids){
      const v = api.getVessel(id);
      if (v && !have.has(id)) res.results.push({ v, c: api.company(v.companyId), field:'name', fuzzy:true, score:1 });
    }
    res.fuzzy = res.results.length > 0 && res.results.every(x => x.fuzzy);
    return res;
  };
  // Skriving — hver funksjon sjekker tilgang i databasen, deretter hentes ferske data
  api.report = async (vesselId, d) => {
    await remoteRpc('submit_report', { p_vessel: vesselId, p_field: d.field || null, p_reason: d.reason, p_suggested: d.suggested || null, p_details: d.details || '', p_contact: d.contact || '' });
  };
  api.submitChange = async (vesselId, fields, showPrevious) => {
    const r = await remoteRpc('submit_change', { p_vessel: vesselId, p_changes: fields.map(f => ({ field: f.field, from: f.from || '', to: f.to || '' })), p_show_previous: !!showPrevious });
    await refreshAll();
    return { published: r.published, count: fields.length };
  };
  api.verifyVessel = async (vesselId, { expected, edits } = {}) => {
    const r = await remoteRpc('verify_vessel', { p_vessel: vesselId, p_expected: expected || {}, p_edits: edits || {} });
    await refreshAll();
    return { changed: r.changed || [] };
  };
  api.confirm = (vesselId, user, expected) => api.verifyVessel(vesselId, { expected, edits: {} });
  api.decide = async (changeId, approve) => { await remoteRpc('decide_change', { p_change: changeId, p_approve: approve }); await refreshAll(); };
  api.acceptReport = async (reportId, { value, expected, showPrevious }) => {
    const r = await remoteRpc('accept_report', { p_report: reportId, p_value: value, p_expected: expected || '', p_show_previous: !!showPrevious });
    await refreshAll();
    return { value: r.value, verified: r.verified };
  };
  api.rejectReport = async (reportId, reason) => { await remoteRpc('reject_report', { p_report: reportId, p_reason: reason || '' }); await refreshAll(); };
  api.setNumberStatus = async (historyId, status) => { await remoteRpc('set_number_status', { p_history: historyId, p_status: status }); await refreshAll(); };
  api.setVerifyMonths = async months => { await remoteRpc('set_verify_months', { p_months: Number(months) }); await refreshAll(); };

  auth.signOut = () => {
    Object.assign(db, { session:null, users:{}, reports:[], changes:[], outbox:[] });
    cache.adminHistory = []; cache.pinned.clear(); rebuildHistory();
    sb.auth.signOut().catch(() => {});
  };
  registry.lookupOrg = async orgnr => {
    const known = db.companies.find(c => c.orgnr === orgnr);
    if (known) return { orgnr, name: known.name };
    try {
      // Åpent API fra Brønnøysundregistrene
      const r = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}`);
      if (r.ok){ const j = await r.json(); return { orgnr, name: j.navn }; }
    } catch(e){}
    throw fail('notfound');
  };
}

/* Innlogging med e-postlenke (BankID kommer senere) */
function viewLoginRemote(forRegister){
  state.lastRoute = 'login';
  if (auth.current()) return go('mine-fartoy');
  const claim = forRegister && location.hash.startsWith('#be-om-tilgang-') ? currentClaim() : null;
  app.innerHTML = `
    ${claim ? `<a class="back" href="#fartoy-${esc(claim.vesselId)}">${ICON.back}Tilbake til ${esc(claim.vesselName)}</a>` : ''}
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">${claim ? `Be om tilgang til ${esc(claim.vesselName)}` : forRegister ? 'Registrer rederiet' : 'Logg inn for rederier'}</h1>
      <p class="sub">${forRegister ? 'Logg inn med e-post først. Deretter ber du om tilgang til rederiet.' : 'Her kan rederier oppdatere telefonnummer og e-post for egne fartøy. Du trenger ikke logge inn for å søke.'}</p>
    </header>
    <form class="card stack" id="otp-form" novalidate>
      <div class="field">
        <label for="otp-email">Din e-postadresse</label>
        <input class="input" id="otp-email" type="email" inputmode="email" autocomplete="email" required>
        <p class="hint">Vi sender deg en lenke. Åpne den på denne enheten og i denne nettleseren.</p>
        <p class="err" id="otp-err" hidden></p>
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="otp-send" style="min-height:56px;font-size:18px">Send innloggingslenke</button>
      <div class="notice notice-info">${ICON.info}<p>I testperioden logger du inn med e-post. Senere brukes BankID. At du kan representere rederiet, sjekker vi i tillegg.</p></div>
    </form>
    ${forRegister ? '' : `<p class="hint" style="margin-top:18px;text-align:center">Er ikke rederiet ditt registrert? <a href="#registrer-rederi">Registrer rederiet</a></p>`}`;
  document.getElementById('otp-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = document.getElementById('otp-email'), err = document.getElementById('otp-err'), btn = document.getElementById('otp-send');
    const email = input.value.trim();
    if (!validEmail(email)){ err.innerHTML = ICON.warn + 'E-postadressen ser ikke riktig ut. Den skal se slik ut: navn@firma.no'; err.hidden = false; input.focus(); return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Sender …';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    if (error){
      btn.disabled = false; btn.textContent = 'Send innloggingslenke';
      err.innerHTML = ICON.warn + esc(/rate|seconds/i.test(error.message) ? 'Det er sendt mange lenker på kort tid. Vent litt og prøv igjen.' : 'Vi fikk ikke sendt e-posten. Prøv igjen om litt.');
      err.hidden = false; return;
    }
    app.innerHTML = `<header class="page-head"><h1 id="page-title" tabindex="-1">Sjekk e-posten din</h1></header>
      <div class="card stack">
        <div class="notice notice-ok">${ICON.ok}<p>Vi har sendt en innloggingslenke til <strong>${esc(email)}</strong>.</p></div>
        <p class="hint">Åpne lenken på denne enheten. Finner du den ikke, se i søppelpost.</p>
        <div class="form-actions"><a class="btn btn-secondary" href="#sok">Til søket</a></div>
      </div>`;
    focusTitle();
  });
}

/* Innlogget, men ikke knyttet til et rederi ennå */
function viewNoAccess(u){
  state.lastRoute = 'noaccess';
  const pending = u.pendingRequest || state.requestSent;
  const claim = pending ? null : currentClaim();
  app.innerHTML = `
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">${pending ? 'Venter på godkjenning' : 'Be om tilgang til rederiet'}</h1>
      <p class="sub">Logget inn som ${esc(u.email || u.name)}</p>
    </header>
    ${pending ? `<div class="card stack">
        <div class="notice notice-warn">${ICON.clock}<p><strong>Søknaden din er sendt</strong>Vi sjekker at du kan representere rederiet. Du får beskjed når du har fått tilgang.</p></div>
        <div class="form-actions"><a class="btn btn-secondary" href="#sok">Til søket</a><button type="button" class="btn btn-ghost" id="logout">Logg ut</button></div>
      </div>` : `
    <form class="card stack" id="req-form" novalidate>
      <div class="field"><label for="req-name">Fullt navn</label><input class="input" id="req-name" autocomplete="name" maxlength="120"></div>
      ${claim ? `<div class="notice notice-info">${ICON.info}<p>Søknaden gjelder fartøyet <b>${esc(claim.vesselName)}</b>. <button type="button" class="linkbtn" id="claim-clear">Fjern</button></p></div>` : ''}
      <div class="field"><label for="req-org">Organisasjonsnummer til rederiet</label><input class="input" id="req-org" inputmode="numeric" maxlength="11" placeholder="9 siffer" value="${esc(claim && claim.orgnr ? claim.orgnr : '')}">
        <p class="hint" id="req-org-name"></p></div>
      <fieldset><legend class="legend">Din rolle i rederiet</legend><div class="choices">
        <label class="choice"><input type="radio" name="basis" value="signatur"><span>Jeg er daglig leder eller har signaturrett<small>Vi sjekker dette mot Enhetsregisteret.</small></span></label>
        <label class="choice"><input type="radio" name="basis" value="fullmakt"><span>Jeg har fullmakt fra rederiet<small>Daglig leder må bekrefte.</small></span></label>
      </div></fieldset>
      <p class="err" id="req-err" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit" id="req-send">Send søknad</button><button type="button" class="btn btn-ghost" id="logout">Logg ut</button></div>
    </form>`}`;
  document.getElementById('logout')?.addEventListener('click', () => { auth.signOut(); toast('Du er logget ut'); go('sok'); });
  const dropClaim = () => { state.claim = null; try { localStorage.removeItem(CLAIM_KEY); } catch(e){} };
  document.getElementById('claim-clear')?.addEventListener('click', () => { dropClaim(); viewNoAccess(u); });
  const org = document.getElementById('req-org');
  if (org && org.value) setTimeout(() => org.dispatchEvent(new Event('change')), 0);
  org?.addEventListener('change', async () => {
    const o = digits(org.value); const out = document.getElementById('req-org-name');
    if (o.length !== 9){ out.textContent = ''; return; }
    out.textContent = 'Søker …';
    try { out.textContent = (await registry.lookupOrg(o)).name; } catch(e){ out.textContent = 'Fant ikke rederiet i registeret. Sjekk nummeret.'; }
  });
  document.getElementById('req-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('req-err'), btn = document.getElementById('req-send');
    const name = document.getElementById('req-name').value.trim(), o = digits(org.value), basis = document.querySelector('input[name="basis"]:checked');
    const msg = !name ? 'Skriv inn navnet ditt.' : o.length !== 9 ? 'Organisasjonsnummeret må ha 9 siffer.' : !basis ? 'Velg din rolle i rederiet.' : '';
    if (msg){ err.innerHTML = ICON.warn + msg; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Sender …';
    try { await remoteRpc('request_access', { p_orgnr: o, p_basis: basis.value, p_full_name: name, p_vessel: claim ? claim.vesselId : null }); dropClaim(); state.requestSent = true; viewNoAccess(u); focusTitle(); }
    catch(ex){ btn.disabled = false; btn.textContent = 'Send søknad'; err.innerHTML = ICON.warn + (ex.code === 'offline' ? 'Du er uten nett. Prøv igjen.' : 'Noe gikk galt. Prøv igjen.'); err.hidden = false; }
  });
}

/* Henter nye meldinger jevnlig når en administrator har dashbordet åpent.
   Senere kan dette byttes til Supabase Realtime på tabellen reports. */
function startPolling(){
  setInterval(async () => {
    if (document.hidden || !db.session || state.lastRoute !== 'dash') return;
    const u = auth.current(); const before = u ? api.openReportCount(u) : 0;
    try { await loadAdmin(); onDataChanged(before); } catch(e){}
  }, 30000);
}

async function boot(){
  if (!REMOTE){ route(); return; }
  installRemote();
  document.getElementById('simulate-report')?.remove();
  document.getElementById('reset-demo')?.remove();
  const foot = document.querySelector('.site-foot p');
  if (foot) foot.innerHTML = 'Fartøykontakt er under testing. Telefonnumre og e-post legges inn og bekreftes av rederiene selv.';
  const src = document.getElementById('source-note'); if (src) src.hidden = false;
  app.innerHTML = `<div style="padding:40px 0;text-align:center" role="status"><div class="spinner"></div><p class="hint" style="margin-top:12px">Henter fartøy …</p></div>`;
  try { await loadHome(); }
  catch(e){
    app.innerHTML = `<div class="empty"><h2>Får ikke kontakt med Fartøykontakt</h2><p>Sjekk at du har nett, og prøv igjen.</p><p style="margin-top:14px"><button class="btn btn-primary" type="button" onclick="location.reload()">Prøv igjen</button></p></div>`;
    return;
  }
  try { await loadAdmin(); } catch(e){ console.error(e); }
  sb.auth.onAuthStateChange(event => {
    if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
    state.requestSent = false;
    setTimeout(async () => {
      if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
      try { await refreshAll(); } catch(e){}
      if (event === 'SIGNED_IN' && (!location.hash || ['#sok', '#logg-inn', '#registrer-rederi'].includes(location.hash))) go('mine-fartoy');
      else route();
    }, 0);
  });
  if (state.fromCache) document.getElementById('offline').hidden = false;
  startPolling();
  route();
}

/* =====================================================================
   FARTØYREGISTER (plattformadministrator, bare med Supabase)
   Synkroniseringen kjører på serveren (Edge Function «registry-sync») hver natt kl. 04:00, eller når
   en plattformadministrator trykker på knappen. Nettleseren sender bare innloggingstokenet; tilgangen
   sjekkes på serveren. Første import må godkjennes etter en forhåndsvisning.
   ===================================================================== */
const ORG_SUFFIX = /\b(As|Asa|Ans|Da|Sa|Ks|Ba|Nuf|Iks)\b/g;
function titleCase(s){
  return String(s || '').trim().toLowerCase()
    .replace(/(^|[\s\-.\/(&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(ORG_SUFFIX, w => w.toUpperCase())
    .replace(/\s(i{2,3}|iv|vi{1,3}|ix|xi{1,2})$/i, w => w.toUpperCase());   // «Vardøyfisk Ii» → «Vardøyfisk II»
}

async function callRegistryFunction(body){
  let res;
  try { res = await sb.functions.invoke('registry-sync', { body }); }
  catch(e){ throw fail('offline'); }
  if (!res.error) return res.data;
  let code = 'error';
  try { const j = await res.error.context.json(); code = j.error || code; } catch(e){ if (!navigator.onLine) code = 'offline'; }
  throw fail(code);
}

const RUN_STATUS = { running:'Pågår', preview_ready:'Venter på godkjenning', completed:'Fullført', failed:'Feilet', superseded:'Erstattet av nyere kjøring' };
const REVIEW_KIND = { owner_change:'Eierskifte', ambiguous_match:'Manuell kobling', missing:'Ikke lenger i registeret', validation:'Feil i data fra kilden' };
const n0 = n => Number(n || 0).toLocaleString('nb-NO');
function fmtStamp(iso){
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('nb-NO', { day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Oslo' }) + ' kl. ' + d.toLocaleTimeString('nb-NO', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Oslo' });
}

async function viewRegistry(){
  state.lastRoute = 'registry';
  const u = requireUser(); if (!u) return;
  if (location.hash === '#importer') history.replaceState(null, '', '#fartoyregister');
  if (!REMOTE || !(u.platform || u.role === 'platform')){
    app.innerHTML = `<header class="page-head"><h1 id="page-title" tabindex="-1">Ikke tilgang</h1></header><p class="hint">Bare plattformadministratorer har tilgang til fartøyregisteret.</p>`;
    return;
  }
  const first = !app.querySelector('#reg-root');
  if (first) app.innerHTML = `<div id="reg-root"><div style="padding:40px 0;text-align:center" role="status"><div class="spinner"></div></div></div>`;
  let o;
  try { o = await remoteRpc('registry_overview'); }
  catch(e){
    if (state.lastRoute !== 'registry') return;
    document.getElementById('reg-root').innerHTML = `<div class="empty"><h2>Fikk ikke hentet status</h2><p>${e.code === 'offline' ? 'Du er uten nett.' : 'Prøv igjen om litt.'}</p></div>`;
    return;
  }
  if (state.lastRoute !== 'registry' || !document.getElementById('reg-root')) return;
  let preview = null;
  if (o.preview && !o.running){ try { preview = await remoteRpc('registry_preview', { p_run: o.preview.id }); } catch(e){} }
  renderRegistry(o, preview);
  clearTimeout(state.regTimer);
  if (o.running) state.regTimer = setTimeout(() => { if (state.lastRoute === 'registry') viewRegistry(); }, 4000);
}

function renderRegistry(o, preview){
  const last = o.last, lc = (last && last.counts) || {};
  const run = o.running;
  const rv = o.openReviews || {};
  const stat = (label, val, hint) => `<div class="stat"><span class="stat-v">${val}</span><span class="stat-k">${label}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const status = run ? `<div class="notice notice-info" role="status">${ICON.clock}<p><strong>${run.mode === 'preview' ? 'Lager forhåndsvisning' : 'Synkroniserer'} …</strong>Hentet ${n0(run.fetched)}${run.source_total ? ` av ${n0(run.source_total)}` : ''} fartøy. Startet ${esc(fmtStamp(run.started_at))}.</p></div>`
    : o.lastFailed ? `<div class="notice notice-err">${ICON.warn}<p><strong>Siste synkronisering feilet</strong>${esc(fmtStamp(o.lastFailed.started_at))}: ${esc(o.lastFailed.error || 'ukjent feil')}. Opplysningene fra forrige vellykkede synkronisering beholdes.</p></div>`
    : last ? `<div class="notice notice-ok">${ICON.ok}<p><strong>Synkronisert</strong>${esc(fmtStamp(last.finished_at))}</p></div>`
    : '';
  const list = (title, items, fmt) => items && items.length ? `<details class="history"><summary>${title} (${items.length}${items.length >= 25 ? '+' : ''})</summary><ul class="reg-list">${items.map(x => `<li>${fmt(x)}</li>`).join('')}</ul></details>` : '';
  const pv = o.preview && !run ? o.preview.counts || {} : null;

  document.getElementById('reg-root').innerHTML = `
    <a class="back" href="#mine-fartoy">${ICON.back}Tilbake</a>
    <header class="page-head">
      <h1 id="page-title" tabindex="-1">Fartøyregister</h1>
      <p class="sub">Synkronisering med Fiskeridirektoratets fartøyregister. ${esc(o.schedule || '')}.</p>
    </header>
    ${status}
    <div class="stats">
      ${stat('Fartøy fra registeret', n0(o.imported), o.unlinked ? `${n0(o.unlinked)} ikke koblet ennå` : '')}
      ${stat('Nye', last ? n0(lc.new) : '–', 'siste kjøring')}
      ${stat('Oppdatert', last ? n0(lc.updated) : '–', 'siste kjøring')}
      ${stat('Eierskifter', last ? n0((lc.owner_auto || 0) + (lc.owner_review || 0)) : '–', rv.owner_change ? `${n0(rv.owner_change)} venter` : 'siste kjøring')}
      ${stat('Til manuell kobling', n0(rv.ambiguous_match), '')}
      ${stat('Feil i data', n0(rv.validation), '')}
      ${stat('Ikke lenger i registeret', n0(o.missing), '')}
    </div>

    ${pv ? `<section class="card stack reg-preview" aria-labelledby="pv-h">
      <h2 id="pv-h">${o.initialDone ? 'Forhåndsvisning' : 'Første import: forhåndsvisning'}</h2>
      <p class="hint">Hentet ${esc(fmtStamp(o.preview.finished_at))}. Ingenting er endret ennå. Telefonnumre, e-post og bekreftelser fra rederiene blir aldri endret av importen.</p>
      <ul class="pv-counts">
        <li><strong>${n0(pv.source_total)}</strong> fartøy i Fiskeridirektoratets register</li>
        <li><strong>${n0(pv.link)}</strong> kobles til fartøy som allerede finnes her</li>
        <li><strong>${n0(pv.new)}</strong> nye fartøy</li>
        <li><strong>${n0(pv.updated)}</strong> får oppdaterte registeropplysninger</li>
        <li><strong>${n0(pv.ambiguous)}</strong> uklare treff til manuell kobling</li>
        <li><strong>${n0(pv.owner_review)}</strong> eierskifter til gjennomgang${pv.owner_auto ? `, ${n0(pv.owner_auto)} rederi oppdateres automatisk (fartøy uten brukere)` : ''}</li>
        ${pv.missing != null ? `<li><strong>${n0(pv.missing)}</strong> fartøy her finnes ikke i registeret og merkes (slettes ikke)</li>` : ''}
        ${pv.validation ? `<li><strong>${n0(pv.validation)}</strong> poster med feil hoppes over</li>` : ''}
      </ul>
      ${preview ? `${list('Eksempler på nye fartøy', preview.new, x => `${esc(x.name)} <span class="num hint">${esc(x.reg_nr)}</span>`)}
        ${list('Eksempler på oppdateringer', preview.updated, x => `${esc(x.name)} <span class="num hint">${esc(x.reg_nr)}</span> <span class="hint">${esc(Object.keys(x.diff || {}).join(', '))}</span>`)}
        ${list('Uklare treff', preview.ambiguous, x => `${esc(x.name)} <span class="num hint">${esc(x.reg_nr)}</span> <span class="hint">${esc(x.note || '')}</span>`)}
        ${list('Eierskifter til gjennomgang', preview.owner_review, x => `${esc(x.name)}: ${esc(x.from || '–')} → ${esc(x.to || '–')}`)}
        ${list('Merkes som ikke lenger i registeret', preview.missing, x => `${esc(x.name)} <span class="num hint">${esc(x.reg_nr)}</span>`)}` : ''}
      <p class="err" id="pv-err" hidden></p>
      <div class="form-actions"><button type="button" class="btn btn-primary" id="pv-approve">Godkjenn og importer</button></div>
    </section>` : ''}

    <section class="card stack" style="margin-top:14px">
      <div class="form-actions" style="margin-top:0">
        <button type="button" class="btn ${pv ? 'btn-secondary' : 'btn-primary'}" id="reg-sync" ${run ? 'disabled' : ''}>Synkroniser med Fiskeridirektoratet</button>
      </div>
      <p class="hint">${o.initialDone ? 'Henter hele registeret og oppdaterer registeropplysninger. Kontaktinformasjon fra rederiene endres aldri.' : 'Første gang lages en forhåndsvisning som du må godkjenne før noe lagres.'}</p>
      <p class="err" id="reg-err" hidden></p>
    </section>

    <section class="dash-section" aria-labelledby="rv-h">
      <h2 id="rv-h">Til gjennomgang${o.reviews && o.reviews.length ? ` (${o.reviews.length})` : ''}</h2>
      ${o.reviews && o.reviews.length ? `<ul class="reg-reviews">${o.reviews.map(reviewCard).join('')}</ul>` : `<p class="hint">Ingen saker.</p>`}
    </section>

    <section class="dash-section">
      <details class="history"><summary>Kjøringer (${(o.runs || []).length})</summary>
        <ul class="timeline">${(o.runs || []).map(r => `<li><time datetime="${esc(r.started_at)}">${esc(fmtStamp(r.started_at))}</time>
          ${r.mode === 'preview' ? 'Forhåndsvisning' : 'Synkronisering'} (${r.trigger === 'schedule' ? 'automatisk' : 'manuell'}): ${esc(RUN_STATUS[r.status] || r.status)}
          ${r.counts && r.counts.staged != null ? ` · ${n0(r.counts.staged)} hentet, ${n0(r.counts.new)} nye, ${n0(r.counts.updated)} oppdatert` : ''}${r.error ? ` · ${esc(r.error)}` : ''}</li>`).join('')}</ul>
      </details>
    </section>

    <section class="card stack" style="margin-top:14px">
      <h2>Navn fra Brønnøysundregistrene</h2>
      <p class="hint">Hentes automatisk etter hver import. Her kan du hente navn og status (for eksempel konkurs eller slettet) for rederier som ikke er sjekket ennå.</p>
      <div id="brreg-status"></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" id="brreg-run">Hent navn fra Enhetsregisteret</button></div>
    </section>

    <p class="source">Kilde for fartøyopplysninger: Fiskeridirektoratet, under <a href="https://data.norge.no/nlod/no/2.0" target="_blank" rel="noopener">NLOD</a>.</p>`;
  bindRegistry(o);
}

function reviewCard(r){
  const d = r.details || {};
  let body = '', actions = '';
  if (r.kind === 'owner_change'){
    body = `<p>Registrert eier er endret fra <strong>${esc(d.from_name || '–')}</strong> til <strong>${esc(d.to_name || '–')}</strong>.</p>
      <p class="hint">Fartøyet forvaltes av brukere i dagens rederi. Tilgang flyttes aldri automatisk. Velg «Behold» hvis rederiet forvalter fartøyet for eieren.</p>`;
    actions = `<button type="button" class="btn btn-secondary btn-sm" data-rv="${r.id}" data-act="keep">Behold ${esc(d.from_name || 'dagens rederi')}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-rv="${r.id}" data-act="switch">Flytt til ${esc(d.to_name || 'ny eier')}</button>`;
  } else if (r.kind === 'ambiguous_match'){
    const rec = d.record || {};
    body = `<p>${esc(rec.name || '')} <span class="num hint">${esc(rec.reg_nr || '')}${rec.callsign ? ' · ' + esc(rec.callsign) : ''}</span> (FARTOY_ID <span class="num">${esc(r.external_id)}</span>)</p>
      <p class="hint">${esc(d.note || 'Flere mulige treff.')}</p>`;
    actions = (d.candidates || []).map(c => `<button type="button" class="btn btn-secondary btn-sm" data-rv="${r.id}" data-act="link" data-vessel="${esc(c.id)}">Koble til ${esc(c.name)} (${esc(c.reg_nr || '')}${c.callsign ? ', ' + esc(c.callsign) : ''})</button>`).join('')
      + `<button type="button" class="btn btn-secondary btn-sm" data-rv="${r.id}" data-act="create">Opprett som nytt fartøy</button>`
      + `<button type="button" class="btn btn-ghost btn-sm" data-rv="${r.id}" data-act="dismiss">Avvis</button>`;
  } else if (r.kind === 'missing'){
    body = `<p>${esc(d.name || r.vessel_name || '')} <span class="num hint">${esc(d.reg_nr || r.vessel_reg || '')}</span> finnes ikke lenger i registeret. Fartøyet er merket, ikke slettet.</p>`;
    actions = `<button type="button" class="btn btn-ghost btn-sm" data-rv="${r.id}" data-act="dismiss">Sett som behandlet</button>`;
  } else {
    body = `<p>${esc(d.reason || 'Ugyldig post')}${r.external_id && !r.external_id.startsWith('rad-') ? ` (FARTOY_ID <span class="num">${esc(r.external_id)}</span>)` : ''}</p>`;
    actions = `<button type="button" class="btn btn-ghost btn-sm" data-rv="${r.id}" data-act="dismiss">Sett som behandlet</button>`;
  }
  return `<li class="card reg-review" data-review="${r.id}">
    <span class="pill pill-neutral">${esc(REVIEW_KIND[r.kind] || r.kind)}</span>
    ${r.vessel_id && r.kind !== 'missing' ? `<h3><a href="#fartoy-${esc(r.vessel_id)}">${esc(r.vessel_name || r.vessel_id)}</a></h3>` : ''}
    ${body}
    <div class="form-actions">${actions}</div>
    <p class="err" hidden></p>
  </li>`;
}

const REG_ERR = { busy:'En synkronisering pågår allerede.', forbidden:'Du har ikke tilgang.', offline:'Du er uten nett. Prøv igjen.', stale:'Forhåndsvisningen er for gammel. Lag en ny.',
  conflict:'Fartøyet er endret i mellomtiden. Last siden på nytt.', already:'Saken er allerede behandlet.', incomplete:'Kilden svarte med for få fartøy. Ingenting er endret.' };
function bindRegistry(o){
  const showErr = (el, ex) => { el.innerHTML = ICON.warn + esc(REG_ERR[ex.code] || 'Noe gikk galt. Prøv igjen.'); el.hidden = false; };
  document.getElementById('reg-sync')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Starter …';
    try { await callRegistryFunction({ action: 'sync' }); toast('Synkroniseringen er startet'); viewRegistry(); }
    catch(ex){ b.disabled = false; b.textContent = 'Synkroniser med Fiskeridirektoratet'; showErr(document.getElementById('reg-err'), ex); if (ex.code === 'busy') viewRegistry(); }
  });
  document.getElementById('pv-approve')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Importerer …';
    try {
      const r = await callRegistryFunction({ action: 'approve', runId: o.preview.id });
      toast(`Importert: ${n0(r.counts && r.counts.new)} nye, ${n0(r.counts && r.counts.link)} koblet`);
      await refreshAll(); viewRegistry();
    } catch(ex){ b.disabled = false; b.textContent = 'Godkjenn og importer'; showErr(document.getElementById('pv-err'), ex); }
  });
  app.querySelectorAll('[data-rv]').forEach(b => b.addEventListener('click', async () => {
    const li = b.closest('.reg-review'); li.querySelectorAll('button').forEach(x => x.disabled = true);
    try {
      await remoteRpc('registry_resolve_review', { p_id: Number(b.dataset.rv), p_action: b.dataset.act, p_vessel: b.dataset.vessel || null });
      toast('Saken er behandlet'); viewRegistry();
    } catch(ex){ li.querySelectorAll('button').forEach(x => x.disabled = false); showErr(li.querySelector('.err'), ex); }
  }));
  document.getElementById('brreg-run').addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true;
    const st = document.getElementById('brreg-status');
    try {
      const list = await remoteRpc('companies_to_check');
      if (!list.length){ st.innerHTML = `<p class="hint">Alle rederier er allerede sjekket.</p>`; b.disabled = false; return; }
      let saved = 0;
      for (let i = 0; i < list.length; i += 100){
        const batch = list.slice(i, i + 100);
        st.innerHTML = `<p class="hint" role="status">Henter ${n0(Math.min(i + 100, list.length))} av ${n0(list.length)} …</p>`;
        const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter?organisasjonsnummer=${batch.join(',')}&size=100`);
        if (!res.ok) throw fail('brreg');
        const found = ((await res.json())._embedded || {}).enheter || [];
        const byOrg = new Map(found.map(e => [e.organisasjonsnummer, e]));
        const upd = batch.map(o => {
          const e = byOrg.get(o);
          if (!e) return { orgnr: o, name: '', place: '', status: 'Ikke funnet i Enhetsregisteret' };
          const status = e.slettedato ? 'Slettet' : e.konkurs ? 'Konkurs' : e.underAvvikling || e.underTvangsavviklingEllerTvangsopplosning ? 'Under avvikling' : '';
          return { orgnr: o, name: titleCase(e.navn), place: titleCase((e.forretningsadresse || e.postadresse || {}).poststed || ''), status };
        });
        saved += await remoteRpc('set_company_names', { p_rows: upd });
      }
      st.innerHTML = `<div class="notice notice-ok">${ICON.ok}<p><strong>Ferdig</strong>${n0(saved)} rederier oppdatert med navn fra Enhetsregisteret.</p></div>`;
    } catch(ex){
      st.innerHTML = `<div class="notice notice-err">${ICON.warn}<p>${ex.code === 'brreg' ? 'Fikk ikke svar fra Brønnøysundregistrene. Prøv igjen senere.' : 'Noe gikk galt. Prøv igjen; det som er hentet, er lagret.'}</p></div>`;
    }
    b.disabled = false;
  });
}

boot();
