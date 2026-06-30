# Mail Automation · BORU studio

Dalle email ai documenti, in automatico. L'utente fa login con Gmail, configura una o più
**parole chiave** da cercare nell'oggetto delle mail, e ogni giorno il sistema:

1. cerca le mail recenti che contengono quelle parole nell'oggetto,
2. legge il contenuto e ne **estrae i dati con l'AI (Claude)**,
3. **genera un PDF** (fattura / preventivo / ordine),
4. lo **archivia** e lo mostra in dashboard.

Nessuna mail viene modificata: l'accesso a Gmail è in **sola lettura**.

---

## Stack

| Parte      | Tecnologie |
|------------|-----------|
| Frontend   | React 19 · Vite · Tailwind v4 · React Router · lucide-react |
| Backend    | Node · Express · TypeScript |
| Gmail      | `googleapis` (OAuth2 + Gmail API, sola lettura) |
| AI         | `@anthropic-ai/sdk` (structured output via JSON Schema) |
| PDF        | `puppeteer` (HTML → PDF) |
| Dati       | `better-sqlite3` (DB locale) + filesystem (`data/pdfs/`) |
| Scheduler  | `node-cron` (scan giornaliero) |

Monorepo con npm workspaces: `apps/web` (frontend) e `apps/server` (backend).

```
mail-automation/
├── apps/web      # frontend
├── apps/server   # backend
├── data/         # app.db + pdfs/  (creato a runtime, gitignored)
└── .env          # secret (da creare, gitignored)
```

---

## Prerequisiti

- **Node 24+** (vedi `.nvmrc`)
- Un **account Google** per il login (anche personale)
- Una **API key Anthropic** → https://console.anthropic.com/

---

## 1. Configurare Google Cloud (OAuth + Gmail API)

> Serve una volta sola. In modalità "testing" puoi aggiungere fino a 100 utenti a mano,
> senza il processo di verifica Google.

1. Vai su **https://console.cloud.google.com/** e crea un nuovo **progetto** (es. "Mail Automation").
2. **API e servizi → Libreria** → cerca **Gmail API** → **Abilita**.
3. **API e servizi → Schermata consenso OAuth**:
   - Tipo utente: **Esterno** → Crea.
   - Compila nome app, email di supporto, email di contatto.
   - **Ambiti (scopes)**: aggiungi `.../auth/gmail.readonly` (oltre a `openid`, `email`, `profile`).
   - **Utenti di test**: aggiungi l'indirizzo Gmail con cui farai login (e quelli dei pilota).
   - Salva. Lascia lo stato su **"Testing"**.
4. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**:
   - Tipo di applicazione: **Applicazione web**.
   - **URI di reindirizzamento autorizzati**: aggiungi esattamente
     ```
     http://localhost:4000/auth/google/callback
     ```
   - Crea, poi copia **Client ID** e **Client secret**.

---

## 2. Configurare le variabili d'ambiente

Dalla root del progetto:

```bash
cp .env.example .env
```

Apri `.env` e compila:

- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` → dal passo 1.
- `GOOGLE_REDIRECT_URI` → lascialo `http://localhost:4000/auth/google/callback`.
- `ANTHROPIC_API_KEY` → la tua key Anthropic.
- `SESSION_SECRET` → una stringa lunga e casuale.
- `TOKEN_ENC_KEY` → genera 32 byte hex con:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

---

## 3. Installare e avviare

```bash
npm install        # installa tutti i workspace (scarica anche Chromium per Puppeteer)
npm run dev        # avvia backend (:4000) e frontend (:5273) insieme
```

Apri **http://localhost:5273**.

> `npm run dev:server` / `npm run dev:web` per avviarli separatamente.

---

## 4. Usare il prodotto

1. **Accedi con Google** (usa un account aggiunto come utente di test).
   - Vedrai un avviso "app non verificata": è normale in modalità testing → *Avanzate → Vai all'app*.
2. Vai su **Parole chiave** e aggiungi un termine (es. `preventivo`) col tipo di documento.
3. Inviati una mail di prova con quell'oggetto e un corpo realistico
   (cliente, righe, importi).
4. Torna in **Documenti** e premi **Scansiona ora**.
5. Il PDF generato appare in dashboard: **Anteprima** / **Scarica**.

Lo scan automatico gira ogni giorno alle **07:00** (Europe/Rome). Il bottone "Scansiona ora"
serve per testare subito.

---

## Note tecniche

- **Idempotenza**: ogni mail elaborata è registrata (`processed.gmail_message_id` UNIQUE);
  rilanciare lo scan non rigenera documenti già creati.
- **Sicurezza token**: i token OAuth sono cifrati a riposo (AES-256-GCM) con `TOKEN_ENC_KEY`.
- **Scan query-based**: usa `subject:(keyword) newer_than:2d` su Gmail — semplice e robusto;
  il dedup evita rielaborazioni.
- **PDF brandizzati**: il template HTML è in `apps/server/src/pdf/template.ts` — facile da
  personalizzare (logo, colori, layout per cliente).

## Limiti dell'MVP e prossimi passi

- OAuth in modalità "testing" (max 100 utenti). Per il pubblico serve la verifica Google.
- Storage locale (SQLite + filesystem): per il deploy multi-utente valutare Postgres + object storage.
- Possibili evoluzioni: invio automatico del PDF via mail, salvataggio su Google Drive,
  template per-cliente, sync quasi-realtime via Gmail `watch` + Pub/Sub.

---

## Build di produzione

```bash
npm run build      # compila server (tsc) e frontend (vite build)
npm start          # avvia il server compilato (servire apps/web/dist separatamente)
```
