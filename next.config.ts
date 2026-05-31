import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// withSentryConfig instrumenta el build. Sin org/project/authToken (sólo
// presentes en el entorno de deploy) el upload de source maps se omite sin
// romper el build. `silent` evita ruido en local/CI.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
});
