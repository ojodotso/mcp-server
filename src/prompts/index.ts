import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Handlebars helper catalog — keep in sync with
// packages/libs/src/template/handlebars-helpers.ts (and the public docs at
// apps/web/content/template-helpers.mdx). Drift here misleads the agent.
const GUIDE = `# Authoring oJo templates

You generate images from HTML. Two ways:
- **One-off:** \`generate_image_from_html\` with plain HTML + inline CSS.
- **Reusable:** \`create_template\` once, then \`generate_image_from_template\`
  with a per-render **Modify Payload** that fills the placeholders.

## Template Variables vs Modify Payload
- **Template Variables** = the *schema/defaults* you pass to \`create_template\`
  (the \`variables\` object). They are the shape of a template's inputs.
- **Modify Payload** = the *data for one render*, passed as \`modify\` to
  \`generate_image_from_template\`. Its keys override the variable defaults for
  that single image. Nested objects merge key by key; an array replaces the
  default array whole. A key you leave out prints its default, so send every
  field that differs per render. The result lists \`warning:\` lines for keys the
  template does not read and for fields that fell back to a default or printed
  empty; pass \`strict: true\` to get an error instead. \`get_template\` lists the
  template's \`inputs\`: every path its HTML reads, such as \`items[].title\`.

## Placeholders
Author placeholders in the HTML with Handlebars (not Liquid): \`{{title}}\`,
\`{{user.name}}\`, \`{{#each items}}...{{/each}}\`, \`{{#if premium}}...{{/if}}\`.
Helpers take arguments after the name: \`{{uppercase name}}\`, not \`{{ name | upcase }}\`.

## Helper catalog (the only helpers available)
- \`{{json value}}\` — value as JSON, safe inside \`<script>\`
- \`{{array value}}\` — same as json, for an array
- \`{{eq a b}}\` / \`{{gt a b}}\` / \`{{lt a b}}\` / \`{{gte a b}}\` / \`{{lte a b}}\` — comparisons; send numbers as JSON numbers (\`eq "90" 90\` is false)
- \`{{and a b ...}}\` / \`{{or a b ...}}\` / \`{{not a}}\` — logic, e.g. \`{{#if (gte score 90)}}\`
- \`{{ternary cond yes no}}\` — pick yes/no by condition
- \`{{formatDate dateString "YYYY-MM-DD"}}\` — dayjs formatting; send ISO 8601 dates
- \`{{isBefore date1 date2}}\` / \`{{isAfter date1 date2}}\` — date comparisons
- \`{{math a "+" b}}\` — arithmetic; operators: + - * / %
- \`{{round value decimals}}\` — fixed-decimal rounding
- \`{{inc value}}\` / \`{{dec value}}\` — +1 / -1
- \`{{concat a b c}}\` — concatenate strings
- \`{{formatCurrency amount "USD"}}\` — Intl currency, en-US separators; optional min and max digits: \`{{formatCurrency amount "EUR" 0 2}}\`
- \`{{formatNumber number}}\` — Intl number formatting; options as \`name=value\`, e.g. \`{{formatNumber 0.92 style="percent"}}\`
- \`{{uppercase s}}\` / \`{{lowercase s}}\` / \`{{capitalize s}}\` — case helpers
- \`{{substring s start end}}\` — slice a string
- \`{{len arr}}\` — array length
- \`{{#times n}}...{{/times}}\` — repeat a block n times; \`@index\` counts from 0
The formatting, date and text helpers print nothing for a value the render did not send (math, round, inc and dec print NaN).

## Viewport & background
Default viewport is 1280×800. Pass \`viewportWidth\`/\`viewportHeight\` to change it,
and \`transparentBackground: true\` for a transparent (non-white) background.

## Iterating — preview first, render last
**Design in the preview loop, not the render loop.** Call
\`create_preview_link\` with your HTML (and optional \`variables\`/viewport): it
returns a \`/preview\` URL that renders the draft live in a browser at full
resolution, through the same engine as the final PNG. It is free, unlimited, and
stores nothing — the draft travels in the URL hash. Open and screenshot it to
check your own work, or hand the link to a human for review. Iterate here until
the design is right.

Only then commit: \`generate_image_from_html\` for a one-off PNG, or
\`create_template\` to persist it for repeated renders (\`update_template\` replaces a
saved template's HTML under the same ID). Each generated image costs
1 credit and returns a public \`url\`. \`inspect: true\` on a generate call adds a
512px-wide thumbnail — useful to confirm the render succeeded, too small to judge
layout or typography. Do not use it as your design loop; that is what
\`create_preview_link\` is for.`;

/** Most of the guide describes API-backed tools. In preview-only mode they are
 * not registered, so say that up front rather than let the agent plan a call it
 * cannot make. */
const KEYLESS_NOTE = `> **This server is running without an API key.** Only
> \`create_preview_link\` is available: previews are free, unlimited and need no
> account. \`generate_image_from_html\`, \`generate_image_from_template\`,
> \`create_template\`, \`update_template\`, \`list_templates\` and \`get_template\` are described below
> but NOT registered — they need an API key from https://ojo.so/dashboard/api,
> set as \`OJO_API_KEY\`.

`;

/** Register the v1 guiding prompt that teaches oJo template semantics. */
export function registerPrompts(server: McpServer, hasApiKey: boolean): void {
  server.registerPrompt(
    'author_ojo_template',
    {
      title: 'Author an oJo template',
      description:
        'Guidance for writing oJo templates: the Handlebars helper catalog, Template Variables vs Modify Payload, viewport conventions, and the inspect→iterate loop.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: hasApiKey ? GUIDE : KEYLESS_NOTE + GUIDE,
          },
        },
      ],
    })
  );
}
