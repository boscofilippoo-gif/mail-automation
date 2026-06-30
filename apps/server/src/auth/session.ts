import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../env.js";

const COOKIE_NAME = "ma_session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

/** Imposta il cookie di sessione firmato con l'id utente. */
export function setSession(res: Response, userId: number): void {
  const token = jwt.sign({ uid: userId }, env.sessionSecret, { expiresIn: "7d" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd, // su Render (HTTPS) deve essere true, altrimenti il cookie non viene salvato
    maxAge: MAX_AGE_MS,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

/** Legge l'id utente dal cookie, oppure null se assente/invalido. */
export function readSession(req: Request): number | null {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return null;
  try {
    const payload = jwt.verify(raw, env.sessionSecret) as { uid: number };
    return payload.uid ?? null;
  } catch {
    return null;
  }
}

/** Estende Express.Request con userId per le route protette. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

/** Middleware: blocca con 401 se non c'è una sessione valida. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const uid = readSession(req);
  if (!uid) {
    res.status(401).json({ error: "non autenticato" });
    return;
  }
  req.userId = uid;
  next();
}
