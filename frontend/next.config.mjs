/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for a small production Docker image.
  output: "standalone",
  // Demo avatars are served from Steam's CDNs; we render them with plain <img>
  // tags so no image-optimization allowlist or network access is required.
};

export default nextConfig;
