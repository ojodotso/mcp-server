/**
 * A tool's input schema as `existing-tool-input-schemas.json` pins it. AC189 added the optional
 * `strict` flag to `generate_image_from_template`, so it is left out of the comparison; its own
 * shape is checked in tests/integration/strict-warnings.test.ts. Everything else stays pinned.
 */
export function pinnedShapeOf(schema: unknown): unknown {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!properties || !('strict' in properties)) return schema;
  const { strict: _strict, ...rest } = properties;
  return { ...(schema as object), properties: rest };
}
