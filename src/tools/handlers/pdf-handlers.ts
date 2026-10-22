import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GeneratedPdf, OjoApiClient } from '../../server/ojo-client.js';
import type {
  GeneratePdfFromHtmlArgs,
  GeneratePdfFromTemplateArgs,
} from '../schema.js';
import { textResult, toErrorResult } from '../result.js';

export function makeGeneratePdfFromHtml(client: OjoApiClient) {
  return async (args: GeneratePdfFromHtmlArgs): Promise<CallToolResult> => {
    try {
      return textResult(formatPdf(await client.createPdfFromHtml(args.html)));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeGeneratePdfFromTemplate(client: OjoApiClient) {
  return async (args: GeneratePdfFromTemplateArgs): Promise<CallToolResult> => {
    try {
      const pdf = await client.createPdfFromTemplate({
        templateId: args.templateId,
        modify: args.modify,
        pages: args.pages,
        strict: args.strict,
      });
      return textResult(formatPdf(pdf));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

function formatPdf(pdf: GeneratedPdf): string {
  return [
    'PDF generated successfully.',
    `id: ${pdf.id}`,
    `url: ${pdf.pdfUrl}`,
    `pages: ${pdf.pages}`,
    `credits: ${pdf.credits}`,
    ...(pdf.entries
      ? [`pages per entry: ${pdf.entries.map((entry) => entry.pages).join(', ')}`]
      : []),
    ...(pdf.warnings ?? []).map((warning) => `warning: ${warning}`),
  ].join('\n');
}
