/**
 * Hand-written declarations for generate-api-types.mjs so
 * src/api/schema.gen.test.ts can import it under `allowJs: false`. Keep in
 * step with the .mjs exports.
 */

/**
 * The TypeScript source generated from the OpenAPI document at `schemaUrl`,
 * banner included -- byte for byte what `npm run codegen` writes to
 * `src/api/schema.gen.ts`.
 */
export function generateApiTypes(schemaUrl: URL): Promise<string>
