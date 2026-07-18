/** @type {import('next').NextConfig} */

// Backend the dev server proxies API calls to. Keeping the API same-origin
// (browser → Next → Express) avoids CORS, third-party cookie issues, and
// mixed-content blocks when the frontend runs over HTTPS (needed for
// geolocation on phones accessing via LAN IP).
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_TARGET}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${API_TARGET}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
