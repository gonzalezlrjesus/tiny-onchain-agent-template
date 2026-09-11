import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    exclude: ["node_modules", "dist", ".stryker-tmp/**", "reports/**"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["validate.ts", "errors.ts", "x402-mock.ts", "audit.ts"],
    },
  },
});
