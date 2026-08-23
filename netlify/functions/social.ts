import type { Config } from "@netlify/functions";
import { isSocialPlatform, socialFollowers } from "../../server/social.ts";

/**
 * Production counterpart to the Vite dev middleware in vite.config.ts.
 * Both call the same socialFollowers, so /api/social/:platform behaves
 * identically in dev and on Netlify.
 */
export default async (_request: Request, context: { params: { platform?: string } }) => {
  const platform = context.params.platform ?? "";

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        // The module cache already throttles upstream calls; let the browser
        // re-ask so a redeploy or a warm instance can serve a fresher number.
        "Cache-Control": "no-store",
      },
    });

  if (!isSocialPlatform(platform)) {
    return json({ error: `Unknown platform "${platform}"` }, 404);
  }

  try {
    return json({ followers: await socialFollowers(platform, process.env) }, 200);
  } catch (err) {
    console.error(`[social] ${platform} failed:`, err);
    return json({ error: (err as Error).message }, 502);
  }
};

export const config: Config = {
  path: "/api/social/:platform",
};
