import crypto from "node:crypto";
import fs from "node:fs";

import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";

// stessa classe usata dal modulo Sheets: instanceof unico in tutte le route
import { NeedsReauthError } from "../listino/sheet.js";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export interface ReplyMeta {
  threadId: string;
  to: string; // Reply-To se presente, altrimenti From (verbatim)
  subject: string; // oggetto originale, senza prefisso Re:
  messageIdHeader: string | null; // Message-ID originale, per In-Reply-To/References
  references: string | null;
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Legge dal messaggio originale ciò che serve per costruire la risposta in-thread. */
export async function fetchReplyMeta(client: OAuth2Client, messageId: string): Promise<ReplyMeta> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "Message-ID", "References", "Reply-To"],
  });
  const headers = msg.data.payload?.headers;
  const replyTo = header(headers, "Reply-To");
  const from = header(headers, "From");
  const rawSubject = header(headers, "Subject");
  return {
    threadId: msg.data.threadId ?? "",
    to: replyTo || from,
    // strip di eventuali prefissi Re:/R: (i client italiani usano "R:")
    subject: rawSubject.replace(/^\s*(re|r)\s*:\s*/i, ""),
    messageIdHeader: header(headers, "Message-ID") || null,
    references: header(headers, "References") || null,
  };
}

/**
 * Header RFC 2047 per testo non-ASCII: encoded-word =?UTF-8?B?...?= in chunk
 * ≤75 caratteri, senza spezzare i caratteri multibyte, piegati su più righe.
 */
function encodeHeaderValue(value: string): string {
  // ASCII puro: nessun encoding necessario
  if (/^[\x20-\x7e]*$/.test(value)) return value;

  // 39 byte → 52 char base64 → 64 con il prefisso encoded-word: anche la prima
  // riga ("Subject: " + word = 73) resta sotto la raccomandazione di 78 col/riga
  const CHUNK_BYTES = 39;
  const chunks: string[] = [];
  let current = "";
  for (const ch of value) {
    if (Buffer.byteLength(current + ch, "utf8") > CHUNK_BYTES) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`)
    .join("\r\n "); // folding: continuazione con spazio iniziale
}

/** base64 spezzato a 76 colonne (requisito MIME per i body). */
function base64Wrap(buf: Buffer): string {
  return buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

/**
 * Costruisce il messaggio MIME della risposta: testo + PDF allegato.
 * OMESSI di proposito From/Date/Message-ID: li imposta Gmail sull'account autenticato.
 */
export function buildReplyMime(args: {
  meta: ReplyMeta;
  bodyText: string;
  pdfBuffer: Buffer;
  filename: string; // ASCII-safe (es. preventivo-12.pdf)
}): string {
  const { meta, bodyText, pdfBuffer, filename } = args;
  const boundary = `----=_ma_${crypto.randomBytes(12).toString("hex")}`;

  const lines: string[] = [
    `To: ${meta.to}`,
    `Subject: ${encodeHeaderValue(`Re: ${meta.subject}`)}`,
  ];
  if (meta.messageIdHeader) {
    lines.push(`In-Reply-To: ${meta.messageIdHeader}`);
    lines.push(
      `References: ${meta.references ? `${meta.references} ${meta.messageIdHeader}` : meta.messageIdHeader}`,
    );
  }
  lines.push(
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrap(Buffer.from(bodyText, "utf8")),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrap(pdfBuffer),
    `--${boundary}--`,
  );
  return lines.join("\r\n");
}

/**
 * Crea la bozza di risposta nel thread originale. Ritorna l'id della bozza.
 * NOTA: quest'app crea SOLO bozze — mai chiamare drafts.send/messages.send.
 */
export async function createReplyDraft(
  client: OAuth2Client,
  args: { meta: ReplyMeta; bodyText: string; pdfPath: string; filename: string },
): Promise<string> {
  const pdfBuffer = fs.readFileSync(args.pdfPath);
  const mime = buildReplyMime({ ...args, pdfBuffer });
  const raw = Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, threadId: args.meta.threadId } },
    });
    return res.data.id ?? "";
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e.code === 403 && /insufficient.*scope/i.test(e.message ?? "")) {
      throw new NeedsReauthError();
    }
    throw err;
  }
}
