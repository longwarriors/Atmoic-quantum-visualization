import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The default stays `node`. React/three specs opt into jsdom per file
    // with a `/** @vitest-environment jsdom */` docblock on line 1, so the
    // plain-TypeScript specs keep running without a DOM they do not use.
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
      //   Covered:   EVERY .ts and .tsx module under src/, at any depth
      //              (`**`), including any file added later (a new untested
      //              module fails the gate instead of being invisible to it).
      //              A single-level glob (`src/*.ts`) would let a nested
      //              `src/api/v2/x.ts` slip past unmeasured.
      //              This includes src/api/client.ts, the HTTP layer: it is
      //              covered by src/api/client.test.ts with `fetch` stubbed
      //              (request path and query per call, signal and header
      //              passthrough, HTTP and network error mapping). The Python
      //              API tests drive the routes with Starlette's TestClient
      //              and never execute TypeScript, so they cannot stand in
      //              for this -- a broken path in client.ts left `npm test`
      //              green until this file gained its own spec.
      //              This includes src/scene/shaders/: those modules export
      //              GLSL as template literals, which a statement counter has
      //              nothing useful to say about, and the directory used to be
      //              excluded whole for that reason. That was an escape hatch,
      //              not a scope decision -- nothing checked that the
      //              directory still held only GLSL strings, so an ordinary
      //              .ts helper with an uncovered branch could live there, be
      //              imported by a gated module, ship in the bundle and leave
      //              every gate green (measured: `npm test` at exit 0 with
      //              color.ts still reporting 100%). Gating the directory like
      //              any other costs one import-and-assert spec per shader
      //              module (src/scene/shaders/orbitalPoints.test.ts) and
      //              leaves no exclusion to police.
      //              The .tsx half -- the React/three layer under
      //              src/components/, src/scene/ and src/state/ -- is new in
      //              PR-8A. It was outside this gate while there was no DOM
      //              harness, and that carve-out was a documented ESCAPE: a
      //              gated module's body moved into src/state/ or
      //              src/components/ with a one-line re-export left behind
      //              reported 100% with the whole gate green (reproduced).
      //              Specs opt into jsdom per file with a
      //              `@vitest-environment jsdom` docblock and mount
      //              three/react components through
      //              @react-three/test-renderer, so the environment default
      //              below stays `node` for the plain-TypeScript specs.
      //   Excluded:  test files themselves; src/api/types.ts (type-only, no
      //              runtime statements -- and that claim is enforced, see
      //              src/guards.test.ts "keeps the modules coverage excludes
      //              as type-only actually type-only").
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
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/api/types.ts',
        // Generated from tests/fixtures/openapi.json by `npm run codegen`, and
        // type-only for the same reason src/api/types.ts is: openapi-typescript
        // emits interfaces and type aliases, so the compiler emits nothing at
        // all for this module (verified: `export {}` and the banner comment).
        // Excluded from the per-file THRESHOLDS only -- it stays in
        // coverage-scope.json's pragmaScanned, so src/guards.test.ts parses it
        // and fails the moment it stops being type-only, and
        // src/api/schema.gen.test.ts regenerates it and fails on any drift.
        'src/api/schema.gen.ts',
      ],
      thresholds: { perFile: true, statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
})
