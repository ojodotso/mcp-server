import { gzipSync } from 'node:zlib';

/**
 * Draft payload handed to the oJo `/preview` page via a URL hash. Mirrors the
 * `@ojo/libs` Draft codec on the web side — kept inline here because the
 * published MCP server carries no workspace dependencies (HTTP-only boundary).
 * The wire format is standard gzip + base64url, which the browser decodes with
 * `DecompressionStream('gzip')`.
 */
export interface DraftPayload {
  /** Raw HTML/Handlebars body. */
  content: string;
  variables?: Record<string, unknown>;
  width?: number;
  height?: number;
}

/** Encode a draft payload into a gzip+base64url string for a `#draft=` hash. */
export function encodeDraft(payload: DraftPayload): string {
  const json = Buffer.from(JSON.stringify(payload), 'utf-8');
  return gzipSync(json).toString('base64url');
}

/** Build a `<base>/preview#draft=<encoded>` link for a draft payload. */
export function buildPreviewUrl(baseUrl: string, payload: DraftPayload): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/preview#draft=${encodeDraft(payload)}`;
}
