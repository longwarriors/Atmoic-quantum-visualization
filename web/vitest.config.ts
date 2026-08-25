import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Mirrored by tsconfig.test.json (include) and tsconfig.app.json (exclude)
    // so a spec/__tests__ file is type-checked with the tests and kept out of
    // the production build.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    // A committed `.only` silently narrows the suite to one case. Without this
    // the run still reports "passed" and the only signal is the coverage gate
    // tripping as a side effect, which a small spec can dodge. Refuse outright.
    allowOnly: false,
    // Writes the coverage config vitest RESOLVED for this run (CLI flags,
    // plugin config() hooks and env overrides folded in) to
    // coverage/resolved-coverage.json, which scripts/assert-coverage-scope.mjs
    // deep-equals against coverage-scope.json's `resolvedCoverage` after the
    // run. Nothing else can see that config: every assertion over THIS file
    // reads what it declares, and the coverage report is written by whichever
    // provider the resolved config named -- which is the point, because
    // `--coverage.provider=custom` makes that a module in this repo.
    // Removing this line fails twice: src/guards.test.ts deep-equals it, and
    // the gate hard-fails on a missing capture.
    globalSetup: ['./scripts/capture-resolved-coverage.mjs'],
    coverage: {
      // The measurer. A `custom` provider does not instrument anything -- it
      // hands vitest whatever coverage-final.json its module chooses to
      // write -- so this value is checked three times over: here against
      // src/guards.test.ts's literal, in the resolved capture above, and in
      // coverage-scope.json's `resolvedCoverage`.
      provider: 'v8',
      // Coverage scope, stated exactly so the gate cannot quietly shrink:
      //
      //   Covered:   every .ts module under src/api/ and src/scene/ at any
      //              depth (`**`), including any file added later (a new
      //              untested module fails the gate instead of being invisible
      //              to it). A single-level glob (`src/api/*.ts`) would let a
      //              nested `src/api/v2/x.ts` slip past unmeasured.
      //              This includes src/api/client.ts, the HTTP layer: it is
      //              covered by src/api/client.test.ts with `fetch` stubbed
      //              (request path and query per call, signal and header
      //              passthrough, HTTP and network error mapping). The Python
      //              API tests drive the routes with Starlette's TestClient
      //              and never execute TypeScript, so they cannot stand in
      //              for this -- a broken path in client.ts left `npm test`
      //              green until this file gained its own spec.
      //   Excluded:  src/scene/shaders/** (GLSL string modules: no branches,
      //              verified by the WebGL compiler, not by a statement
      //              counter); test files themselves; src/api/types.ts
      //              (type-only, no runtime statements).
      //   Not covered on purpose: React/three components (src/**/*.tsx,
      //              src/state/, src/components/) -- they need a WebGL/DOM
      //              harness this suite does not provide. Those, together
      //              with QVPC body validation (NaN / Inf / negative
      //              intensity samples inside the payload, as opposed to the
      //              header checks qvpc.ts already makes), are PR-8 items and
      //              deliberately outside this gate until then.
      //
      // The rest of the contract is enforced in two places:
      //   - scripts/assert-no-skips.mjs, run by `npm test` after vitest over
      //     the JSON report written to coverage/vitest-results.json: fails on
      //     any test not reported "passed", any spec file missing from the
      //     report, or any non-zero pending/todo/failed counter. This is the
      //     authoritative skip gate because it sees what the runner did, not
      //     how the spec was spelled.
      //   - src/guards.test.ts: source scan for skip/todo/focus/conditional
      //     modifiers in any spelling it knows (plain, chained, bracketed,
      //     destructured, runtime context) and for coverage pragmas of the
      //     v8 / c8 / istanbul / node:coverage families inside gated modules.
      //
      // Thresholds apply per file, so one well-covered module cannot mask a
      // neglected one behind an aggregate number.
      include: ['src/api/**/*.ts', 'src/scene/**/*.ts'],
      exclude: [
        'src/scene/shaders/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/api/types.ts',
      ],
      thresholds: { perFile: true, statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
})
