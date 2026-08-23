export interface SocialStats {
    platform: string;
    followers: number;
    likes?: number;
}

const PLATFORMS = ["instagram", "facebook", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Reads a follower count from our own dev-server proxy. The social APIs cannot be
 * called from the browser: TikTok sends no CORS headers at all, and the access
 * tokens must stay server-side regardless.
 */
async function getCounts(platform: Platform): Promise<{ followers: number; likes?: number }> {
    const path = `/api/social/${platform}`;
    const res = await fetch(path);
    const text = await res.text();

    let body: { followers?: number; likes?: number; error?: string };
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
    return { followers: body.followers, likes: body.likes };
}

export const getInstagramFollowers = async (): Promise<number> =>
    (await getCounts("instagram")).followers;
export const getFacebookFollowers = async (): Promise<number> =>
    (await getCounts("facebook")).followers;
export const getTikTokFollowers = async (): Promise<number> =>
    (await getCounts("tiktok")).followers;

export async function getAllSocialStats(): Promise<SocialStats[]> {
    // allSettled, not all: one platform being down should not blank the whole display.
    const results = await Promise.allSettled(PLATFORMS.map(getCounts));

    return PLATFORMS.map((platform, i) => {
        const result = results[i];
        if (result.status === "rejected") {
            console.error(`${platform} counts failed:`, result.reason);
            return { platform, followers: 0 };
        }
        return { platform, followers: result.value.followers, likes: result.value.likes };
    });
}
