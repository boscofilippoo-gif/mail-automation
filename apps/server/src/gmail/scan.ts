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
 * Cerca le mail recenti che matchano un termine nell'oggetto.
 * Query Gmail: `subject:(term) newer_than:Nd` — semplice e robusta per uno scan periodico.
 * Ritorna i candidati completi (con testo del corpo) pronti per l'estrazione.
 */
export async function searchMessages(
  client: OAuth2Client,
  term: string,
  newerThanDays = 2,
  maxResults = 25,
): Promise<CandidateMail[]> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const q = `subject:(${term}) newer_than:${newerThanDays}d`;

  const list = await gmail.users.messages.list({ userId: "me", q, maxResults });
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);

  const out: CandidateMail[] = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const headers = msg.data.payload?.headers;
    out.push({
      id,
      subject: header(headers, "Subject"),
      from: header(headers, "From"),
      date: header(headers, "Date"),
      bodyText: extractBodyText(msg.data.payload),
    });
  }
  return out;
}
