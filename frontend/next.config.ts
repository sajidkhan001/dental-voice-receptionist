import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async rewrites() {
    const rewrites = [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/:path*`,
      },
      {
        source: "/webhook/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/webhook/:path*`,
      },
      {
        source: "/health",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/health`,
      },
    ];
    if (process.env.NODE_ENV !== "production") {
      rewrites.push({
        source: "/test/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/test/:path*`,
      });
    }
    return rewrites;
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
