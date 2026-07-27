/** @type {import('next').NextConfig} */
export default {
  experimental: {
    // Receipt photos arrive base64-encoded in the server-action payload.
    serverActions: { bodySizeLimit: "12mb" },
  },
};
