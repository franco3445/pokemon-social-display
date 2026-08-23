import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { TikTokClient } from "@ssut/tiktok-api";

/**
 * Follower and like counts for every platform, shared by the Vite dev
 * middleware and the Netlify function so the logic exists once.
 *
 * `env` is passed in rather than read from process.env directly, because in dev
 * it comes from Vite's loadEnv (which reads .env) and in production it comes
 * from process.env (which Netlify populates from the site settings).
 */

export type SocialPlatform = "instagram" | "facebook" | "tiktok";

export const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "tiktok"];

export type Env = Record<string, string | undefined>;

export interface SocialCounts {
  followers: number;
  // Absent when the platform exposes no like total, or when fetching it failed
  // while the follower count still succeeded.
  likes?: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const GRAPH = "https://graph.facebook.com/v21.0";
const IG_GRAPH = "https://graph.instagram.com/v21.0";
// Long-lived user tokens last ~60 days; re-bootstrap well before that.
const USER_TOKEN_TTL_MS = 50 * 24 * 60 * 60 * 1000;
// Instagram has no total-likes field, so likes are summed over media pages.
// The cap stops a runaway loop if paging ever misbehaves.
const IG_MEDIA_PAGE_SIZE = 100;
const IG_MAX_PAGES = 25;

// Per-instance only. Warm serverless invocations reuse it; cold ones refill it.
const cache = new Map<string, { counts: SocialCounts; expiresAt: number }>();

async function cached(key: string, fetcher: () => Promise<SocialCounts>): Promise<SocialCounts> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.counts;

  const counts = await fetcher();
  cache.set(key, { counts, expiresAt: Date.now() + CACHE_TTL_MS });
  return counts;
}

function requireEnv(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

/* ------------------------------------------------------------------ *
 * Instagram.
 *
 * followers_count is a plain field. Likes are not: there is no account-level
 * total, so every media item's like_count is summed. That costs one request
 * per 100 posts, which is why it sits behind the cache.
 * ------------------------------------------------------------------ */

interface IgProfileResponse {
  followers_count?: number;
  error?: { message?: string };
}

interface IgMediaResponse {
  data?: Array<{ like_count?: number }>;
  paging?: { next?: string };
  error?: { message?: string };
}

async function instagramLikes(userId: string, token: string): Promise<number> {
  let url: string | undefined =
    `${IG_GRAPH}/${userId}/media?fields=like_count` +
    `&limit=${IG_MEDIA_PAGE_SIZE}&access_token=${token}`;

  let total = 0;

  for (let page = 0; page < IG_MAX_PAGES && url; page++) {
    const response = await fetch(url);
    const payload = (await response.json()) as IgMediaResponse;

    if (!response.ok || payload.error) {
      throw new Error(
        `Instagram /media ${response.status}: ${payload.error?.message ?? "unknown error"}`,
      );
    }

    for (const media of payload.data ?? []) {
      if (typeof media.like_count === "number") total += media.like_count;
    }

    url = payload.paging?.next;
  }

  return total;
}

async function instagramCounts(env: Env): Promise<SocialCounts> {
  const userId = requireEnv(env, "IG_USER_ID");
  const token = requireEnv(env, "IG_ACCESS_TOKEN");

  const response = await fetch(
    `${IG_GRAPH}/${userId}?fields=followers_count&access_token=${token}`,
  );
  const payload = (await response.json()) as IgProfileResponse;

  if (!response.ok || payload.error) {
    throw new Error(`Instagram API ${response.status}: ${payload.error?.message ?? "unknown error"}`);
  }
  if (typeof payload.followers_count !== "number") {
    throw new Error("No followers_count in Instagram response");
  }

  return { followers: payload.followers_count, likes: await likesOrNothing("instagram", () => instagramLikes(userId, token)) };
}

/* ------------------------------------------------------------------ *
 * Facebook.
 *
 * fan_count is the page like count and followers_count the follower count.
 * Facebook merged the two concepts, so for most pages they are identical.
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

interface FbPageResponse {
  fan_count?: number;
  followers_count?: number;
  error?: { message?: string };
}

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
  // it. The user token still reads the counts, it just expires, so cache it with
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

async function readFacebookPage(pageId: string, token: string): Promise<SocialCounts> {
  const response = await fetch(
    `${GRAPH}/${pageId}?fields=fan_count,followers_count&access_token=${token}`,
  );
  const payload = (await response.json()) as FbPageResponse;

  if (!response.ok || payload.error) {
    throw new Error(`Graph API ${response.status}: ${payload.error?.message ?? "unknown error"}`);
  }

  const followers = payload.followers_count ?? payload.fan_count;
  if (typeof followers !== "number") {
    throw new Error("No followers_count or fan_count in Graph API response");
  }

  return {
    followers,
    likes: typeof payload.fan_count === "number" ? payload.fan_count : undefined,
  };
}

async function facebookCounts(env: Env): Promise<SocialCounts> {
  const pageId = requireEnv(env, "FB_PAGE_ID");

  // Preferred: a token that already reads the page. No exchange, no disk.
  if (env.FB_PAGE_TOKEN) {
    return readFacebookPage(pageId, env.FB_PAGE_TOKEN);
  }

  const stored = readFbToken(env, pageId);
  if (!stored) {
    return readFacebookPage(pageId, await bootstrapFbPageToken(env, pageId));
  }

  try {
    return await readFacebookPage(pageId, stored);
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
    return readFacebookPage(pageId, await bootstrapFbPageToken(env, pageId));
  }
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

async function tiktokCounts(env: Env): Promise<SocialCounts> {
  const username = requireEnv(env, "TIKTOK_USERNAME");

  const stats = (await tiktok.getUser(username))?.data?.userInfo?.stats;

  if (typeof stats?.followerCount !== "number") {
    throw new Error(`No followerCount for "${username}" (is the profile public and the name exact?)`);
  }

  // heartCount is the lifetime like total across all videos.
  return {
    followers: stats.followerCount,
    likes: typeof stats.heartCount === "number" ? stats.heartCount : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

/**
 * Likes are a nice-to-have: a platform that returns a follower count but fails
 * on likes should still render its panel rather than reporting total failure.
 */
async function likesOrNothing(
  platform: string,
  fetcher: () => Promise<number>,
): Promise<number | undefined> {
  try {
    return await fetcher();
  } catch (err) {
    console.warn(`[social] ${platform} likes unavailable:`, (err as Error).message);
    return undefined;
  }
}

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as string[]).includes(value);
}

export function socialCounts(platform: SocialPlatform, env: Env): Promise<SocialCounts> {
  switch (platform) {
    case "instagram":
      return cached("instagram", () => instagramCounts(env));

    case "facebook":
      return cached("facebook", () => facebookCounts(env));

    case "tiktok":
      return cached("tiktok", () => tiktokCounts(env));
  }
}
