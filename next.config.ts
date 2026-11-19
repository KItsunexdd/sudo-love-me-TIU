import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "publickey-credentials-get=(self), publickey-credentials-create=(self)" },
      ],
    }];
  },
};

export default nextConfig;
