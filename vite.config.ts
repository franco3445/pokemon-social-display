import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isSocialPlatform, socialCounts, SOCIAL_PLATFORMS } from "./server/social.ts";

/**
 * Dev-only mirror of netlify/functions/social.ts. Both delegate to
 * socialFollowers, so /api/social/:platform behaves the same either side of a
 * deploy. Credentials stay in this Node process and the browser only ever calls
 * same-origin /api/social/*, which is what avoids CORS.
 */
function socialApi(env: Record<string, string>): Plugin {
  return {
    name: "social-api",
    configureServer(server) {
      for (const platform of SOCIAL_PLATFORMS) {
        server.middlewares.use(
          `/api/social/${platform}`,
          async (_req: IncomingMessage, res: ServerResponse) => {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");

            if (!isSocialPlatform(platform)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: `Unknown platform "${platform}"` }));
              return;
            }

            try {
              res.end(JSON.stringify(await socialCounts(platform, env)));
            } catch (err) {
              console.error(`[social] ${platform} failed:`, err);
              res.statusCode = 502;
              res.end(JSON.stringify({ error: (err as Error).message }));
            }
          },
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix so unprefixed secrets are readable here without reaching the client.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      // Local https, off by default. Kept behind the flag in case a provider
      // needs an https callback again.
      ...(env.DEV_HTTPS === "1" ? [basicSsl()] : []),
      socialApi(env),
    ],
    server: {
      // Only needed if you tunnel; Vite blocks unrecognised Host headers.
      allowedHosts: env.DEV_ALLOWED_HOST ? [env.DEV_ALLOWED_HOST] : undefined,
    },
  };
});
