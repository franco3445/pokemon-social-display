import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getStore } from "@netlify/blobs";

/**
 * Keeps the Instagram access token alive.
 *
 * Instagram Login tokens expire 60 days after they were issued or last
 * refreshed. A token at least 24 hours old (and not yet expired) can be swapped
 * for a fresh 60-day one, so refreshing roughly weekly keeps it valid forever.
 *
 * IG_ACCESS_TOKEN is only the seed. The live token lives in Netlify Blobs on
 * the deployed site, or in a local JSON file during `npm run dev`, because
 * serverless functions have nowhere durable to write. Pasting a new
 * IG_ACCESS_TOKEN (for example after letting it lapse) takes effect
 * automatically: the stored token is discarded once the seed no longer matches.
 */

type Env = Record<string, string | undefined>;

interface IgTokenRecord {
    /** The IG_ACCESS_TOKEN this record grew from, used to spot a rotated seed. */
    seed: string;
    /** The token to call the API with. */
    token: string;
    /** Epoch ms, when known (set by a successful refresh). */
    expiresAt: number | null;
    lastRefreshAt: number | null;
    lastAttemptAt: number;
}

interface IgRefreshResponse {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
}

const IG_GRAPH = "https://graph.instagram.com";
const BLOB_STORE = "social-tokens";
const BLOB_KEY = "instagram";

const DAY = 24 * 60 * 60 * 1000;
/** Refresh once the token has gone this long without one. */
const REFRESH_EVERY_MS = 7 * DAY;
/** Back-off after any attempt, successful or not, so failures don't hammer the API. */
const ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/* ---------- storage: Netlify Blobs when deployed, a file locally ---------- */

function blobStore() {
    try {
        // Throws when there is no Netlify Blobs context, i.e. outside Netlify.
        return getStore({ name: BLOB_STORE, consistency: "strong" });
    } catch {
        return null;
    }
}

function localPath(env: Env): string {
    return env.IG_TOKEN_STORE ?? ".ig-token.json";
}

async function readRecord(env: Env): Promise<IgTokenRecord | null> {
    const store = blobStore();
    try {
        if (store) {
            return ((await store.get(BLOB_KEY, { type: "json" })) as IgTokenRecord | null) ?? null;
        }
        const path = localPath(env);
        return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as IgTokenRecord) : null;
    } catch (err) {
        console.warn("[social] could not read stored Instagram token:", (err as Error).message);
        return null;
    }
}

async function writeRecord(env: Env, record: IgTokenRecord): Promise<void> {
    const store = blobStore();
    try {
        if (store) {
            await store.setJSON(BLOB_KEY, record);
        } else {
            writeFileSync(localPath(env), JSON.stringify(record, null, 2));
        }
    } catch (err) {
        console.warn("[social] could not save Instagram token:", (err as Error).message);
    }
}

/* ---------- refresh ---------- */

function isDue(record: IgTokenRecord, now: number): boolean {
    if (now - record.lastAttemptAt < ATTEMPT_COOLDOWN_MS) return false;
    return record.lastRefreshAt === null || now - record.lastRefreshAt >= REFRESH_EVERY_MS;
}

async function refresh(record: IgTokenRecord, now: number): Promise<IgTokenRecord> {
    const url = new URL(`${IG_GRAPH}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", record.token);

    try {
        const response = await fetch(url);
        const payload = (await response.json()) as IgRefreshResponse;

        if (!response.ok || !payload.access_token) {
            throw new Error(`${response.status}: ${payload.error?.message ?? "no access_token returned"}`);
        }

        console.log("[social] Instagram token refreshed");
        return {
            ...record,
            token: payload.access_token,
            expiresAt: payload.expires_in ? now + payload.expires_in * 1000 : null,
            lastRefreshAt: now,
            lastAttemptAt: now,
        };
    } catch (err) {
        // Most often the token is under 24 hours old, which Instagram refuses.
        // The current token still works, so carry on and retry after the cooldown.
        console.warn("[social] Instagram token refresh failed:", (err as Error).message);
        return { ...record, lastAttemptAt: now };
    }
}

/**
 * The Instagram token to use right now, refreshing it first when due.
 * Called on every (cache-missing) Instagram request and by the daily
 * scheduled function, so the token stays fresh even if nobody visits.
 */
export async function getInstagramToken(env: Env): Promise<string> {
    const seed = env.IG_ACCESS_TOKEN;
    if (!seed) throw new Error("IG_ACCESS_TOKEN is not set");

    const now = Date.now();
    const stored = await readRecord(env);

    let record: IgTokenRecord =
        stored && stored.seed === seed
            ? stored
            : { seed, token: seed, expiresAt: null, lastRefreshAt: null, lastAttemptAt: 0 };

    if (isDue(record, now)) {
        record = await refresh(record, now);
        await writeRecord(env, record);
    } else if (record !== stored) {
        await writeRecord(env, record);
    }

    return record.token;
}
