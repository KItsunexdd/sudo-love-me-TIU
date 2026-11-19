import { defineConfig } from "vitest/config";
import baseConfig from "../../../vitest.config.mts";

export default defineConfig({
  ...baseConfig,
  oxc: { jsx: { runtime: "automatic" } },
  test: { ...baseConfig.test, include: ["src/components/cosign/*.test.ts"] },
});
