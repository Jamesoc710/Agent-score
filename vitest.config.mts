import { defineConfig } from "vitest/config";

// Unit tests for the TypeScript read path (currently lib/stats.ts). The scoring contract is
// tested separately in Python: `npm test` runs pytest, `npm run test:unit` runs this.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
