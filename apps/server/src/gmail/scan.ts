import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";

// Tipo del client come prodotto da googleapis (evita il conflitto di google-auth-library duplicato).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

/** Una mail candidata trovata dallo scan, già normalizzata. */
export interface CandidateMail {
  id: string;
  subject: string;
  from: string;
  date: string;
  bodyText: string;
}

/** Decodifica una stringa base64url (formato dei body Gmail) in UTF-8. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Estrae il testo dal payload del messaggio, preferendo text/plain e cadendo su text/html ripulito. */
function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (data) {
      if (mime === "text/plain") plain.push(decodeBase64Url(data));
      else if (mime === "text/html") html.push(decodeBase64Url(data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);

  if (plain.length) return plain.join("\n").trim();
  if (html.length) {
    // strip molto basilare dei tag per dare a Claude solo il testo
    return html
      .join("\n")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/**
 * Finestra temporale di uno scan: relativa (ultimi N giorni) o intervallo
 * di date scelto dall'utente (YYYY-MM-DD, estremi inclusi).
 */
export type ScanWindow = { days: number } | { after: string; before: string };

/** Frammento di query Gmail per la finestra. `before:` in Gmail è ESCLUSIVO → +1 giorno. */
export function windowQuery(w: ScanWindow): string {
  if ("days" in w) return `newer_than:${w.days}d`;
  const beforeInclusive = new Date(`${w.before}T00:00:00Z`);
  beforeInclusive.setUTCDate(beforeInclusive.getUTCDate() + 1);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  return `after:${w.after.replace(/-/g, "/")} before:${fmt(beforeInclusive)}`;
}

/**
 * Lista SOLO gli ID dei messaggi che matchano una query Gmail, con paginazione
 * (fino a `maxResults` totali, 500 per pagina). Economico: nessun contenuto
 * scaricato — permette di filtrare i già-processati PRIMA di idratare.
 */
export async function listMessageIds(
  client: OAuth2Client,
  q: string,
  maxResults: number,
): Promise<string[]> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < maxResults) {
    const list = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(500, maxResults - ids.length),
      pageToken,
    });
    ids.push(...(list.data.messages ?? []).map((m) => m.id!).filter(Boolean));
    pageToken = list.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  return ids;
}

/** Scarica e normalizza UN messaggio (oggetto, mittente, corpo in testo). */
export async function hydrateMessage(client: OAuth2Client, id: string): Promise<CandidateMail> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = msg.data.payload?.headers;
  return {
    id,
    subject: header(headers, "Subject"),
    from: header(headers, "From"),
    date: header(headers, "Date"),
    bodyText: extractBodyText(msg.data.payload),
  };
}

/**
 * Query dello smart scan: mail dell'inbox nella finestra, senza filtro oggetto.
 * NIENTE `-from:me`: le mail auto-inviate sono il percorso di test/demo
 * dell'utente (si manda una mail e prova lo scan) — non escluderle mai.
 */
export function smartScanQuery(window: ScanWindow): string {
  return `${windowQuery(window)} in:inbox -in:chats -category:promotions -category:social`;
}

/**
 * Cerca le mail che matchano un termine nell'oggetto, nella finestra data.
 * Ritorna i candidati completi (con testo del corpo) pronti per l'estrazione.
 */
export async function searchMessages(
  client: OAuth2Client,
  term: string,
  window: ScanWindow = { days: 2 },
  maxResults = 25,
): Promise<CandidateMail[]> {
  const ids = await listMessageIds(client, `subject:(${term}) ${windowQuery(window)}`, maxResults);
  const out: CandidateMail[] = [];
  for (const id of ids) {
    out.push(await hydrateMessage(client, id));
  }
  return out;
}
