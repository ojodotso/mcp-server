import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OjoApiError } from '../server/ojo-client.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Map any thrown value to an MCP error result the agent can read. */
export function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof OjoApiError) {
    return errorResult(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResult(`Unexpected error: ${message}`);
}
