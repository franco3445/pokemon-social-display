import { useEffect, useState } from "react";
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
    // Both filled in by useSocialPanels once the live counts arrive. Panel hides
    // each row while its value is undefined, so there are no placeholder numbers.
    followers?: number;
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

// One shared request rather than one per component, since several pages render
// social panels and would otherwise each trigger their own fetch.
let inFlight: ReturnType<typeof getAllSocialStats> | null = null;

function loadSocialStats() {
    inFlight ??= getAllSocialStats();
    return inFlight;
}

/**
 * The panel definitions above with live follower counts merged in by platform.
 *
 * getAllSocialStats reports a failed platform as 0, which is left undefined
 * here so the panel hides its follower row rather than claiming zero.
 */
export function useSocialPanels(): SocialPanel[] {
    const [panels, setPanels] = useState<SocialPanel[]>(socialPanels);

    useEffect(() => {
        let active = true;

        loadSocialStats()
            .then((stats) => {
                if (!active) return;

                const byPlatform = new Map(stats.map((stat) => [stat.platform, stat]));

                setPanels(
                    socialPanels.map((panel) => {
                        const stat = byPlatform.get(panel.platform);
                        return {
                            ...panel,
                            followers: stat?.followers || undefined,
                            likes: stat?.likes || undefined,
                        };
                    }),
                );
            })
            .catch((err) => {
                // getAllSocialStats already swallows per-platform failures, so
                // reaching here means something broke outright.
                console.error("social stats request failed:", err);
            });

        return () => {
            active = false;
        };
    }, []);

    return panels;
}

export const paymentPanels: PaymentPanel[] = [
    {
        type: "payment",
        platform: "cashapp",
        name: "$franco3445",
        url: "https://cash.app/$franco3445",
        qrColor: "#00c244",
    },
    {
        type: "payment",
        platform: "venmo",
        name: "@franco3445",
        url: "https://venmo.com/code?user_id=1786268014870528090",
        qrColor: "#3d95ce",
    },
    {
        type: "payment",
        platform: "paypal",
        name: "Gilberto Franco",
        url: "https://www.paypal.me/franco3445",
        qrColor: "#003087",
    },
];
