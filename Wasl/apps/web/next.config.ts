import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bound build workers on development/CI machines.
  experimental: { cpus: 2 },
};

export default nextConfig;
