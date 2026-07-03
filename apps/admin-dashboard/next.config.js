/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: [
    '@merch-os/types',
    '@merch-os/auth',
    '@merch-os/api-client',
    '@merch-os/ui',
  ],
};

module.exports = nextConfig;
