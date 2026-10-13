/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "pdf-parse", "mammoth"],
};

export default nextConfig;
