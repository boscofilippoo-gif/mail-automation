import { google } from "googleapis";

import { env, GOOGLE_SCOPES } from "../env.js";
import { getTokens, saveTokens } from "../repo.js";

// Usiamo il tipo del client COSÌ COM'È prodotto da googleapis, per evitare il
// conflitto tra la copia di google-auth-library annidata in googleapis-common
// e quella di primo livello (private field 'redirectUri' duplicato).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

/** Crea un nuovo OAuth2Client configurato con le credenziali dell'app. */
export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    env.google.clientId,
    env.google.clientSecret,
    env.google.redirectUri,
  );
}

/** URL del consent screen Google. `state` trasporta una nonce anti-CSRF. */
export function getAuthUrl(state: string): string {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // necessario per ricevere il refresh_token
    prompt: "consent", // forza il rilascio del refresh_token anche su login ripetuti
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Scambia il `code` del callback con i token e ritorna profilo + token. */
export async function exchangeCode(code: string): Promise<{
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; scope?: string | null };
  profile: { sub: string; email: string; name: string | null };
}> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    tokens,
    profile: {
      sub: data.id ?? "",
      email: data.email ?? "",
      name: data.name ?? null,
    },
  };
}

/**
 * Ritorna un OAuth2Client autenticato per un utente, con refresh automatico.
 * Se la libreria rinnova l'access token (evento 'tokens'), lo ri-salviamo cifrato.
 */
export function getAuthedClientForUser(userId: number): OAuth2Client {
  const stored = getTokens(userId);
  if (!stored?.refresh_token && !stored?.access_token) {
    throw new Error(`Nessun token OAuth per l'utente ${userId}. Serve un nuovo login.`);
  }

  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.access_token ?? undefined,
    refresh_token: stored.refresh_token ?? undefined,
    expiry_date: stored.expiry ?? undefined,
    scope: stored.scope ?? undefined,
  });

  // Quando googleapis rinnova i token, persistiamo i valori aggiornati.
  client.on("tokens", (t) => {
    saveTokens(userId, {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expiry_date: t.expiry_date,
      scope: t.scope,
    });
  });

  return client;
}
