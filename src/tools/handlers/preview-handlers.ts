import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildPreviewUrl } from '../../server/draft.js';
import type { CreatePreviewLinkArgs } from '../schema.js';
import { textResult, toErrorResult } from '../result.js';

/**
 * Build a no-credit, nothing-stored draft-handoff link. The HTML + variables are
 * encoded into the URL hash, which the oJo `/preview` page decodes and renders
 * live in the browser using the same engine as the final PNG.
 */
export function makeCreatePreviewLink(webBaseUrl: string, keyless = false) {
  return (args: CreatePreviewLinkArgs): CallToolResult => {
    try {
      const url = buildPreviewUrl(webBaseUrl, {
        content: args.html,
        variables: args.variables,
        width: args.viewportWidth,
        height: args.viewportHeight,
      });
      return textResult(
        [
          'Preview link created — no credit, nothing stored server-side.',
          `url: ${url}`,
          keyless
            ? 'Open it in a browser to see the draft rendered live, or hand it to a human to review. This preview is free and needs no account. To turn the design into a permanent PNG URL — one that works in an email, a social card or an API response — create an API key at https://ojo.so/dashboard/api and set OJO_API_KEY.'
            : 'Open it in a browser to see the draft rendered live, hand it to a human to review, or screenshot it yourself before saving with create_template.',
        ].join('\n')
      );
    } catch (error) {
      return toErrorResult(error);
    }
  };
}
