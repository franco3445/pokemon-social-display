export interface SocialStats {
    platform: string;
    followers: number;
}

const PLATFORMS = ["instagram", "facebook", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Reads a follower count from our own dev-server proxy. The social APIs cannot be
 * called from the browser: TikTok sends no CORS headers at all, and the access
 * tokens must stay server-side regardless.
 */
async function getFollowers(platform: Platform): Promise<number> {
    const path = `/api/social/${platform}`;
    const res = await fetch(path);
    const text = await res.text();

    let body: { followers?: number; error?: string };
    try {
        body = JSON.parse(text);
    } catch {
        // An HTML body here means the request fell through to Vite's SPA fallback,
        // i.e. the socialApi plugin in vite.config.ts did not register.
        throw new Error(
            `Expected JSON from ${path}, got ${res.status} ` +
            `${res.headers.get("content-type") ?? "unknown"}: ${text.slice(0, 120)}`
        );
    }

    if (!res.ok || typeof body.followers !== "number") {
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return body.followers;
}

export const getInstagramFollowers = (): Promise<number> => getFollowers("instagram");
export const getFacebookFollowers = (): Promise<number> => getFollowers("facebook");
export const getTikTokFollowers = (): Promise<number> => getFollowers("tiktok");

export async function getAllSocialStats(): Promise<SocialStats[]> {
    // allSettled, not all: one platform being down should not blank the whole display.
    const results = await Promise.allSettled(PLATFORMS.map(getFollowers));

    return PLATFORMS.map((platform, i) => {
        const result = results[i];
        if (result.status === "rejected") {
            const message =
                result.reason instanceof Error ? result.reason.message : String(result.reason);

            // Awaiting the one-time OAuth login is an expected setup state, not a fault.
            if (message.includes("not linked yet")) {
                console.info(`${platform}: ${message}`);
            } else {
                console.error(`${platform} follower count failed:`, result.reason);
            }
            return { platform, followers: 0 };
        }
        return { platform, followers: result.value };
    });
}
