import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: [
    "@mastra/core",
    "@openrouter/ai-sdk-provider",
    "@modelcontextprotocol/sdk",
  ],
  devIndicators: false,
};
export default config;
