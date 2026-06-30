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
import { scanAllUsers } from "./jobs/dailyScan.js";
import { closePdfBrowser } from "./pdf/generate.js";

migrate();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: env.webOrigin,
    credentials: true, // necessario per inviare il cookie di sessione
  }),
);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/keywords", keywordsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/scan", scanRouter);

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
