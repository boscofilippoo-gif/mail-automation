/**
 * Postinstall: su Render scarica Chrome per Puppeteer nella cache di progetto
 * (vedi .puppeteerrc.cjs). In locale non fa nulla (Chrome è già in ~/.cache).
 * Idempotente: se Chrome c'è già, il download viene saltato.
 */
if (process.env.RENDER) {
  const { execSync } = require("child_process");
  console.log("[postinstall] Render rilevato: installo Chrome per Puppeteer…");
  execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });
} else {
  console.log("[postinstall] ambiente locale: nessun download Chrome necessario.");
}
