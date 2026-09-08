import type { NextConfig } from "next";

/**
 * Server actions reject a request whose Origin does not match its Host, which
 * is what stops a third-party page from firing one at us. A preview tunnel
 * puts a different hostname in front of the app and trips exactly that check,
 * so the tunnel domain is allowed only when PREVIEW_TUNNEL is set. Production
 * never loosens the check.
 */
const previewOrigins = process.env.PREVIEW_TUNNEL
  ? ["*.trycloudflare.com"]
  : [];

const nextConfig: NextConfig = {
  /**
   * A dev server and a production build share `.next` by default, and a build
   * run while `next dev` is watching fails part way through with a
   * PageNotFoundError naming a different page each time — the two are
   * overwriting each other's manifests. Set NEXT_DIST_DIR to build into its
   * own directory instead of stopping the dev server first.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      allowedOrigins: previewOrigins,
    },
  },
};

export default nextConfig;
