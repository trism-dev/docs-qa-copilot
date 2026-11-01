import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pdfjs-dist", "sharp"],
  // transformers loads onnxruntime-node via createRequire, which file tracing cannot see.
  // Vercel runs Linux x64, so include only that binary.
  outputFileTracingIncludes: {
    "/api/documents": [
      "node_modules/onnxruntime-node/package.json",
      "node_modules/onnxruntime-node/dist/**",
      "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
    ],
  },
  // Keep other platforms' native binaries out of the function bundle.
  outputFileTracingExcludes: {
    "/api/documents": [
      "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      "node_modules/@img/sharp-win32-*/**",
      "node_modules/@img/sharp-darwin-*/**",
    ],
  },
};

export default config;
