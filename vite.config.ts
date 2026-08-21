import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { TikTokClient } from "@ssut/tiktok-api";

const CACHE_TTL_MS = 10 * 60 * 1000;
const GRAPH = "https://graph.facebook.com/v21.0";
const FB_TOKEN_STORE = ".fb-token.json";
// Long-lived user tokens last ~60 days; re-bootstrap well before that.
const USER_TOKEN_TTL_MS = 50 * 24 * 60 * 60 * 1000;

const cache = new Map<string, { followers: number; expiresAt: number }>();

async function cached(key: string, fetcher: () => Promise<number>): Promise<number> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.followers;

  const followers = await fetcher();
  cache.set(key, { followers, expiresAt: Date.now() + CACHE_TTL_MS });
  return followers;
}

function requireEnv(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set in .env`);
  return value;
}

/* ------------------------------------------------------------------ *
 * Graph API shared read.
 * ------------------------------------------------------------------ */

interface GraphResponse {
  followers_count?: number;
  fan_count?: number;
  error?: { message?: string; code?: number };
}

async function graphFollowers(url: string, field: "followers_count" | "fan_count"): Promise<number> {
  const response = await fetch(url);
  const payload = (await response.json()) as GraphResponse;

  if (!response.ok || payload.error) {
    throw new Error(`Graph API ${response.status}: ${payload.error?.message ?? "unknown error"}`);
  }

  const followers = payload[field];
  if (typeof followers !== "number") {
    throw new Error(`No ${field} in Graph API response`);
  }
  return followers;
}

/* ------------------------------------------------------------------ *
 * Facebook: self-maintaining Page token.
 *
 * A Page token derived from a long-lived user token does not expire, which
 * is what stops the hourly breakage. FB_ACCESS_TOKEN is therefore only a
 * seed, read once to bootstrap the Page token that gets cached to disk.
 * FB_APP_ID and FB_APP_SECRET upgrade the seed to a long-lived user token
 * first; without them a short-lived seed yields a short-lived Page token.
 * ------------------------------------------------------------------ */

interface FbTokenStore {
  pageId: string;
  token: string;
  // "page" tokens never expire; the "user" fallback does, so it carries a date.
  kind: "page" | "user";
  expiresAt: number | null;
}

interface FbExchangeResponse {
  access_token?: string;
  error?: { message?: string };
}

interface FbAccountsResponse {
  data?: Array<{ id?: string; name?: string; access_token?: string }>;
  error?: { message?: string };
}

function fanCountUrl(pageId: string, token: string): string {
  return `${GRAPH}/${pageId}?fields=fan_count&access_token=${token}`;
}

function readFbToken(pageId: string): string | null {
  if (!existsSync(FB_TOKEN_STORE)) return null;
  try {
    const stored = JSON.parse(readFileSync(FB_TOKEN_STORE, "utf8")) as FbTokenStore;
    if (stored.pageId !== pageId) return null;
    if (stored.expiresAt !== null && stored.expiresAt < Date.now()) return null;
    return stored.token;
  } catch {
    return null;
  }
}

async function bootstrapFbPageToken(env: Record<string, string>, pageId: string): Promise<string> {
  const seed = requireEnv(env, "FB_ACCESS_TOKEN");
  let userToken = seed;

  // Step 1: upgrade the seed to a long-lived (~60 day) user token if we can.
  if (env.FB_APP_ID && env.FB_APP_SECRET) {
    const url = new URL(`${GRAPH}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", env.FB_APP_ID);
    url.searchParams.set("client_secret", env.FB_APP_SECRET);
    url.searchParams.set("fb_exchange_token", seed);

    const response = await fetch(url);
    const payload = (await response.json()) as FbExchangeResponse;

    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Facebook token exchange ${response.status}: ` +
          `${payload.error?.message ?? "no access_token returned"}. ` +
          `Paste a fresh user token into FB_ACCESS_TOKEN and retry.`,
      );
    }
    userToken = payload.access_token;
  }

  // Step 2: trade the user token for the Page token, which is the durable one.
  const accountsUrl = new URL(`${GRAPH}/me/accounts`);
  accountsUrl.searchParams.set("fields", "id,name,access_token");
  accountsUrl.searchParams.set("access_token", userToken);

  const response = await fetch(accountsUrl);
  const payload = (await response.json()) as FbAccountsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(
      `Facebook /me/accounts ${response.status}: ${payload.error?.message ?? "no page list returned"}`,
    );
  }

  const page = payload.data.find((candidate) => candidate.id === pageId);

  // Preferred path: a Page token, which never expires.
  if (page?.access_token) {
    const store: FbTokenStore = { pageId, token: page.access_token, kind: "page", expiresAt: null };
    writeFileSync(FB_TOKEN_STORE, JSON.stringify(store, null, 2));
    return page.access_token;
  }

  // Fallback: the Page was not opted in to the app, so no Page token exists for
  // it. The user token can still read fan_count, it just expires, so cache it
  // with a date and re-bootstrap later. Opting the Page in upgrades this
  // automatically on the next bootstrap.
  const visible = payload.data.map((entry) => `${entry.name} (${entry.id})`).join(", ") || "none";
  console.warn(
    `[social-api] No Page token for ${pageId}; falling back to the user token, ` +
      `which expires. Pages opted in to this app: ${visible}. Re-generate the ` +
      `token and grant access to this Page for a non-expiring one.`,
  );

  const store: FbTokenStore = {
    pageId,
    token: userToken,
    kind: "user",
    expiresAt: Date.now() + USER_TOKEN_TTL_MS,
  };
  writeFileSync(FB_TOKEN_STORE, JSON.stringify(store, null, 2));
  return userToken;
}

async function facebookFollowers(env: Record<string, string>): Promise<number> {
  const pageId = requireEnv(env, "FB_PAGE_ID");
  const stored = readFbToken(pageId);

  if (!stored) {
    return graphFollowers(fanCountUrl(pageId, await bootstrapFbPageToken(env, pageId)), "fan_count");
  }

  try {
    return await graphFollowers(fanCountUrl(pageId, stored), "fan_count");
  } catch (err) {
    const message = (err as Error).message;

    // A stored Page token can still be invalidated by a password change or a
    // revoked app permission. Discard it and bootstrap once from the seed.
    if (!/expired|session|oauth|token/i.test(message)) throw err;

    rmSync(FB_TOKEN_STORE, { force: true });
    return graphFollowers(fanCountUrl(pageId, await bootstrapFbPageToken(env, pageId)), "fan_count");
  }
}

/* ------------------------------------------------------------------ *
 * TikTok: public profile read via @ssut/tiktok-api.
 *
 * This reads the same public data the profile page shows, so it needs no
 * OAuth, no app review, and no domain verification. The tradeoff is that
 * it rides an undocumented endpoint: expect it to break without notice,
 * and keep the cache in front of it to avoid hammering TikTok.
 * ------------------------------------------------------------------ */

const tiktok = new TikTokClient({ region: "US" });

async function tiktokFollowers(env: Record<string, string>): Promise<number> {
  const username = requireEnv(env, "TIKTOK_USERNAME");

  const profile = await tiktok.getUser(username);
  const followers = profile?.data?.userInfo?.stats?.followerCount;

  if (typeof followers !== "number") {
    throw new Error(`No followerCount for "${username}" (is the profile public and the name exact?)`);
  }
  return followers;
}

/* ------------------------------------------------------------------ *
 * Routes. Credentials stay in this Node process, and the browser only
 * ever calls same-origin /api/social/*, which is what avoids CORS.
 * ------------------------------------------------------------------ */

function socialApi(env: Record<string, string>): Plugin {
  const json =
    (handler: () => Promise<number>) => async (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      try {
        res.end(JSON.stringify({ followers: await handler() }));
      } catch (err) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    };

  return {
    name: "social-api",
    configureServer(server) {
      server.middlewares.use(
        "/api/social/instagram",
        json(() =>
          cached("instagram", () =>
            graphFollowers(
              `https://graph.instagram.com/v21.0/${requireEnv(env, "IG_USER_ID")}` +
                `?fields=followers_count&access_token=${requireEnv(env, "IG_ACCESS_TOKEN")}`,
              "followers_count",
            ),
          ),
        ),
      );

      server.middlewares.use(
        "/api/social/facebook",
        json(() => cached("facebook", () => facebookFollowers(env))),
      );

      server.middlewares.use(
        "/api/social/tiktok",
        json(() => cached("tiktok", () => tiktokFollowers(env))),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix so unprefixed secrets are readable here without reaching the client.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      // Local https is no longer required, since nothing needs an OAuth
      // callback now. Left behind the flag in case a provider demands it.
      ...(env.DEV_HTTPS === "1" ? [basicSsl()] : []),
      socialApi(env),
    ],
    server: {
      // Only needed if you tunnel; Vite blocks unrecognised Host headers.
      allowedHosts: env.DEV_ALLOWED_HOST ? [env.DEV_ALLOWED_HOST] : undefined,
    },
  };
});
