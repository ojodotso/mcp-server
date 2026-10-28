export const OJO_API_BASE_URL = 'https://api.ojo.so/v1';

// Base URL of the oJo web app that serves the `/preview` route (used to build
// no-credit draft-handoff links). Override with OJO_WEB_BASE_URL.
export const OJO_WEB_BASE_URL = 'https://ojo.so';

// Inlined from packages/libs (request-headers) so the published package carries
// no workspace dependencies. Keep in sync with
// packages/libs/src/constants/request-headers.ts.
export const HEADER_VIEWPORT_WIDTH = 'x-viewport-width';
export const HEADER_VIEWPORT_HEIGHT = 'x-viewport-height';
export const HEADER_TRANSPARENT_BACKGROUND = 'x-transparent-background';
export const HEADER_SOURCE = 'x-ojo-source';

// Keep in sync with package.json. Sent in the MCP handshake and, as x-ojo-client-version, with
// every API request so the server can tell old copies apart in its logs (AC1440).
export const VERSION = '0.9.0';
export const HEADER_CLIENT_VERSION = 'x-ojo-client-version';
