declare const __HWD_API_BUILD_ID__: string;

// esbuild replaces this constant at build time; source-mode tests are explicit.
export const BUILD_ID = typeof __HWD_API_BUILD_ID__ === "string"
  ? __HWD_API_BUILD_ID__ : "source-unbundled";
