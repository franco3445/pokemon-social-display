import { useSyncExternalStore } from "react";
import { getAllSocialStats } from "../api/social.ts";

export type SocialPlatform =
    | "facebook"
    | "instagram"
    | "tiktok";

export type PaymentPlatform =
    | "cashapp"
    | "venmo"
    | "paypal";

export interface SocialPanel {
    type: "social";
    platform: SocialPlatform;
    name: string;
    // Filled in by useSocialPanels once the live counts arrive. Panel hides the
    // follower row while this is undefined, so there is no placeholder number.
    followers?: number;
    // Total likes, same lifecycle as followers; hidden while undefined.
    likes?: number;
    url: string;
    qrColor: string;
}

export interface PaymentPanel {
    type: "payment";
    platform: PaymentPlatform;
    name: string;
    url: string;
    qrColor: string;
}

export const socialPanels: SocialPanel[] = [
    {
        type: "social",
        platform: "facebook",
        name: "Franco's Finds",
        url: "https://www.facebook.com/profile.php?id=61592897452787",
        qrColor: "#1877f2",
    },
    {
        type: "social",
        platform: "instagram",
        name: "@francos_finds",
        url: "https://www.instagram.com/francos_finds/",
        qrColor: "#e1306c",
    },
    {
        type: "social",
        platform: "tiktok",
        name: "@francos_finds",
        url: "https://www.tiktok.com/@francos_finds",
        qrColor: "#000000",
    },
];

// How often to re-ask for counts. The server caches each platform for 10
// minutes (CACHE_TTL_MS in server/social.ts), so polling faster than this
// mostly returns the same numbers; it just means a change shows up within a
// minute of the cache refreshing rather than up to 10 minutes later.
const POLL_INTERVAL_MS = 60 * 1000;

// Skip the immediate fetch on mount if we fetched this recently, so flipping
// between pages does not fire a burst of requests.
const MIN_REFETCH_MS = 15 * 1000;

// One shared store rather than one poller per component, since several pages
// render social panels and would otherwise each run their own interval.
let current: SocialPanel[] = socialPanels;
let lastFetchedAt = 0;
let fetching = false;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

/**
 * Fetches counts and merges them into the current panels.
 *
 * getAllSocialStats reports a failed platform as 0. On the first load that is
 * left undefined so the panel hides its row rather than claiming zero; on later
 * polls the previous number is kept so a transient failure does not blank a
 * stat that was already showing.
 */
async function refresh() {
    if (fetching) return;
    fetching = true;

    try {
        const stats = await getAllSocialStats();
        lastFetchedAt = Date.now();

        const statsByPlatform = new Map(
            stats.map((stat) => [stat.platform, stat]),
        );

        let changed = false;
        const next = current.map((panel) => {
            const stat = statsByPlatform.get(panel.platform);
            const followers = stat?.followers || panel.followers;
            const likes = stat?.likes || panel.likes;

            if (followers === panel.followers && likes === panel.likes) {
                return panel;
            }

            changed = true;
            return { ...panel, followers, likes };
        });

        // Only notify on a real change, so an unchanged poll re-renders nothing
        // and never retriggers the change animation.
        if (changed) {
            current = next;
            listeners.forEach((listener) => listener());
        }
    } catch (err) {
        // getAllSocialStats already swallows per-platform failures, so
        // reaching here means something broke outright.
        console.error("social stats request failed:", err);
    } finally {
        fetching = false;
    }
}

function onVisibilityChange() {
    // Catch up straight away when a backgrounded tab comes back.
    if (document.visibilityState === "visible") void refresh();
}

function startPolling() {
    if (Date.now() - lastFetchedAt > MIN_REFETCH_MS) void refresh();

    timer = setInterval(() => {
        // Browsers throttle hidden tabs anyway; skip them outright and let
        // onVisibilityChange refresh when the tab is shown again.
        if (document.visibilityState === "visible") void refresh();
    }, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopPolling() {
    clearInterval(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", onVisibilityChange);
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) startPolling();

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopPolling();
    };
}

const getSnapshot = () => current;

/**
 * The panel definitions above with live follower and like counts merged in by
 * platform, re-polled every POLL_INTERVAL_MS while any component is mounted.
 */
export function useSocialPanels(): SocialPanel[] {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const paymentPanels: PaymentPanel[] = [
    {
        type: "payment",
        platform: "cashapp",
        name: "$franco3445",
        url: "https://cash.app/$franco3445",
        qrColor: "#006400",
    },
    {
        type: "payment",
        platform: "venmo",
        name: "@franco3445",
        url: "https://venmo.com/code?user_id=1786268014870528090",
        qrColor: "#0000CD",
    },
    {
        type: "payment",
        platform: "paypal",
        name: "Gilberto Franco",
        url: "https://www.paypal.me/franco3445",
        qrColor: "#003087",
    },
];
