import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't buffer the SSE stream for compression; Cloudflare compresses anyway.
  compress: false,
  poweredByHeader: false,
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "ioredis", "sanitize-html"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
