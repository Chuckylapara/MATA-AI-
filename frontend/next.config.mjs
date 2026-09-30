/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static HTML export → deployable to Firebase Hosting (free Spark plan, no Cloud Functions).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Set only for the GitHub Pages build (site lives under /<repo>/); Firebase builds are unchanged.
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH } : {}),
  webpack: (config, { dev }) => {
    // On low-memory dev machines, webpack's persistent disk cache (gzip serialization)
    // can throw ERR_MEMORY_ALLOCATION_FAILED and stall compilation. In-memory cache
    // avoids that; only affects local dev speed, not the production build output.
    if (dev) config.cache = { type: "memory" };
    return config;
  },
};

export default nextConfig;
