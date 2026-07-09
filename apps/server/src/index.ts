import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import cron from "node-cron";

import { env } from "./env.js";
import { migrate } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { keywordsRouter } from "./routes/keywords.js";
import { documentsRouter } from "./routes/documents.js";
import { scanRouter } from "./routes/scan.js";
import { settingsRouter } from "./routes/settings.js";
import { listinoRouter } from "./routes/listino.js";
import { inboundRouter } from "./routes/inbound.js";
import { scanAllUsers } from "./jobs/dailyScan.js";
import { closePdfBrowser } from "./pdf/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

migrate();

const app = express();
app.use(cookieParser());
app.use(
  cors({
    origin: env.webOrigin,
    credentials: true, // necessario per inviare il cookie di sessione (utile in dev cross-origin)
  }),
);
// listino e settings: i PDF in base64 superano il limite globale → parser
// dedicato da 15mb, montato PRIMA del parser globale (body-parser salta i body già letti)
app.use("/api/listino", express.json({ limit: "15mb" }), listinoRouter);
app.use("/api/settings", express.json({ limit: "15mb" }), settingsRouter);
// inbound: il webhook Brevo usa un parser dedicato (definito nel router) — mount
// PRIMA del json globale così i payload grandi non vengono respinti a 2mb
app.use("/api/inbound", inboundRouter);
// limit 2mb: il logo in base64 (fino a ~700k caratteri) supera il default di 100KB
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/keywords", keywordsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/scan", scanRouter);

// ── In produzione il server serve anche il frontend buildato (single service) ──
// Il build del frontend finisce in apps/web/dist; da dist/index.js del server
// risaliamo a quella cartella. Fallback SPA per le route gestite da React Router.
const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/(api|auth|health)).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
  console.log(`[server] frontend servito da ${webDist}`);
}

const server = app.listen(env.port, () => {
  console.log(`[server] in ascolto su http://localhost:${env.port}`);
});

// ── Scan giornaliero: ogni giorno alle 07:00 (timezone di Roma) ──
const dailyJob = cron.schedule(
  "0 7 * * *",
  () => {
    console.log("[cron] avvio scan giornaliero");
    void scanAllUsers();
  },
  { timezone: "Europe/Rome" },
);

// ── Shutdown pulito: chiude server, cron e browser Puppeteer ──
async function shutdown() {
  console.log("\n[server] arresto in corso…");
  dailyJob.stop();
  await closePdfBrowser();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
