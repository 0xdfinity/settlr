import path from "node:path";
import { fileURLToPath } from "node:url";

// Standalone output is what the Dockerfile ships and what `node .next/standalone/server.js`
// expects. Hosted platforms build their own artifact from the routes, and a tracing root
// above the project directory confuses that build, so only the self-hosted path uses it.
const selfHosted = !process.env.VERCEL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  ...(selfHosted
    ? {
        output: "standalone",
        outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
      }
    : {}),
};

export default nextConfig;
