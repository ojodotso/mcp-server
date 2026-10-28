import { z } from 'zod';

const viewportWidth = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Viewport width in pixels (default 1280).');

const viewportHeight = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Viewport height in pixels (default 800).');

const transparentBackground = z
  .boolean()
  .optional()
  .describe('Render with a transparent background instead of white.');

const inspect = z
  .boolean()
  .optional()
  .describe(
    'When true, also return a small downscaled preview image of the result so you can see it and iterate.'
  );

/**
 * Every HTML-taking tool has the same trap: the markup is rendered somewhere
 * that cannot see the agent's filesystem — a browser for a draft link, the oJo
 * render service for a paid render — and the render CSP allows `https:` and
 * `data:` but has no `file:`. A local path therefore renders blank rather than
 * failing loudly, so the rule is stated on the input the agent is composing.
 */
const SELF_CONTAINED_RULE =
  ' The markup must be self-contained: reference images, fonts and scripts by' +
  ' public https URL, or inline small ones as data: URIs. A local or relative' +
  ' path (./logo.png, /home/..., file://...) renders blank — nothing that' +
  ' renders this HTML can read your filesystem.';

export const generateImageFromHtmlSchema = {
  html: z
    .string()
    .describe(
      'Plain HTML (with inline CSS) to render into an image. Do NOT base64-encode it.' +
        SELF_CONTAINED_RULE
    ),
  viewportWidth,
  viewportHeight,
  transparentBackground,
  inspect,
} satisfies z.ZodRawShape;

const strict = z
  .boolean()
  .optional()
  .describe(
    'true to fail instead of rendering when the result would list warnings: a `modify` key the' +
      ' template does not read, or an input left out that would print its default or nothing.'
  );

export const generateImageFromTemplateSchema = {
  templateId: z
    .string()
    .describe('Id of an existing oJo template (from list_templates).'),
  modify: z
    .record(z.any())
    .optional()
    .describe(
      'Modify Payload: per-render values that override the template variable defaults (merged over the defaults).'
    ),
  viewportWidth,
  viewportHeight,
  transparentBackground,
  inspect,
  strict,
} satisfies z.ZodRawShape;

export const generatePdfFromHtmlSchema = {
  html: z
    .string()
    .describe(
      'Plain HTML (with inline CSS) to render into a PDF. Do NOT base64-encode it.' +
        ' Pages are A4 unless a CSS @page rule sets size and margins.' +
        SELF_CONTAINED_RULE
    ),
} satisfies z.ZodRawShape;

export const generatePdfFromTemplateSchema = {
  templateId: generateImageFromTemplateSchema.templateId
    .optional()
    .describe(
      'Id of an existing oJo template (from list_templates). With `pages`, the default template' +
        ' for entries that name none; optional when every entry names a template or gives html.'
    ),
  modify: generateImageFromTemplateSchema.modify
    .optional()
    .describe(
      'Variables to override. With `pages`, shared by every template entry, under each' +
        " entry's own `modify`."
    ),
  pages: z
    .array(
      z.object({
        templateId: z
          .string()
          .optional()
          .describe('Template for this entry. Defaults to the top-level templateId.'),
        html: z
          .string()
          .optional()
          .describe(
            'HTML for this entry instead of a template, printed as is with no variables.' +
              SELF_CONTAINED_RULE
          ),
        modify: z
          .record(z.any())
          .optional()
          .describe("Variables for this entry, over the template's and the top-level modify."),
      })
    )
    .max(100)
    .optional()
    .describe(
      'Documents of one PDF, merged in order, up to 100 entries. Each entry gives templateId or' +
        ' html (not both), or neither to use the top-level templateId, and prints at least one page.'
    ),
  strict,
} satisfies z.ZodRawShape;

export const listTemplatesSchema = {
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('1-based page number (default 1).'),
  pageSize: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Number of templates per page (default 10).'),
  sort: z
    .enum(['asc', 'desc'])
    .optional()
    .describe('Sort by creation time, ascending or descending (default desc).'),
} satisfies z.ZodRawShape;

export const listRendersSchema = {
  format: z.enum(['image', 'pdf']).describe('List images (PNG) or PDFs.'),
  page: z.number().int().min(1).optional().describe('1-based page number (default 1).'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Renders per page, 1 to 100 (default 10).'),
  sort: listTemplatesSchema.sort,
} satisfies z.ZodRawShape;

export const getCreditsSchema = {} satisfies z.ZodRawShape;

export const getTemplateSchema = {
  templateId: z.string().describe('Id of the template to fetch.'),
} satisfies z.ZodRawShape;

// The API's rule: 1 to 120 characters, not blank (apps/server/src/routes/template.ts).
const templateName = z
  .string()
  .refine(
    (name) => name.trim().length >= 1 && name.trim().length <= 120,
    'The name must be 1 to 120 characters, spaces at either end not counted.'
  )
  .optional()
  .describe('Template name shown in the dashboard and list_templates, 1 to 120 characters.');

export const createTemplateSchema = {
  html: z
    .string()
    .describe(
      'Plain HTML/Handlebars for the template, using {{variable}} placeholders. Do NOT base64-encode it.' +
        SELF_CONTAINED_RULE
    ),
  variables: z
    .record(z.any())
    .optional()
    .describe(
      'Template Variables: the default values/shape for the template placeholders (the schema, not per-render data).'
    ),
  name: templateName,
  description: z
    .string()
    .max(300)
    .optional()
    .describe('What the template is for, up to 300 characters.'),
  viewportWidth: viewportWidth.describe(
    "Width in pixels of the template's preview and PDF renders, kept only with viewportHeight." +
      ' Image renders do not read it: pass the viewport on every image render.'
  ),
  viewportHeight: viewportHeight.describe(
    "Height in pixels of the template's preview and PDF renders, kept only with viewportWidth." +
      ' Image renders do not read it: pass the viewport on every image render.'
  ),
} satisfies z.ZodRawShape;

export const updateTemplateSchema = {
  templateId: z.string().describe('Id of the template to update.'),
  name: templateName,
  html: createTemplateSchema.html.optional(),
  variables: createTemplateSchema.variables,
  viewportWidth: createTemplateSchema.viewportWidth,
  viewportHeight: createTemplateSchema.viewportHeight,
} satisfies z.ZodRawShape;

export const deleteTemplateSchema = {
  templateId: z.string().describe('Id of the template to delete.'),
} satisfies z.ZodRawShape;

export const generateImagesFromTemplateSchema = {
  templateId: generateImageFromTemplateSchema.templateId,
  modifications: z
    .array(z.record(z.any()))
    .min(1)
    .max(50)
    .describe(
      'One Modify Payload per image, 1 to 50, rendered in this order. Each overrides the template' +
        ' variable defaults for its own image.'
    ),
  viewportWidth,
  viewportHeight,
  transparentBackground,
  strict,
} satisfies z.ZodRawShape;

export const checkPdfSchema = {
  html: generatePdfFromHtmlSchema.html,
} satisfies z.ZodRawShape;

export const createPreviewLinkSchema = {
  html: z
    .string()
    .describe(
      'Plain HTML/Handlebars to preview, using {{variable}} placeholders. Do NOT base64-encode it.' +
        SELF_CONTAINED_RULE +
        ' Prefer https URLs over inlining here: the whole draft is compressed' +
        ' into the link, and a data: URI does not compress, so an inlined asset' +
        ' costs its full size in the URL while text-heavy markup costs about a' +
        ' quarter of it.'
    ),
  variables: z
    .record(z.any())
    .optional()
    .describe(
      'Modify Payload: values to fill the placeholders for this preview render.'
    ),
  viewportWidth,
  viewportHeight,
} satisfies z.ZodRawShape;

export type GenerateImageFromHtmlArgs = z.infer<
  z.ZodObject<typeof generateImageFromHtmlSchema>
>;
export type GenerateImageFromTemplateArgs = z.infer<
  z.ZodObject<typeof generateImageFromTemplateSchema>
>;
export type GeneratePdfFromHtmlArgs = z.infer<
  z.ZodObject<typeof generatePdfFromHtmlSchema>
>;
export type GeneratePdfFromTemplateArgs = z.infer<
  z.ZodObject<typeof generatePdfFromTemplateSchema>
>;
export type ListTemplatesArgs = z.infer<z.ZodObject<typeof listTemplatesSchema>>;
export type GetTemplateArgs = z.infer<z.ZodObject<typeof getTemplateSchema>>;
export type CreateTemplateArgs = z.infer<
  z.ZodObject<typeof createTemplateSchema>
>;
export type UpdateTemplateArgs = z.infer<
  z.ZodObject<typeof updateTemplateSchema>
>;
export type DeleteTemplateArgs = z.infer<z.ZodObject<typeof deleteTemplateSchema>>;
export type GenerateImagesFromTemplateArgs = z.infer<
  z.ZodObject<typeof generateImagesFromTemplateSchema>
>;
export type ListRendersArgs = z.infer<z.ZodObject<typeof listRendersSchema>>;
export type CheckPdfArgs = z.infer<z.ZodObject<typeof checkPdfSchema>>;
export type CreatePreviewLinkArgs = z.infer<
  z.ZodObject<typeof createPreviewLinkSchema>
>;
