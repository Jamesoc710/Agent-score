import { defineConfig } from "vitest/config";

// Unit tests for the TypeScript read path (lib/) and the TypeScript pipeline readers under
// scripts/ (Lane 1 extraction, the importer's refusals, the reconstruction). The scoring
// contract is tested separately in Python: `npm test` runs pytest, `npm run test:unit` runs this.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
