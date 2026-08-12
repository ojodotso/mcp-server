import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OjoApiClient } from '../server/ojo-client.js';
import {
  createPreviewLinkSchema,
  createTemplateSchema,
  generateImageFromHtmlSchema,
  generateImageFromTemplateSchema,
  getTemplateSchema,
  listTemplatesSchema,
} from './schema.js';
import {
  makeGenerateImageFromHtml,
  makeGenerateImageFromTemplate,
} from './handlers/image-handlers.js';
import {
  makeCreateTemplate,
  makeGetTemplate,
  makeListTemplates,
} from './handlers/template-handlers.js';
import { makeCreatePreviewLink } from './handlers/preview-handlers.js';

/** `create_preview_link` needs no API key, so its wording changes with the mode:
 * with a key it is the cheap first step before a paid render; without one it is
 * the whole product, and must not point at tools that are not registered. */
const PREVIEW_DESCRIPTION_WITH_KEY =
  'THE DEFAULT WAY TO ITERATE ON A DESIGN — free, unlimited, no credit. ' +
  'Returns an oJo `/preview` URL that renders the given HTML/Handlebars ' +
  'live in a browser at full resolution, through the SAME engine as the ' +
  'final PNG, so what you see is what you get. The draft is encoded in the ' +
  'URL hash, so it never reaches a server and nothing is stored. Open it ' +
  'and screenshot it to check your own work, or hand the link to a human ' +
  'for review. Only once the design is right, spend a credit with ' +
  '`generate_image_from_html` or persist it with `create_template`.';

const PREVIEW_DESCRIPTION_KEYLESS =
  'Render HTML/Handlebars into a live, full-resolution image preview — free, ' +
  'unlimited, and with no oJo account. Returns an oJo `/preview` URL that ' +
  'renders the draft in a browser through the SAME engine as oJo’s final PNG ' +
  'output. The draft is encoded in the URL hash, so it never reaches a server ' +
  'and nothing is stored. Open it and screenshot it, or hand the link to a ' +
  'human for review. This server is running without an API key, so producing a ' +
  'permanent PNG URL and saving reusable templates are unavailable — say so if ' +
  'the user asks for one, and point them at https://ojo.so/dashboard/api.';

/** Register the Slice 0 + Slice 1 tool surface on an McpServer.
 *
 * A `null` client is preview-only mode: every other tool talks to the oJo API,
 * so registering them without a key would advertise tools that can only fail. */
export function registerTools(
  server: McpServer,
  client: OjoApiClient | null,
  webBaseUrl: string
): void {
  server.registerTool(
    'create_preview_link',
    {
      title: 'Create preview link',
      description: client
        ? PREVIEW_DESCRIPTION_WITH_KEY
        : PREVIEW_DESCRIPTION_KEYLESS,
      inputSchema: createPreviewLinkSchema,
    },
    makeCreatePreviewLink(webBaseUrl, client === null)
  );

  if (!client) return;

  server.registerTool(
    'generate_image_from_html',
    {
      title: 'Generate image from HTML',
      description:
        'Render plain HTML (with inline CSS) into a PNG and return its public URL. ' +
        'COSTS 1 CREDIT — this is the final-render tool. While you are still ' +
        'shaping a design, iterate with `create_preview_link` first: it is free, ' +
        'full-resolution, and uses the same render engine. `inspect: true` adds a ' +
        '512px-wide thumbnail of the result — enough to sanity-check, too small to ' +
        'judge layout or typography.',
      inputSchema: generateImageFromHtmlSchema,
    },
    makeGenerateImageFromHtml(client)
  );

  server.registerTool(
    'generate_image_from_template',
    {
      title: 'Generate image from template',
      description:
        'Render an existing oJo template into a PNG, optionally overriding its ' +
        'variables via `modify`. COSTS 1 CREDIT — this is the final-render tool. ' +
        'To preview how a set of `modify` values will look without spending a ' +
        'credit, pass the template HTML from `get_template` to ' +
        '`create_preview_link` with those values as `variables`. `inspect: true` ' +
        'adds a 512px-wide thumbnail of the result.',
      inputSchema: generateImageFromTemplateSchema,
    },
    makeGenerateImageFromTemplate(client)
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description: 'List the oJo templates available to this account.',
      inputSchema: listTemplatesSchema,
    },
    makeListTemplates(client)
  );

  server.registerTool(
    'get_template',
    {
      title: 'Get template',
      description:
        'Fetch one oJo template by id, returning its decoded HTML and variable defaults.',
      inputSchema: getTemplateSchema,
    },
    makeGetTemplate(client)
  );

  server.registerTool(
    'create_template',
    {
      title: 'Create template',
      description:
        'Create a reusable oJo template from plain HTML/Handlebars (with optional variable defaults). Does not cost a credit.',
      inputSchema: createTemplateSchema,
    },
    makeCreateTemplate(client)
  );
}
