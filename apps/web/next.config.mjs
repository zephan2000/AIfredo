/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@aifredo/shared"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
