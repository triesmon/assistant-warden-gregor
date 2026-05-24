import { defineConfig } from "vitest/config";

// Keep test discovery explicit so compiled output is never picked up.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
