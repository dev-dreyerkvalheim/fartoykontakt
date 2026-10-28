// Fartøykontakt — henting og vasking av data fra Fiskeridirektoratets fartøyregister.
// Ren JavaScript uten Deno- eller nettleser-API-er, så samme kode brukes i Edge Function og i testene.
//
// Kilde (åpent API, ingen nøkkel, NLOD): https://api.fiskeridir.no/vessel-api/api/v1/vessels
// Dokumentasjon (OpenAPI): https://api.fiskeridir.no/vessel-api/api/openapi
//   GET /vessel-api/api/v1/vessels?page=N&per_page=1..200&sort_by=ID&sort_asc=true
//   Svar: JSON-liste med Vessel { id, name, registrationMark, radioCallSign, municipalityCode, length, width,
//         tonnage, tonnageType, enginePower, engineBuildYear, buildYear, rebuildYear, measureDate,
//         registrationDate, imoNumber, owners: [{ id, entityType: COMPANY|PERSON, name, postalCode, city }] }
//   Topptekst x-totalcount = totalt antall aktive fartøy.

export const VESSEL_API = 'https://api.fiskeridir.no/vessel-api/api/v1/vessels';
export const KOMMUNE_API = 'https://ws.geonorge.no/kommuneinfo/v1/kommuner';
export const BRREG_API = 'https://data.brreg.no/enhetsregisteret/api/enheter';
export const PER_PAGE = 200;
export const USER_AGENT = 'Fartoykontakt/1.0 (+https://dkdrift.no)';

// ---------------------------------------------------------------- Formatering (samme regler som nettsiden)
const ORG_SUFFIX = /\b(As|Asa|Ans|Da|Sa|Ks|Ba|Nuf|Iks)\b/g;
export function titleCase(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/(^|[\s\-.\/(&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(ORG_SUFFIX, w => w.toUpperCase())
    .replace(/\s(i{2,3}|iv|vi{1,3}|ix|xi{1,2})$/i, w => w.toUpperCase());
}

// «N 0056B» / «TR0002NR» / «N-56-B» → «N-56-B» (formatet Fartøykontakt bruker)
export function normRegMark(raw) {
  const m = String(raw || '').toUpperCase().match(/^\s*([A-ZÆØÅ]{1,2})\s*-?\s*0*(\d{1,4})\s*-?\s*([A-ZÆØÅ]{1,3})\s*$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// 14.99 → «14,99 m», 10 → «10 m» (samme som CSV-importen)
export function formatLength(n) {
  if (n === null || n === undefined || n === '' || !isFinite(Number(n))) return '';
  return String(Math.round(Number(n) * 100) / 100).replace('.', ',') + ' m';
}
const numStr = n => (n === null || n === undefined || !isFinite(Number(n))) ? '' : String(Number(n));
const intOrNull = n => (Number.isInteger(n) ? n : (typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : null));
const dateOrNull = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

// ---------------------------------------------------------------- Vasking av ett fartøy
// Returnerer { row } klar for registry_stage, eller { error } som går til gjennomgang.
// Personers navn, ID og adresse fjernes her og sendes aldri til databasen.
export function toStagingRow(v, kommuner) {
  const sample = v && typeof v === 'object' ? { id: v.id ?? null, name: v.name ?? null, registrationMark: v.registrationMark ?? null } : null;
  if (!v || typeof v !== 'object') return { error: { id: null, reason: 'Ugyldig post (ikke et objekt)', sample } };
  const id = typeof v.id === 'string' ? v.id.trim() : (typeof v.id === 'number' ? String(v.id) : '');
  if (!/^\d{10}$/.test(id)) return { error: { id: id || null, reason: 'Mangler gyldig FARTOY_ID (10 siffer)', sample } };
  const name = titleCase(v.name);
  if (!name) return { error: { id, reason: 'Mangler navn', sample } };
  const regNr = normRegMark(v.registrationMark);
  if (!regNr) return { error: { id, reason: `Ukjent format på registreringsmerke: ${String(v.registrationMark || '').slice(0, 20)}`, sample } };
  const code = typeof v.municipalityCode === 'string' && /^\d{4}$/.test(v.municipalityCode) ? v.municipalityCode : null;
  const owners = (Array.isArray(v.owners) ? v.owners : []).map(o => {
    if (o && o.entityType === 'COMPANY' && /^\d{9}$/.test(String(o.id || ''))) {
      return { type: 'COMPANY', orgnr: String(o.id), name: titleCase(o.name), postalCode: /^\d{4}$/.test(String(o.postalCode || '')) ? String(o.postalCode) : '', city: titleCase(o.city) };
    }
    return { type: 'PERSON' };   // personer (og selskaper uten gyldig org.nr.) lagres uten identifiserende data
  });
  return {
    row: {
      id, name, regNr,
      callsign: typeof v.radioCallSign === 'string' ? v.radioCallSign.trim().toUpperCase().slice(0, 8) : '',
      municipalityCode: code || '',
      municipality: code && kommuner && kommuner[code] ? kommuner[code] : '',
      length: formatLength(v.length),
      width: numStr(v.width),
      tonnage: isFinite(Number(v.tonnage)) && v.tonnage !== null && v.tonnage !== undefined ? Number(v.tonnage) : null,
      tonnageType: typeof v.tonnageType === 'string' ? v.tonnageType.slice(0, 4) : '',
      enginePower: intOrNull(v.enginePower),
      buildYear: intOrNull(v.buildYear),
      rebuildYear: intOrNull(v.rebuildYear),
      engineBuildYear: intOrNull(v.engineBuildYear),
      registerDate: dateOrNull(v.registrationDate),
      measureDate: dateOrNull(v.measureDate),
      imo: typeof v.imoNumber === 'string' ? v.imoNumber.trim().slice(0, 12) : '',
      owners
    }
  };
}

// ---------------------------------------------------------------- Henting med begrensede forsøk
// Prøver på nytt ved nettverksfeil, tidsavbrudd, 429 og 5xx: 4 forsøk, ventetid 1 s, 2 s, 4 s (eller Retry-After).
export async function fetchWithRetry(url, { fetchImpl = fetch, sleep, tries = 4, timeoutMs = 15000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try { res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers }, signal: ctrl?.signal }); }
      finally { if (timer) clearTimeout(timer); }
    } catch (e) {
      lastErr = new Error(`Nettverksfeil eller tidsavbrudd mot ${new URL(url).host}: ${e?.name === 'AbortError' ? 'tidsavbrudd' : (e?.message || e)}`);
      res = null;
    }
    if (res && res.ok) return res;
    if (res && !(res.status === 429 || res.status >= 500)) {
      throw new Error(`Uventet svar fra ${new URL(url).host}: HTTP ${res.status}`);
    }
    if (res) lastErr = new Error(`Svar fra ${new URL(url).host}: HTTP ${res.status}`);
    if (attempt < tries) {
      const ra = res && Number(res.headers?.get?.('retry-after'));
      await sleep(ra && ra > 0 && ra < 60 ? ra * 1000 : 1000 * 2 ** (attempt - 1));
    }
  }
  throw lastErr || new Error('Ukjent feil ved henting');
}

// ---------------------------------------------------------------- Hele registeret
// Henter side for side (200 per side, sortert på ID) med en kort pause mellom hver side for å skåne API-et.
export async function fetchAllVessels({ fetchImpl = fetch, sleep, pauseMs = 300, perPage = PER_PAGE, maxPages = 100, onProgress } = {}) {
  const url = p => `${VESSEL_API}?page=${p}&per_page=${perPage}&sort_by=ID&sort_asc=true`;
  const first = await fetchWithRetry(url(1), { fetchImpl, sleep });
  const total = Number(first.headers.get('x-totalcount'));
  if (!Number.isInteger(total) || total <= 0) throw new Error('Kilden oppga ikke antall fartøy (x-totalcount mangler)');
  const firstBody = await first.json();
  if (!Array.isArray(firstBody)) throw new Error('Uventet format fra kilden (forventet en liste)');
  const vessels = [...firstBody];
  const pages = Math.ceil(total / perPage);
  if (pages > maxPages) throw new Error(`Kilden oppga urimelig mange fartøy (${total})`);
  if (onProgress) await onProgress(vessels.length, total);
  for (let p = 2; p <= pages; p++) {
    await sleep(pauseMs);
    const res = await fetchWithRetry(url(p), { fetchImpl, sleep });
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`Uventet format på side ${p}`);
    if (body.length === 0) break;
    vessels.push(...body);
    if (onProgress) await onProgress(vessels.length, total);
  }
  return { total, vessels, url: `${VESSEL_API}?per_page=${perPage}&sort_by=ID&sort_asc=true` };
}

// Kommunenummer → kommunenavn (Kartverket, åpne data). Feiler stille: da beholdes eksisterende navn.
export async function fetchKommuner({ fetchImpl = fetch, sleep } = {}) {
  try {
    const res = await fetchWithRetry(KOMMUNE_API, { fetchImpl, sleep, tries: 2 });
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    const map = {};
    for (const k of list) if (k && /^\d{4}$/.test(k.kommunenummer)) map[k.kommunenummer] = k.kommunenavnNorsk || k.kommunenavn;
    return Object.keys(map).length > 300 ? map : null;
  } catch (e) { return null; }
}

// Vasker alle fartøy: gyldige rader, feil til gjennomgang, og duplikat-ID-er fjernet
export function prepareRows(vessels, kommuner) {
  const rows = [], errors = [], seen = new Set();
  for (const v of vessels) {
    const { row, error } = toStagingRow(v, kommuner);
    if (error) { errors.push(error); continue; }
    if (seen.has(row.id)) continue;
    seen.add(row.id); rows.push(row);
  }
  return { rows, errors };
}

// Navn og status fra Enhetsregisteret for opptil 100 organisasjonsnumre per kall
export async function fetchBrreg(orgnrs, { fetchImpl = fetch, sleep } = {}) {
  const out = [];
  for (let i = 0; i < orgnrs.length; i += 100) {
    const batch = orgnrs.slice(i, i + 100);
    const res = await fetchWithRetry(`${BRREG_API}?organisasjonsnummer=${batch.join(',')}&size=100`, { fetchImpl, sleep, tries: 3 });
    const found = ((await res.json())._embedded || {}).enheter || [];
    const by = new Map(found.map(e => [e.organisasjonsnummer, e]));
    for (const o of batch) {
      const e = by.get(o);
      if (!e) { out.push({ orgnr: o, name: '', place: '', status: 'Ikke funnet i Enhetsregisteret' }); continue; }
      const status = e.slettedato ? 'Slettet' : e.konkurs ? 'Konkurs' : (e.underAvvikling || e.underTvangsavviklingEllerTvangsopplosning) ? 'Under avvikling' : '';
      out.push({ orgnr: o, name: titleCase(e.navn), place: titleCase((e.forretningsadresse || e.postadresse || {}).poststed || ''), status });
    }
    if (i + 100 < orgnrs.length) await sleep(300);
  }
  return out;
}

// ---------------------------------------------------------------- Hele synkroniseringen
// rpc(name, args) kaller databasen med service-rollen og kaster ved feil.
export async function runSync({ rpc, runId, mode, actor, fetchImpl = fetch, sleep, log = () => {} }) {
  try {
    const kommuner = await fetchKommuner({ fetchImpl, sleep });
    if (!kommuner) log('Kommunelisten kunne ikke hentes; eksisterende kommunenavn beholdes');
    const { total, vessels, url } = await fetchAllVessels({
      fetchImpl, sleep, onProgress: (n, t) => rpc('registry_heartbeat', { p_run: runId, p_fetched: n })
    });
    await rpc('registry_set_source', { p_run: runId, p_total: total, p_url: url });
    const { rows, errors } = prepareRows(vessels, kommuner);
    for (let i = 0; i < rows.length; i += 500) await rpc('registry_stage', { p_run: runId, p_rows: rows.slice(i, i + 500) });
    if (errors.length) await rpc('registry_record_errors', { p_run: runId, p_errors: errors.slice(0, 500) });
    let counts = await rpc('registry_analyze', { p_run: runId });
    if (mode === 'apply') counts = await rpc('registry_apply', { p_run: runId, p_actor: actor || null });
    // Navn fra Enhetsregisteret for nye rederier (feiler ikke synkroniseringen)
    if (mode === 'apply') {
      try {
        const orgnrs = await rpc('registry_companies_to_check', { p_limit: 1000 });
        if (orgnrs.length) await rpc('registry_set_company_names', { p_rows: await fetchBrreg(orgnrs, { fetchImpl, sleep }) });
      } catch (e) { log('Brønnøysund: ' + (e?.message || e)); }
    }
    return { ok: true, counts, fetched: vessels.length, staged: rows.length, errors: errors.length };
  } catch (e) {
    const msg = String(e?.message || e);
    try { await rpc('registry_fail_run', { p_run: runId, p_error: msg }); } catch (_) {}
    return { ok: false, error: msg };
  }
}
