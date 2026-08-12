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
