import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.{js,mjs,ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/runtime/**",
      "**/target/**"
    ]
  }
});
