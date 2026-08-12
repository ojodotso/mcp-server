import {
  HEADER_SOURCE,
  HEADER_TRANSPARENT_BACKGROUND,
  HEADER_VIEWPORT_HEIGHT,
  HEADER_VIEWPORT_WIDTH,
  OJO_API_BASE_URL,
} from '../constants.js';

export interface ViewportOptions {
  viewportWidth?: number;
  viewportHeight?: number;
  transparentBackground?: boolean;
}

export interface GeneratedImage {
  id: string;
  imageUrl: string;
  createdAt?: string;
}

export interface ListTemplatesParams {
  page?: number;
  pageSize?: number;
  sort?: 'asc' | 'desc';
}

export interface TemplateSummary {
  template_id: string;
  name: string;
  preview_url?: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateList {
  items: TemplateSummary[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export interface TemplateDetail {
  id: string;
  name: string;
  /** Decoded (plain) HTML — the API returns it base64-encoded; decoded here. */
  html: string;
  variables: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedTemplate {
  id: string;
  message?: string;
}

/** Error from the oJo API carrying the HTTP status and an agent-readable message. */
export class OjoApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'OjoApiError';
  }
}

/**
 * Thin HTTP client over the public oJo API (`/v1`). Authenticates with the
 * user's oJo API key via `Authorization: Bearer <key>`. Never imports internal
 * workspace packages — the boundary is HTTP only.
 */
export class OjoApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = OJO_API_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * POST /image/html — render raw HTML. The server requires the Content-Type to
   * be exactly `text/html` (a strict `!==` check), so it must not carry a charset.
   */
  async createImageFromHtml(
    html: string,
    options: ViewportOptions = {}
  ): Promise<GeneratedImage> {
    const headers: Record<string, string> = { 'Content-Type': 'text/html' };
    if (options.viewportWidth !== undefined) {
      headers[HEADER_VIEWPORT_WIDTH] = String(options.viewportWidth);
    }
    if (options.viewportHeight !== undefined) {
      headers[HEADER_VIEWPORT_HEIGHT] = String(options.viewportHeight);
    }
    if (options.transparentBackground) {
      headers[HEADER_TRANSPARENT_BACKGROUND] = 'true';
    }
    const result = await this.request<GeneratedImage>('/image/html', {
      method: 'POST',
      headers,
      body: html,
    });
    return { ...result, imageUrl: toAbsoluteUrl(result.imageUrl) };
  }

  /** POST /image/template — render an existing template, optionally overriding its variables. */
  async createImageFromTemplate(
    templateId: string,
    modify: Record<string, unknown> = {},
    options: ViewportOptions = {}
  ): Promise<GeneratedImage> {
    const body: Record<string, unknown> = { templateId, modify };
    if (options.viewportWidth !== undefined) {
      body.viewportWidth = options.viewportWidth;
    }
    if (options.viewportHeight !== undefined) {
      body.viewportHeight = options.viewportHeight;
    }
    if (options.transparentBackground !== undefined) {
      body.transparentBackground = options.transparentBackground;
    }
    const result = await this.request<GeneratedImage>('/image/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ...result, imageUrl: toAbsoluteUrl(result.imageUrl) };
  }

  /** GET /template — list the templates available to this account. */
  async listTemplates(params: ListTemplatesParams = {}): Promise<TemplateList> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.pageSize !== undefined) {
      query.set('pageSize', String(params.pageSize));
    }
    if (params.sort !== undefined) query.set('sort', params.sort);
    const qs = query.toString();
    return this.request<TemplateList>(`/template${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  }

  /** GET /template/:id — fetch one template; the API returns base64 html, decoded here. */
  async getTemplate(templateId: string): Promise<TemplateDetail> {
    const record = await this.request<TemplateDetail>(
      `/template/${encodeURIComponent(templateId)}`,
      { method: 'GET' }
    );
    return {
      ...record,
      html: Buffer.from(record.html, 'base64').toString('utf-8'),
    };
  }

  /** POST /template — create a template from plain HTML; the html is base64-encoded here. */
  async createTemplate(
    html: string,
    variables?: Record<string, unknown>
  ): Promise<CreatedTemplate> {
    const body: Record<string, unknown> = {
      html: Buffer.from(html, 'utf-8').toString('base64'),
    };
    if (variables !== undefined) {
      body.variables = variables;
    }
    return this.request<CreatedTemplate>('/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string }
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.apiKey}`,
          [HEADER_SOURCE]: 'mcp',
        },
        body: init.body,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new OjoApiError(
        0,
        `Could not reach the oJo API at ${this.baseUrl}: ${detail}`
      );
    }

    if (!response.ok) {
      throw await this.toError(response);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  private async toError(response: Response): Promise<OjoApiError> {
    const body = (await response.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    const serverMessage = body?.message ?? body?.error ?? response.statusText;
    return new OjoApiError(
      response.status,
      this.describe(response.status, serverMessage)
    );
  }

  private describe(status: number, serverMessage: string): string {
    switch (status) {
      case 401:
        return 'Unauthorized — set OJO_API_KEY to a valid oJo API key (create one at https://ojo.so/dashboard/api).';
      case 402:
        return 'Out of credits — this oJo account has no remaining image credits.';
      case 422:
        return `The oJo API rejected the request: ${serverMessage}`;
      case 429:
        return 'Rate limited by the oJo API — slow down and retry shortly.';
      default:
        return `oJo API error ${status}: ${serverMessage}`;
    }
  }
}

/** The API may return a scheme-less hotlink (e.g. `ojousercontent.com/...`); make it absolute https. */
export function toAbsoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
