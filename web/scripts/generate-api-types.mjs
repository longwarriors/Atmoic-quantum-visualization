#!/usr/bin/env node
/**
 * Generate `src/api/schema.gen.ts` from the committed OpenAPI fixture.
 *
 * The front-end's request and response shapes are decided in
 * `src/quviz/api/`, on the other side of a process boundary that no compiler
 * crosses. Hand-writing them in TypeScript makes the two descriptions
 * independent, and independent descriptions of one thing drift -- silently,
 * because each side's tests only ever see its own copy.
 *
 * So the chain is `routes -> tests/fixtures/openapi.json -> schema.gen.ts`,
 * generated end to end and gated at both links:
 *
 *   - `scripts/write_openapi.py` writes the fixture from the live app, and
 *     `tests/test_openapi_contract.py` fails on any difference between it and
 *     what the app serves today;
 *   - this module writes the types from that fixture, and
 *     `src/api/schema.gen.test.ts` fails on any difference between its output
 *     and the committed file.
 *
 * The FIXTURE is the input, deliberately, not a running server: a build step
 * that fetches `http://localhost:8000/openapi.json` needs a live backend to
 * produce a checked-in artefact, which makes the artefact depend on whichever
 * server the author happened to have running.
 *
 * `generateApiTypes` is exported so the spec can run the very function
 * `npm run codegen` runs. Going through the `openapi-typescript` CLI instead
 * would leave everything this module decides -- the banner, the options, the
 * input path -- outside the gate, and that is exactly where a drift would sit.
 *
 * Usage:
 *
 *   npm run codegen          # from web/
 *   node scripts/generate-api-types.mjs
 *
 * Plain ESM. `src/api/schema.gen.test.ts` imports `generateApiTypes`; the
 * hand-written `generate-api-types.d.mts` beside this file is what lets it,
 * under `allowJs: false`.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'

/**
 * Prepended to the generated module verbatim.
 *
 * A committed generated file is indistinguishable from a hand-written one
 * until it says otherwise, so it says otherwise on line 1, and it names BOTH
 * regeneration steps: editing the fixture without rerunning the Python script
 * is the same mistake one link upstream.
 *
 * Ends with a blank line so the first declaration `astToString` emits is not
 * glued to the end of the banner comment.
 */
const BANNER = `/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Written by \`npm run codegen\` (web/scripts/generate-api-types.mjs) from
 * tests/fixtures/openapi.json, which is itself written from the live FastAPI
 * app by \`uv run python scripts/write_openapi.py\`.
 *
 * To change anything here, change the API in src/quviz/api/, then rerun both
 * generators. src/api/schema.gen.test.ts regenerates this file from the
 * fixture and fails on any difference, so an edit made here by hand does not
 * survive \`npm test\`.
 */

`

/**
 * The TypeScript source for `schemaUrl`, exactly as the committed module holds it.
 *
 * Takes a URL rather than a path so the caller states where the schema is
 * once, and so the spec can point it at a throwaway copy without this module
 * knowing about test directories.
 */
export async function generateApiTypes(schemaUrl) {
  return BANNER + astToString(await openapiTS(schemaUrl))
}

async function main() {
  const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const schemaUrl = new URL('../../tests/fixtures/openapi.json', import.meta.url)
  const target = resolve(webRoot, 'src/api/schema.gen.ts')
  const source = await generateApiTypes(schemaUrl)
  // No newline translation: .gitattributes checks this tree out with LF, and
  // the spec compares the file byte for byte.
  writeFileSync(target, source, 'utf-8')
  console.log(`generate-api-types: ${target} (${source.length} characters)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
