import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OjoApiClient } from '../server/ojo-client.js';
import {
  createPreviewLinkSchema,
  createTemplateSchema,
  generateImageFromHtmlSchema,
  generateImageFromTemplateSchema,
  generatePdfFromHtmlSchema,
  generatePdfFromTemplateSchema,
  getTemplateSchema,
  listTemplatesSchema,
  updateTemplateSchema,
} from './schema.js';
import {
  makeGenerateImageFromHtml,
  makeGenerateImageFromTemplate,
} from './handlers/image-handlers.js';
import {
  makeGeneratePdfFromHtml,
  makeGeneratePdfFromTemplate,
} from './handlers/pdf-handlers.js';
import {
  makeCreateTemplate,
  makeGetTemplate,
  makeListTemplates,
  makeUpdateTemplate,
} from './handlers/template-handlers.js';
import { makeCreatePreviewLink } from './handlers/preview-handlers.js';

/** Paged-media rules both PDF tools share, each measured on the production print path
 * (2026-10-05). Recipes: apps/web/content/pdf-layout.mdx. */
const PAGED_MEDIA_RULES =
  ' Headers, footers and page numbers go in @page margin boxes such as @top-left and ' +
  '@bottom-right (content: "Page " counter(page) " of " counter(pages)), each with its own ' +
  'font. A <thead> repeats on every page, `break-inside: avoid` keeps a row or block whole ' +
  'and `break-after: avoid` keeps a heading with what follows. A named page (`@page cover ' +
  '{ counter-reset: page 0 }` plus `.cover { page: cover }`) changes the header, margins or ' +
  'size of a section. For charts or other scripts, put class wait-for-render on <body> and ' +
  'add render-complete when done (printed anyway after 5 s), with animations off. Not ' +
  'supported: target-counter() page numbers, string-set running headers, bookmarks. ' +
  'Recipes: https://ojo.so/docs/pdf-layout';

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

// Directory reviews (Claude, ChatGPT) ask every tool to state these. Only `update_template`
// overwrites: clients that confirm destructive tools ask the user first (AC594).
const READ_ONLY = { readOnlyHint: true, destructiveHint: false };
const CREATES = { readOnlyHint: false, destructiveHint: false };
const OVERWRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

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
      annotations: READ_ONLY,
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
      annotations: CREATES,
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
      annotations: CREATES,
    },
    makeGenerateImageFromTemplate(client)
  );

  server.registerTool(
    'generate_pdf_from_html',
    {
      title: 'Generate PDF from HTML',
      description:
        'Render plain HTML (with inline CSS) into a PDF document and return its ' +
        'public URL and page count. COSTS 1 CREDIT per 20 pages, rounded up (up to 5 ' +
        'credits). A document over 100 pages is refused and costs nothing. Pages are A4 ' +
        'unless the HTML sets a CSS `@page` rule (size, margin). Content flows onto further pages, ' +
        'and `break-before: page` starts a new one. `create_preview_link` shows the ' +
        'screen rendering for free, not the page breaks.' +
        PAGED_MEDIA_RULES,
      inputSchema: generatePdfFromHtmlSchema,
      annotations: CREATES,
    },
    makeGeneratePdfFromHtml(client)
  );

  server.registerTool(
    'generate_pdf_from_template',
    {
      title: 'Generate PDF from template',
      description:
        'Render an existing oJo template into a PDF document, optionally ' +
        'overriding its variables via `modify`, and return its public URL, page ' +
        'count and credits spent. With `pages`, one PDF is built from many entries ' +
        '(templates with their own `modify`, or HTML), each starting on a new page, ' +
        'merged in order. COSTS 1 CREDIT per 20 pages, rounded up (up to 5 credits). ' +
        'A PDF over 100 pages in total is refused and costs nothing. Page size: a CSS ' +
        '`@page` rule first (it may use a variable such as `size: {{pageSize}}`), ' +
        "then the template's saved size, then A4. A request with `pages` can take " +
        'about a minute. If it is abandoned, the PDF may still be made and charged, ' +
        'and is listed by GET /v1/pdf and on the dashboard Storage page.' +
        PAGED_MEDIA_RULES +
        '. A variable in header text goes through a CSS variable: ' +
        "<html style=\"--title: '{{title}}'\"> and content: var(--title), with no apostrophe " +
        'in the value. The template engine reads {{ inside scripts too: pass data with ' +
        '`const data = {{json data}};` and write `{ {` for two literal braces.',
      inputSchema: generatePdfFromTemplateSchema,
      annotations: CREATES,
    },
    makeGeneratePdfFromTemplate(client)
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description:
        'List the oJo templates available to this account, each with its `inputs` (every data' +
        ' path its HTML reads, such as `items[].title`) and its variable defaults.',
      inputSchema: listTemplatesSchema,
      annotations: READ_ONLY,
    },
    makeListTemplates(client)
  );

  server.registerTool(
    'get_template',
    {
      title: 'Get template',
      description:
        'Fetch one oJo template by id, returning its HTML, its variable defaults and its' +
        ' `inputs`: every data path the HTML reads, such as `items[].title`.',
      inputSchema: getTemplateSchema,
      annotations: READ_ONLY,
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
      annotations: CREATES,
    },
    makeCreateTemplate(client)
  );

  server.registerTool(
    'update_template',
    {
      title: 'Update template',
      description:
        'Replace the HTML of an existing oJo template this account owns, and its variable defaults ' +
        'when `variables` is given (left out, the stored defaults stay). The template keeps its ID: ' +
        'API renders and an oJo editor open on it use the new version at once, so check the design ' +
        'with `create_preview_link` first. Does not cost a credit.',
      inputSchema: updateTemplateSchema,
      annotations: OVERWRITES,
    },
    makeUpdateTemplate(client)
  );
}
