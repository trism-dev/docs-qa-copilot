import type { NextConfig } from "next";

// transformers loads onnxruntime-node via createRequire, which file tracing cannot see.
// Vercel runs Linux x64, so include only that binary. Both routes embed text.
const ONNX = [
  "node_modules/onnxruntime-node/package.json",
  "node_modules/onnxruntime-node/dist/**",
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
  // The tracer misses this: transformers loads onnxruntime-node via createRequire, which then requires it.
  "node_modules/onnxruntime-common/**",
];
// Keep other platforms' native binaries out of the function bundle.
const OTHER_PLATFORMS = [
  "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
  "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
  "node_modules/@img/sharp-win32-*/**",
  "node_modules/@img/sharp-darwin-*/**",
];

// A visitor's API key sits in the page, so a stray script must not be able to send it anywhere: connect-src 'self'
// limits every fetch, XHR and WebSocket to this origin. Production only, because `next dev` needs eval and websockets.
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const config: NextConfig = {
  async headers() {
    return process.env.NODE_ENV === "production" ? [{ source: "/:path*", headers: SECURITY_HEADERS }] : [];
  },
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pdfjs-dist", "sharp"],
  // The /eval page reads the committed results file at run time, so make sure it ships with the build.
  outputFileTracingIncludes: { "/api/documents": ONNX, "/api/ask": ONNX, "/eval": ["eval/results/latest.json"] },
  outputFileTracingExcludes: { "/api/documents": OTHER_PLATFORMS, "/api/ask": OTHER_PLATFORMS },
};

export default config;
