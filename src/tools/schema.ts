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
  templateId: generateImageFromTemplateSchema.templateId,
  modify: generateImageFromTemplateSchema.modify,
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

export const getTemplateSchema = {
  templateId: z.string().describe('Id of the template to fetch.'),
} satisfies z.ZodRawShape;

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
export type CreatePreviewLinkArgs = z.infer<
  z.ZodObject<typeof createPreviewLinkSchema>
>;
