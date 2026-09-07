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
  experimental: {
    serverActions: {
      allowedOrigins: previewOrigins,
    },
  },
};

export default nextConfig;
