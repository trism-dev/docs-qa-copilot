import type { NextConfig } from "next";

// transformers loads onnxruntime-node via createRequire, which file tracing cannot see.
// Vercel runs Linux x64, so include only that binary. Both routes embed text.
const ONNX = [
  "node_modules/onnxruntime-node/package.json",
  "node_modules/onnxruntime-node/dist/**",
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
];
// Keep other platforms' native binaries out of the function bundle.
const OTHER_PLATFORMS = [
  "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
  "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
  "node_modules/@img/sharp-win32-*/**",
  "node_modules/@img/sharp-darwin-*/**",
];

const config: NextConfig = {
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pdfjs-dist", "sharp"],
  outputFileTracingIncludes: { "/api/documents": ONNX, "/api/ask": ONNX },
  outputFileTracingExcludes: { "/api/documents": OTHER_PLATFORMS, "/api/ask": OTHER_PLATFORMS },
};

export default config;
