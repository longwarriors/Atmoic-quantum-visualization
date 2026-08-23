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
      // Coverage scope, stated exactly so the gate cannot quietly shrink:
      //
      //   Covered:   every .ts module under src/api/ and src/scene/ at any
      //              depth (`**`), including any file added later (a new
      //              untested module fails the gate instead of being invisible
      //              to it). A single-level glob (`src/api/*.ts`) would let a
      //              nested `src/api/v2/x.ts` slip past unmeasured.
      //   Excluded:  src/scene/shaders/** (GLSL string modules: no branches,
      //              verified by the WebGL compiler, not by a statement
      //              counter); test files themselves; src/api/client.ts (the
      //              HTTP layer, exercised end-to-end by the Python API tests
      //              rather than by mocking fetch here); src/api/types.ts
      //              (type-only, no runtime statements).
      //   Not covered on purpose: React/three components (src/**/*.tsx,
      //              src/state/, src/components/) -- they need a WebGL/DOM
      //              harness this suite does not provide.
      //
      // Thresholds apply per file, so one well-covered module cannot mask a
      // neglected one behind an aggregate number.
      include: ['src/api/**/*.ts', 'src/scene/**/*.ts'],
      exclude: [
        'src/scene/shaders/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/api/client.ts',
        'src/api/types.ts',
      ],
      thresholds: { perFile: true, statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
})
