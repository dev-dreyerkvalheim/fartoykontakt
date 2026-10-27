# Fartøykontakt

Oppdatert kontaktinformasjon til norske fiskefartøy. Søk → finn fartøy → ring.

Dette er en testversjon. Alle fartøy, telefonnumre og e-postadresser i demodataene er oppdiktet.

## Slik er prosjektet bygget

| Del | Hva |
|---|---|
| `index.html`, `src/` | Nettsiden (vanlig JavaScript, bygget med Vite) |
| `supabase/migrations/` | Tabeller, tilgangsregler (RLS) og funksjoner |
| `supabase/seed.sql` | Demodata (oppdiktet) |
| `tests/` | Tester av databasen og hele nettsiden mot en lokal Postgres |

Siden har to modi:

- **Med Supabase** (når `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` er satt): felles data for alle, innlogging med e-postlenke, og all tilgangssjekk i databasen.
- **Lokal demo** (uten nøkler): alt lagres i nettleseren, med demobrukere. Fint for å vise frem uten oppsett.

## Oppsett, steg for steg

### 1. Supabase
1. Lag et nytt prosjekt på [supabase.com](https://supabase.com). Velg en region i EU (for eksempel Stockholm eller Frankfurt).
2. Åpne **SQL Editor** og kjør disse filene i rekkefølge (lim inn innholdet og trykk *Run*):
   1. `supabase/migrations/20261027000001_schema.sql`
   2. `supabase/migrations/20261027000002_functions.sql`
   3. `supabase/seed.sql`
3. Gå til **Authentication → URL Configuration**:
   - *Site URL*: adressen fra Netlify, for eksempel `https://fartoykontakt-demo.netlify.app`
   - *Redirect URLs*: legg til den samme adressen, og `http://localhost:5173` for lokal utvikling.
4. Hent nøklene under **Project Settings → API Keys**: prosjekt-URL og *publishable key*. Bruk aldri *secret key* i nettsiden.

### 2. Netlify
1. **Add new project → Import an existing project → GitHub**, og velg dette repoet. Innstillingene leses fra `netlify.toml`.
2. Under **Site configuration → Environment variables**, legg inn:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Start en ny publisering (*Deploys → Trigger deploy*). Heretter publiseres hver push til `main` automatisk.

### 3. Gjør deg selv til administrator
1. Åpne siden, trykk **Logg inn**, og logg inn med e-postlenken én gang.
2. Kjør i SQL Editor:
   ```sql
   select make_platform_admin('deg@firma.no', 'Ditt Navn');
   ```

### 4. Gi testere tilgang til et rederi
Be testeren logge inn én gang. Kjør så:
```sql
-- roller: 'admin' (kan endre, godkjenne og bekrefte) eller 'member' (kan foreslå endringer)
select grant_membership('tester@firma.no', 'froyanes', 'admin', 'Navn Navnesen');
```
Rederi-id-ene finner du i tabellen `companies`. Søknader om tilgang ligger i tabellen `access_requests`.

## Lokal utvikling
```bash
npm install
cp .env.example .env.local   # fyll inn nøklene, eller la være for lokal demo
npm run dev
npm test                     # tester database og nettside (trenger ikke Supabase)
```

## Viktig å vite i testperioden
- **E-post:** Supabase sin innebygde e-post har lav grense for antall innloggingslenker per time. Skal mange teste samtidig, sett opp egen SMTP under *Authentication → Emails* (for eksempel Resend eller Postmark).
- **Gratisnivå:** Supabase pauser gratisprosjekter som ikke brukes på en stund. Åpne prosjektet i Supabase for å starte det igjen.
- **Varsler** legges i tabellen `outbox`, men sendes ikke ennå. Neste steg er en Edge Function som sender dem.
- **BankID** er ikke koblet til. Innlogging skjer med e-postlenke.
- **Ekte data:** Før ekte telefonnumre og personnavn legges inn trengs personvernerklæring og databehandleravtale med Supabase.

## Sikkerhet i korte trekk
- Nettleseren kan ikke skrive til tabellene direkte. Alle endringer går gjennom databasefunksjoner som sjekker rolle og rederi.
- Innmeldte feil og forslag fra publikum publiseres aldri uten at en administrator godtar dem.
- «Bekreftet av rederiet» lagres per felt med eksakt verdi, tidspunkt fra databasen og hvem som bekreftet. Hvem som bekreftet, vises aldri offentlig.
- Endringer basert på utdatert visning avvises (to administratorer samtidig).
