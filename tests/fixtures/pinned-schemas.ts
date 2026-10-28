/**
 * Properties added to a pinned tool after the fixture was taken, each checked in its own test:
 * AC189 added the optional `strict` flag to `generate_image_from_template`
 * (tests/integration/strict-warnings.test.ts), and AC1 of the 2026-10-26 MCP API parity spec added
 * optional `name`, `description`, `viewportWidth` and `viewportHeight` to `create_template`
 * (tests/integration/api-parity.test.ts).
 */
const ADDED_PROPERTIES: Record<string, string[]> = {
  create_template: ['name', 'description', 'viewportWidth', 'viewportHeight'],
};

/**
 * A tool's input schema as `existing-tool-input-schemas.json` pins it, with the properties added
 * since left out of the comparison. Everything else stays pinned.
 */
export function pinnedShapeOf(schema: unknown, toolName?: string): unknown {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!properties) return schema;
  const added = ['strict', ...((toolName && ADDED_PROPERTIES[toolName]) || [])];
  if (!added.some((key) => key in properties)) return schema;
  const rest = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !added.includes(key))
  );
  return { ...(schema as object), properties: rest };
}
