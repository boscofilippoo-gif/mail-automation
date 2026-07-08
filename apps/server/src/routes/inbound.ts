import crypto from "node:crypto";

import express, { Router } from "express";

import { env } from "../env.js";
import { requireAuth } from "../auth/session.js";
import { getOrCreateInboundAddress, regenerateInboundAddress, setPendingConfirmation } from "../repo.js";
import { processInboundItems, type BrevoInboundItem } from "../jobs/inboundProcess.js";

export const inboundRouter = Router();

/** Indirizzo di inoltro dell'utente (creato al primo accesso). */
inboundRouter.get("/address", requireAuth, (req, res) => {
  const { alias, pending_confirmation } = getOrCreateInboundAddress(req.userId!);
  res.json({
    alias,
    address: `${alias}@${env.brevo.inboundDomain}`,
    pendingConfirmation: pending_confirmation,
  });
});

/** Rigenera l'alias (il vecchio smette di funzionare: confermare lato UI). */
inboundRouter.post("/address/regenerate", requireAuth, (req, res) => {
  const alias = regenerateInboundAddress(req.userId!);
  res.json({ alias, address: `${alias}@${env.brevo.inboundDomain}`, pendingConfirmation: null });
});

/** Segna il codice di conferma come consumato (l'utente l'ha usato). */
inboundRouter.post("/address/confirmation-done", requireAuth, (req, res) => {
  setPendingConfirmation(req.userId!, null);
  res.json({ ok: true });
});

/**
 * Webhook Brevo: mail inoltrate in ingresso. Brevo non firma i payload →
 * segreto nel path, confronto in tempo costante. Risposta 200 IMMEDIATA,
 * elaborazione asincrona (l'idempotenza rende innocui i retry).
 */
inboundRouter.post("/brevo/:key", express.json({ limit: "10mb" }), (req, res) => {
  const expected = env.brevo.inboundWebhookKey;
  const given = String(req.params.key ?? "");
  const valid =
    expected.length > 0 &&
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!valid) {
    res.status(401).json({ error: "chiave non valida" });
    return;
  }

  const items = ((req.body as { items?: BrevoInboundItem[] })?.items ?? []).slice(0, 50);
  res.json({ ok: true }); // rispondi subito: l'estrazione+PDF può richiedere >10s

  if (items.length > 0) {
    setImmediate(() => {
      void processInboundItems(items, env.brevo.inboundDomain);
    });
  }
});
