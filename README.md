# Fartøykontakt

Oppdatert kontaktinformasjon til norske fiskefartøy. Søk → finn fartøy → ring.

Dette er en testversjon. Fartøyene kommer fra Fiskeridirektoratets fartøyregister. Kontaktinformasjon legges inn av rederiene selv.

## Slik er prosjektet bygget

| Del | Hva |
|---|---|
| `index.html`, `src/` | Nettsiden (vanlig JavaScript, bygget med Vite) |
| `supabase/migrations/` | Tabeller, tilgangsregler (RLS) og funksjoner |
| `supabase/functions/registry-sync/` | Edge Function som synkroniserer med Fiskeridirektoratets fartøyregister |
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
   3. `supabase/migrations/20261027000003_hardening.sql`
   4. `supabase/migrations/20261027000004_register_import.sql`
   5. `supabase/migrations/20261028000005_fiskeridir_sync.sql`
   6. `supabase/migrations/20261028000006_registry_schedule.sql` (nattlig kjøring; krever pg_net, pg_cron og Vault. Endre adressen til Edge Function i filen hvis prosjektet har en annen URL.)
   7. `supabase/migrations/20261028000007_registry_perf.sql`
   8. `supabase/migrations/20261028000008_acting_role.sql` (rollevelger)
   9. `supabase/migrations/20261028000009_company_managers.sql` (forvaltning/management)
   10. `supabase/migrations/20261028000010_manager_badge.sql`
   11. `supabase/migrations/20261028000011_membership_invites.sql` (forhåndsgodkjent tilgang)

   `supabase/seed.sql` inneholder oppdiktede demofartøy og brukes bare i testene og ved lokal utvikling. Ikke kjør den i produksjon.
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
select grant_membership('tester@firma.no', 'org-998076803', 'admin', 'Navn Navnesen');
```
Rederier fra registeret har id `org-<organisasjonsnummer>`. Søknader om tilgang ligger i tabellen `access_requests`.

Har personen ikke logget inn ennå, kan tilgangen gis på forhånd (som plattformadministrator, eller i SQL Editor med `request.jwt.claim.sub` satt til en plattformadministrator):
```sql
select invite_member('kari@firma.no', 'org-998076803', 'admin', 'Kari Nordvik');
```
Tilgangen opprettes automatisk første gang personen bekrefter e-postadressen med innloggingslenken. Åpne invitasjoner ligger i `membership_invites` og kan trekkes tilbake med `revoke_invite(id)`.

### 5. Plattformadministrator som også er med i et rederi
En plattformadministrator kan også få tilgang til et rederi med `grant_membership`. Da vises **«Du jobber som»** øverst på *Mine fartøy*:
- Som **plattformadministrator** (standard): fartøyregisteret og innmeldte feil fra alle rederier. Det du retter her, blir aldri merket «Bekreftet av rederiet».
- Som **rederiet**: samme rettigheter som andre administratorer i rederiet, også «Bekreft kontaktinformasjon». Rettighetene i rederiet gjelder bare mens rederiet er valgt.

Valget lagres i databasen (`acting_roles`) og sjekkes der, ikke i nettleseren. Loggen viser rollen: «Navn (plattformadministrator)» eller navnet i rederiet.

### 6. Forvaltning (management)
Et managementselskap kan forvalte fartøyene til flere eierselskap. Plattformadministrator registrerer det under **Mine fartøy → Forvaltning**: forvalterens org.nr. og org.nr. til rederiene som forvaltes. Finnes ikke forvalteren i Fartøykontakt, opprettes den med navnet fra Enhetsregisteret.
- Brukerne i managementselskapet får samme rettigheter til fartøyene som eierselskapets egne brukere, og varsles om innmeldte feil.
- Fartøyene står fortsatt på eierselskapet. Offentlige sider og synkroniseringen er uendret.
- Forvaltning gis aldri automatisk. Koblinger og fjerning logges i `company_manager_log`.
- Ett nivå: et rederi kan ikke både forvalte og bli forvaltet.

Deretter gis personer tilgang til managementselskapet med `grant_membership` som vanlig.

### 5. Fartøyregisteret (Fiskeridirektoratet)
Fartøyene hentes fra Fiskeridirektoratets åpne API (`https://api.fiskeridir.no/vessel-api/api/v1/vessels`, lisens [NLOD](https://data.norge.no/nlod/no/2.0)).

1. Publiser Edge Function: `supabase functions deploy registry-sync --no-verify-jwt` (funksjonen sjekker selv hvem som kaller).
2. Logg inn som plattformadministrator og gå til **Mine fartøy → Fartøyregister** (`#fartoyregister`).
3. Trykk **Synkroniser med Fiskeridirektoratet**. Første gang lages en forhåndsvisning. Se gjennom tallene og trykk **Godkjenn og importer**.
4. Etter det kjører synkroniseringen automatisk hver natt kl. 04:00 norsk tid (pg_cron kl. 02 og 03 UTC; funksjonen går bare videre når klokken er 04 i Norge).

Regler:
- `FARTOY_ID` er fartøyets faste ID (`vessel_identifiers`, lagret som tekst med ledende nuller). Eksisterende fartøy kobles på registreringsmerke **og** kallesignal eller navn, aldri på navn alene. Uklare treff går til **Til gjennomgang**.
- Synkroniseringen endrer aldri telefonnumre, e-post, gamle numre, innmeldte feil, bekreftelser eller tilganger.
- Eierskifte på et fartøy som er i bruk, blir en sak til gjennomgang. Tilgang flyttes aldri automatisk.
- Fartøy som forsvinner fra registeret, merkes, men slettes ikke. Ved feil eller ufullstendig svar endres ingenting.
- Navn på private eiere lagres ikke.

Kjøre en forhåndsvisning manuelt fra SQL Editor: `select registry_cron_tick(true, 'preview');`

## Lokal utvikling
```bash
npm install
cp .env.example .env.local   # fyll inn nøklene, eller la være for lokal demo
npm run dev
npm test                     # tester database og nettside (trenger ikke Supabase)
```

## Viktig å vite i testperioden
- **E-post:** Innloggingslenker sendes via Resend fra domenet `dkdrift.no` (Supabase: *Authentication → Emails → SMTP Settings*, host `smtp.resend.com`, port 465, brukernavn `resend`). Domenet må være godkjent i Resend før e-post kan sendes.
- **Gratisnivå:** Supabase pauser gratisprosjekter som ikke brukes på en stund. Åpne prosjektet i Supabase for å starte det igjen.
- **Varsler** legges i tabellen `outbox`, men sendes ikke ennå. Neste steg er en Edge Function som sender dem.
- **BankID** er ikke koblet til. Innlogging skjer med e-postlenke.
- **Ekte data:** Før ekte telefonnumre og personnavn legges inn trengs personvernerklæring og databehandleravtale med Supabase.

## Design
Siden følger Dreyer Kvalheims profilmanual (v1.0, 2026): mørk flate (kull `#141414`), salvie `#96AB9A` som eneste aksent, papir `#F5F5F3` til tekst.
Syne til overskrifter og knapper, Poppins til brødtekst og telefonnumre, Playfair Display kursiv som aksent i forsideoverskriften.
Alle farger, fonter og radier er definert som variabler øverst i `src/styles.css`. Fontene ligger i prosjektet (`@fontsource`), så siden henter ingenting fra Google.

## Sikkerhet i korte trekk
- Nettleseren kan ikke skrive til tabellene direkte. Alle endringer går gjennom databasefunksjoner som sjekker rolle og rederi.
- Innmeldte feil og forslag fra publikum publiseres aldri uten at en administrator godtar dem.
- «Bekreftet av rederiet» lagres per felt med eksakt verdi, tidspunkt fra databasen og hvem som bekreftet. Hvem som bekreftet, vises aldri offentlig.
- Endringer basert på utdatert visning avvises (to administratorer samtidig).
- Synkroniseringen bruker service-rollen bare i Edge Function. Nettleseren sender innloggingstoken; rollen sjekkes i databasen. Nattjobben bruker en hemmelighet i Vault.
- Nettleseren laster aldri hele registeret: søket skjer i databasen (`search_directory`).
