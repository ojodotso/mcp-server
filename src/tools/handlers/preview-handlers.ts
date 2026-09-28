import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildPreviewUrl } from '../../server/draft.js';
import type { CreatePreviewLinkArgs } from '../schema.js';
import { textResult, toErrorResult } from '../result.js';

/**
 * Ceiling on the encoded link. Measured 2026-08-14 against the live `/preview`
 * page: Chromium renders a draft URL up to 2 MB and only aborts at 4 MB, so the
 * browser is NOT what binds here — the agent's context is. The link is returned
 * as text, so its size is paid twice, once to emit and once on every subsequent
 * turn that carries it. 16 KB buys ~69 KB of text-heavy markup (the codec runs
 * about 0.23x on prose-like HTML) while staying an order of magnitude under
 * every published browser limit, including the ones not measurable here
 * (WebKit, Firefox). Inlined binary assets do NOT compress — they land in the
 * URL roughly byte for byte — which is what this limit actually catches.
 */
const MAX_PREVIEW_URL_CHARS = 16 * 1024;

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
      if (url.length > MAX_PREVIEW_URL_CHARS) {
        return textResult(
          [
            `Draft too large to put in a link: the encoded URL is ${(url.length / 1024).toFixed(1)} KB, over the ${MAX_PREVIEW_URL_CHARS / 1024} KB limit.`,
            'The usual cause is an inlined asset. A data: URI is already compressed, so it lands in the URL at close to its full size, while ordinary markup compresses to roughly a quarter.',
            'Fix by replacing inlined images, fonts or scripts with public https URLs — the preview renderer allows them — or by trimming the draft. Around 69 KB of text-heavy HTML fits.',
          ].join('\n')
        );
      }
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
