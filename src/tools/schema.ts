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

export const generateImageFromHtmlSchema = {
  html: z
    .string()
    .describe(
      'Plain HTML (with inline CSS) to render into an image. Do NOT base64-encode it.'
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
      'Plain HTML/Handlebars for the template, using {{variable}} placeholders. Do NOT base64-encode it.'
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
      'Plain HTML/Handlebars to preview, using {{variable}} placeholders. Do NOT base64-encode it.'
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
export type ListTemplatesArgs = z.infer<z.ZodObject<typeof listTemplatesSchema>>;
export type GetTemplateArgs = z.infer<z.ZodObject<typeof getTemplateSchema>>;
export type CreateTemplateArgs = z.infer<
  z.ZodObject<typeof createTemplateSchema>
>;
export type CreatePreviewLinkArgs = z.infer<
  z.ZodObject<typeof createPreviewLinkSchema>
>;
