import type { CreatedTemplate, OjoApiClient } from '../../server/ojo-client.js';
import type {
  CreateTemplateArgs,
  DeleteTemplateArgs,
  GetTemplateArgs,
  ListRendersArgs,
  ListTemplatesArgs,
  UpdateTemplateArgs,
} from '../schema.js';
import { errorResult, textResult, toErrorResult } from '../result.js';

export function makeListTemplates(client: OjoApiClient) {
  return async (args: ListTemplatesArgs) => {
    try {
      const result = await client.listTemplates(args);
      return textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeGetTemplate(client: OjoApiClient) {
  return async (args: GetTemplateArgs) => {
    try {
      const result = await client.getTemplate(args.templateId);
      return textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

function templateResult({ warnings = [], ...result }: CreatedTemplate) {
  return textResult(
    [JSON.stringify(result, null, 2), ...warnings.map((warning) => `warning: ${warning}`)].join('\n')
  );
}

export function makeCreateTemplate(client: OjoApiClient) {
  return async (args: CreateTemplateArgs) => {
    try {
      const { html, ...fields } = args;
      return templateResult(await client.createTemplate(html, fields));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeUpdateTemplate(client: OjoApiClient) {
  return async (args: UpdateTemplateArgs) => {
    try {
      // An empty html is no html, as the API reads it.
      const { templateId, html, ...rest } = args;
      const fields = { ...rest, html: html || undefined };
      const redraws = fields.html !== undefined || fields.variables !== undefined;
      if (!redraws && fields.name === undefined) {
        return errorResult('Nothing to update: give `name`, `html` or `variables`.');
      }
      // The API keeps a viewport only when it redraws the preview; a rename alone would drop it.
      if (!redraws && (fields.viewportWidth !== undefined || fields.viewportHeight !== undefined)) {
        return errorResult('A viewport is kept only together with `html` or `variables`.');
      }
      return templateResult(await client.updateTemplate(templateId, fields));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeListRenders(client: OjoApiClient, webBaseUrl: string) {
  return async (args: ListRendersArgs) => {
    try {
      const { items, currentPage, totalPages, totalItems } = await client.listRenders(args);
      // Remote: no file links, which open for anyone holding them; an agent misled by a page it
      // read could otherwise collect and send out every one (AC1386, SG4).
      const lines = items.map((item) =>
        [`id: ${item.id}`, ...(client.remote ? [] : [`url: ${item.url}`]), `created: ${item.createdAt}`]
          .concat(item.pages == null ? [] : [`pages: ${item.pages}`])
          .join('\n')
      );
      lines.push(`Page ${currentPage} of ${totalPages} (${totalItems} ${args.format === 'pdf' ? 'PDFs' : 'images'}).`);
      if (client.remote) {
        lines.push(`Open a file from ${webBaseUrl.replace(/\/+$/, '')}/dashboard/renders.`);
      }
      return textResult(lines.join('\n\n'));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeGetCredits(client: OjoApiClient) {
  return async () => {
    try {
      const { left, total, expiresAt } = await client.getCredits();
      return textResult(
        `${left} of ${total} credits left` +
          (expiresAt ? `, the last batch expires ${expiresAt}.` : '. Choose a plan at https://ojo.so/pricing.')
      );
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeDeleteTemplate(client: OjoApiClient) {
  return async (args: DeleteTemplateArgs) => {
    try {
      await client.deleteTemplate(args.templateId);
      return textResult(`Template ${args.templateId} deleted.`);
    } catch (error) {
      return toErrorResult(error);
    }
  };
}
