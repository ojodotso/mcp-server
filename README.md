# @ojodotso/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an
AI agent turn HTML into images. Live previews are free and need no account; an
oJo API key adds hosted PNG URLs and reusable templates through the user's own
account. Transport is local **stdio**; the API boundary is HTTP to
`https://api.ojo.so/v1` only.

## Quick start — no account needed

Point your MCP client at the package. With no API key the server starts in
**preview-only mode**: `create_preview_link` renders HTML into a live,
full-resolution image preview, free and unlimited, with no oJo account.

```json
{
  "mcpServers": {
    "ojo": {
      "command": "npx",
      "args": ["-y", "@ojodotso/mcp-server"]
    }
  }
}
```

```bash
claude mcp add ojo -- npx -y @ojodotso/mcp-server
```

### Adding a key

A key unlocks the permanent PNG URL — the thing you can put in an email, a
social card or an API response — plus reusable templates. Create one at
<https://ojo.so/dashboard/api> and pass it as `OJO_API_KEY`:

```json
{
  "mcpServers": {
    "ojo": {
      "command": "npx",
      "args": ["-y", "@ojodotso/mcp-server"],
      "env": { "OJO_API_KEY": "sk_..." }
    }
  }
}
```

```bash
claude mcp add ojo -e OJO_API_KEY=sk_... -- npx -y @ojodotso/mcp-server
```

Works the same for Claude Desktop, Cursor, and Claude Code.

## Tools

Only `create_preview_link` is registered without an API key; the rest talk to
the oJo API, so advertising them keyless would offer tools that can only fail.

| Tool | Purpose | Credit | Needs a key |
|------|---------|--------|-------------|
| `create_preview_link` | Build a free, full-resolution `/preview` link for an HTML/Handlebars draft. | — | no |
| `generate_image_from_html` | Render plain HTML (with inline CSS) to a PNG; returns its public URL. | 1 | yes |
| `generate_image_from_template` | Render an existing template, optionally overriding variables via `modify`. | 1 | yes |
| `list_templates` | List the templates available to the account. | — | yes |
| `get_template` | Fetch one template's decoded HTML and variable defaults. | — | yes |
| `create_template` | Create a reusable template from plain HTML/Handlebars. | — | yes |

### The design loop

Iterate with `create_preview_link`, then render. It returns an
`https://ojo.so/preview#draft=…` URL that renders the draft live in the browser
through the **same engine as the final PNG**, at full resolution. The draft is
gzipped into the URL *hash*, so it never reaches a server and nothing is stored
— the link is self-contained and shareable with a human reviewer.

Both generate tools also accept `inspect: true`, which returns a 512px-wide
downscaled thumbnail alongside the URL. That is a confirmation that the render
succeeded, not a design surface — it is too small to judge layout or typography.

## Guiding prompt

`author_ojo_template` — teaches the Handlebars helper catalog, the **Template
Variables** (schema/defaults) vs **Modify Payload** (per-render data) model,
viewport conventions, and the preview-first design loop.

## Configuration

- `OJO_API_KEY` (optional) — your oJo API key. Without it the server runs in
  preview-only mode; with it the full tool surface is registered.
- `OJO_API_BASE_URL` (optional) — defaults to `https://api.ojo.so/v1`.
- `OJO_WEB_BASE_URL` (optional) — the web app that serves `/preview` for
  `create_preview_link`. Defaults to `https://ojo.so`; point it at a local
  `http://localhost:3000` when developing against a self-hosted web app.

## Source

This package is developed in oJo's private monorepo and mirrored to
[github.com/ojodotso/mcp-server](https://github.com/ojodotso/mcp-server) on every
release, so the code that runs on your machine can be read before you run it. The
mirror carries one snapshot commit per version rather than the monorepo's history.

## Develop (from the monorepo)

```bash
pnpm --filter @ojodotso/mcp-server build
pnpm --filter @ojodotso/mcp-server test
pnpm --filter @ojodotso/mcp-server check
```

### Release

This package is published by hand — the monorepo's semantic-release cuts GitHub
releases only. From `apps/mcp-server`:

```bash
pnpm release:dry              # run every pre-flight check, publish nothing
pnpm release --otp=123456     # publish (the npm account has publish-2FA)
```

Bump `version` in `package.json` **and** the handshake version in
`src/server/index.ts` together — a test pins them to each other. The pre-flight
refuses to reuse a published version (npm metadata is immutable), verifies the
shipping files match `origin/master`, and inspects the built artifact's actual
tool surface rather than trusting the source.
