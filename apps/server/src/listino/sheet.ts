import { google } from "googleapis";

import { getAuthedClientForUser } from "../auth/google.js";

/** Errore tipizzato: servono nuovi permessi Google (scope Sheets mancante). */
export class NeedsReauthError extends Error {
  constructor() {
    super("Servono nuovi permessi Google per leggere il foglio.");
    this.name = "NeedsReauthError";
  }
}

/**
 * Estrae lo spreadsheetId da un URL di Google Sheets, o accetta un ID nudo.
 * Ritorna null se non riconoscibile.
 */
export function parseSheetUrl(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1]!;
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Legge le righe grezze della PRIMA scheda visibile del foglio.
 * `A1:Z2000` senza nome scheda = prima scheda (comportamento A1-notation);
 * UNFORMATTED_VALUE fa arrivare le celle numeriche come numeri JS.
 */
export async function fetchSheetRows(userId: number, spreadsheetId: string): Promise<unknown[][]> {
  const client = getAuthedClientForUser(userId);
  const sheets = google.sheets({ version: "v4", auth: client });

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "A1:Z2000",
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (res.data.values ?? []) as unknown[][];
  } catch (err) {
    const e = err as { code?: number; message?: string };
    const msg = e.message ?? "";
    if (e.code === 403 && /insufficient.*scope/i.test(msg)) {
      throw new NeedsReauthError();
    }
    if (e.code === 403 && /has not been used|is disabled/i.test(msg)) {
      throw new Error(
        "La Google Sheets API non è abilitata nel progetto Google Cloud. Abilitala da 'API e servizi → Libreria → Google Sheets API'.",
      );
    }
    if (e.code === 404) {
      throw new Error("Foglio non trovato o non accessibile con questo account Google.");
    }
    throw new Error(`Errore nella lettura del foglio: ${msg || "sconosciuto"}`);
  }
}
