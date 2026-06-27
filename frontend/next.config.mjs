/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static HTML export → deployable to Firebase Hosting (free Spark plan, no Cloud Functions).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
