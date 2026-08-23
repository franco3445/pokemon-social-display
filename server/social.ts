import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { TikTokClient } from "@ssut/tiktok-api";

/**
 * Follower-count reads for every platform, shared by the Vite dev middleware
 * and the Netlify function so the logic exists once.
 *
 * `env` is passed in rather than read from process.env directly, because in dev
 * it comes from Vite's loadEnv (which reads .env) and in production it comes
 * from process.env (which Netlify populates from the site settings).
 */

export type SocialPlatform = "instagram" | "facebook" | "tiktok";

export const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "tiktok"];

export type Env = Record<string, string | undefined>;

const CACHE_TTL_MS = 10 * 60 * 1000;
const GRAPH = "https://graph.facebook.com/v21.0";
// Long-lived user tokens last ~60 days; re-bootstrap well before that.
const USER_TOKEN_TTL_MS = 50 * 24 * 60 * 60 * 1000;

// Per-instance only. Warm serverless invocations reuse it; cold ones refill it.
const cache = new Map<string, { followers: number; expiresAt: number }>();

async function cached(key: string, fetcher: () => Promise<number>): Promise<number> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.followers;

  const followers = await fetcher();
  cache.set(key, { followers, expiresAt: Date.now() + CACHE_TTL_MS });
  return followers;
}

function requireEnv(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

/* ------------------------------------------------------------------ *
 * Graph API shared read.
 * ------------------------------------------------------------------ */

interface GraphResponse {
  followers_count?: number;
  fan_count?: number;
  error?: { message?: string };
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
 * Two ways in, in precedence order:
 *
 * 1. FB_PAGE_TOKEN, used exactly as given. This is the right one for
 *    serverless, where there is nowhere durable to cache a bootstrapped
 *    token. Supply a Page token (never expires) or a long-lived user token
 *    (~60 days). Nothing is exchanged and nothing is written to disk.
 *
 * 2. FB_ACCESS_TOKEN as a seed, exchanged for a long-lived token and then a
 *    Page token, cached to disk. Convenient locally, but useless on a
 *    serverless host: /tmp is ephemeral, so every cold start re-bootstraps,
 *    and a short-lived seed will have expired long before.
 * ------------------------------------------------------------------ */

interface FbTokenStore {
  pageId: string;
  token: string;
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

function tokenStorePath(env: Env): string {
  if (env.FB_TOKEN_STORE) return env.FB_TOKEN_STORE;
  return env.NETLIFY ? "/tmp/fb-token.json" : ".fb-token.json";
}

function fanCountUrl(pageId: string, token: string): string {
  return `${GRAPH}/${pageId}?fields=fan_count&access_token=${token}`;
}

function readFbToken(env: Env, pageId: string): string | null {
  const path = tokenStorePath(env);
  try {
    if (!existsSync(path)) return null;
    const stored = JSON.parse(readFileSync(path, "utf8")) as FbTokenStore;
    if (stored.pageId !== pageId) return null;
    if (stored.expiresAt !== null && stored.expiresAt < Date.now()) return null;
    return stored.token;
  } catch {
    return null;
  }
}

function writeFbToken(env: Env, store: FbTokenStore): void {
  try {
    writeFileSync(tokenStorePath(env), JSON.stringify(store, null, 2));
  } catch {
    // Read-only filesystem. The in-memory cache still covers warm requests.
  }
}

async function bootstrapFbPageToken(env: Env, pageId: string): Promise<string> {
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
          `FB_ACCESS_TOKEN is a seed and has expired. On a serverless host set ` +
          `FB_PAGE_TOKEN to a Page or long-lived user token instead, since there ` +
          `is nowhere to cache a bootstrapped one.`,
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
    writeFbToken(env, { pageId, token: page.access_token, kind: "page", expiresAt: null });
    return page.access_token;
  }

  // Fallback: the Page was not opted in to the app, so no Page token exists for
  // it. The user token still reads fan_count, it just expires, so cache it with
  // a date. Opting the Page in upgrades this on the next bootstrap.
  const visible = payload.data.map((entry) => `${entry.name} (${entry.id})`).join(", ") || "none";
  console.warn(
    `[social] No Page token for ${pageId}; falling back to the user token, ` +
      `which expires. Pages opted in to this app: ${visible}.`,
  );

  writeFbToken(env, {
    pageId,
    token: userToken,
    kind: "user",
    expiresAt: Date.now() + USER_TOKEN_TTL_MS,
  });
  return userToken;
}

async function facebookFollowers(env: Env): Promise<number> {
  const pageId = requireEnv(env, "FB_PAGE_ID");

  // Preferred: a token that already reads the page. No exchange, no disk.
  if (env.FB_PAGE_TOKEN) {
    return graphFollowers(fanCountUrl(pageId, env.FB_PAGE_TOKEN), "fan_count");
  }

  const stored = readFbToken(env, pageId);

  if (!stored) {
    return graphFollowers(fanCountUrl(pageId, await bootstrapFbPageToken(env, pageId)), "fan_count");
  }

  try {
    return await graphFollowers(fanCountUrl(pageId, stored), "fan_count");
  } catch (err) {
    const message = (err as Error).message;

    // A stored token can still be invalidated by a password change or a revoked
    // permission. Discard it and bootstrap once from the seed.
    if (!/expired|session|oauth|token/i.test(message)) throw err;

    try {
      rmSync(tokenStorePath(env), { force: true });
    } catch {
      // Nothing to remove, or a read-only filesystem. Bootstrap anyway.
    }
    return graphFollowers(fanCountUrl(pageId, await bootstrapFbPageToken(env, pageId)), "fan_count");
  }
}

/* ------------------------------------------------------------------ *
 * Instagram.
 * ------------------------------------------------------------------ */

function instagramFollowers(env: Env): Promise<number> {
  return graphFollowers(
    `https://graph.instagram.com/v21.0/${requireEnv(env, "IG_USER_ID")}` +
      `?fields=followers_count&access_token=${requireEnv(env, "IG_ACCESS_TOKEN")}`,
    "followers_count",
  );
}

/* ------------------------------------------------------------------ *
 * TikTok: public profile read.
 *
 * This reads the same public data the profile page shows, so it needs no OAuth,
 * no app review, and no domain verification. It rides an undocumented endpoint
 * though, and TikTok blocks datacenter IPs far more readily than home ones, so
 * expect this to be the first thing that breaks once deployed.
 * ------------------------------------------------------------------ */

const tiktok = new TikTokClient({ region: "US" });

async function tiktokFollowers(env: Env): Promise<number> {
  const username = requireEnv(env, "TIKTOK_USERNAME");

  const profile = await tiktok.getUser(username);
  const followers = profile?.data?.userInfo?.stats?.followerCount;

  if (typeof followers !== "number") {
    throw new Error(`No followerCount for "${username}" (is the profile public and the name exact?)`);
  }
  return followers;
}

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as string[]).includes(value);
}

export function socialFollowers(platform: SocialPlatform, env: Env): Promise<number> {
  switch (platform) {
    case "instagram":
      return cached("instagram", () => instagramFollowers(env));

    case "facebook":
      return cached("facebook", () => facebookFollowers(env));

    case "tiktok":
      return cached("tiktok", () => tiktokFollowers(env));
  }
}
