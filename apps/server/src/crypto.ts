import crypto from "node:crypto";

import { env } from "./env.js";

/**
 * Cifratura simmetrica AES-256-GCM per i token OAuth a riposo.
 * La chiave arriva da TOKEN_ENC_KEY (.env), 32 byte in esadecimale.
 * Formato in output: iv(12 byte) : authTag(16 byte) : ciphertext, tutto in base64, separato da ":".
 */

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const key = Buffer.from(env.tokenEncKey, "hex");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENC_KEY deve essere 32 byte in esadecimale (64 caratteri hex). " +
        'Generala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Payload cifrato non valido.");
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
