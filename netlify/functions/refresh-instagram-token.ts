import type { Config } from "@netlify/functions";
import { getInstagramToken } from "../../server/igToken.ts";

/**
 * Runs daily so the Instagram token is renewed even when nobody visits the
 * site. getInstagramToken only actually refreshes about once a week; the other
 * runs are a cheap read of the stored token.
 */
export default async () => {
    try {
        await getInstagramToken(process.env);
    } catch (err) {
        console.error("[social] scheduled Instagram token check failed:", err);
    }
};

export const config: Config = {
    schedule: "@daily",
};
