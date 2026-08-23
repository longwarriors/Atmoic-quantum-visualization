import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Mirrored by tsconfig.test.json (include) and tsconfig.app.json (exclude)
    // so a spec/__tests__ file is type-checked with the tests and kept out of
    // the production build.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Pure logic only. client.ts is the HTTP layer and is exercised by the
      // Python API tests, not by mocking fetch here.
      include: ['src/api/qvpc.ts', 'src/scene/color.ts'],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
})
