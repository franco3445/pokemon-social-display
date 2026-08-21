import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";


const CACHE_TTL_MS = 10 * 60 * 1000;
const TOKEN_STORE = ".tiktok-token.json";
const TIKTOK_SCOPES = "user.info.basic,user.info.stats";

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
 * Instagram + Facebook: plain Graph API reads.
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
 * TikTok: Display API via Login Kit.
 *
 * The Research API is not usable here: /v2/research/* rejects
 * client_credentials tokens with access_token_invalid unless the app has
 * been approved for research access. The Display API instead needs a
 * one-time user login, after which the refresh token keeps it alive.
 * ------------------------------------------------------------------ */

interface TikTokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TikTokUserResponse {
  data?: { user?: { follower_count?: number } };
  error?: { code?: string; message?: string };
}

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const pendingStates = new Set<string>();

function readToken(): StoredToken | null {
  if (!existsSync(TOKEN_STORE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_STORE, "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

function writeToken(token: StoredToken): void {
  writeFileSync(TOKEN_STORE, JSON.stringify(token, null, 2));
}

function redirectUri(env: Record<string, string>): string {
  return env.TIKTOK_REDIRECT_URI || "https://localhost:5173/api/social/tiktok/callback";
}

async function exchange(
  env: Record<string, string>,
  params: Record<string, string>,
): Promise<StoredToken> {
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: requireEnv(env, "TIKTOK_CLIENT_KEY"),
      client_secret: requireEnv(env, "TIKTOK_CLIENT_SECRET"),
      ...params,
    }),
  });

  const payload = (await response.json()) as TikTokTokenResponse;

  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(
      `TikTok token ${response.status}: ` +
        `${payload.error_description ?? payload.error ?? "no token in response"}`,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 86400) * 1000,
  };
}

async function tiktokAccessToken(env: Record<string, string>): Promise<string> {
  const stored = readToken();
  if (!stored) {
    throw new Error("TikTok is not linked yet. Open /api/social/tiktok/login once to authorize.");
  }

  // Access tokens last 24h, refresh tokens a year, so this self-heals.
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;

  const refreshed = await exchange(env, {
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });
  writeToken(refreshed);
  return refreshed.accessToken;
}

async function tiktokFollowers(env: Record<string, string>): Promise<number> {
  const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=follower_count", {
    headers: { Authorization: `Bearer ${await tiktokAccessToken(env)}` },
  });

  const payload = (await response.json()) as TikTokUserResponse;

  // TikTok can return HTTP 200 with an error payload.
  if (!response.ok || (payload.error?.code && payload.error.code !== "ok")) {
    throw new Error(`TikTok API ${response.status}: ${payload.error?.message ?? "unknown error"}`);
  }

  const followers = payload.data?.user?.follower_count;
  if (typeof followers !== "number") {
    throw new Error("No follower_count in TikTok response (is the user.info.stats scope approved?)");
  }
  return followers;
}

/* ------------------------------------------------------------------ *
 * Routes. Every credential stays in this Node process, and the browser
 * only ever calls same-origin /api/social/*, which is what avoids CORS.
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
        json(() =>
          cached("facebook", () =>
            graphFollowers(
              `https://graph.facebook.com/v26.0/${requireEnv(env, "FB_PAGE_ID")}` +
                `?fields=fan_count&access_token=${requireEnv(env, "FB_ACCESS_TOKEN")}`,
              "fan_count",
            ),
          ),
        ),
      );

      // Step 1: one-time authorization. Open this URL in a browser.
      server.middlewares.use("/api/social/tiktok/login", (_req, res) => {
        const state = randomUUID();
        pendingStates.add(state);

        const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
        url.searchParams.set("client_key", requireEnv(env, "TIKTOK_CLIENT_KEY"));
        url.searchParams.set("scope", TIKTOK_SCOPES);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("redirect_uri", redirectUri(env));
        url.searchParams.set("state", state);

        res.statusCode = 302;
        res.setHeader("Location", url.toString());
        res.end();
      });

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
      // TikTok rejects an http redirect URI, so DEV_HTTPS=1 serves the dev site
      // over https for the one-time login. The stored refresh token works over
      // plain http afterwards, so this can be switched back off.
      ...(env.DEV_HTTPS === "1" ? [basicSsl()] : []),
      socialApi(env),
    ],
    server: {
      // Only needed if you tunnel instead of using local https; Vite blocks
      // requests arriving on an unrecognised Host header.
      allowedHosts: env.DEV_ALLOWED_HOST ? [env.DEV_ALLOWED_HOST] : undefined,
    },
  };
});
