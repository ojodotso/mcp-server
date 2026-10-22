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
  /** Template renders only: fail instead of answering warnings. */
  strict?: boolean;
}

export interface GeneratedImage {
  id: string;
  imageUrl: string;
  createdAt?: string;
  /** Keys the template does not read, and inputs left out. */
  warnings?: string[];
}

export interface GeneratedPdf {
  id: string;
  pdfUrl: string;
  pages: number;
  credits: number;
  /** Pages printed by each entry, present only when the request sent `pages`. */
  entries?: Array<{ index: number; pages: number }>;
  createdAt?: string;
  warnings?: string[];
}

export interface PdfPageEntry {
  templateId?: string;
  html?: string;
  modify?: Record<string, unknown>;
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
  /** The HTML as stored. */
  html: string;
  variables: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedTemplate {
  id: string;
  message?: string;
}

/** A template body: the html as plain HTML, variables only when given. */
const templateBody = (html: string, variables?: Record<string, unknown>) =>
  JSON.stringify({ html, ...(variables !== undefined && { variables }) });

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
    if (options.strict !== undefined) body.strict = options.strict;
    const result = await this.request<GeneratedImage>('/image/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ...result, imageUrl: toAbsoluteUrl(result.imageUrl) };
  }

  /** POST /pdf/html — render raw HTML into a PDF. Same exact `text/html` rule as /image/html. */
  async createPdfFromHtml(html: string): Promise<GeneratedPdf> {
    const result = await this.request<GeneratedPdf>('/pdf/html', {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: html,
    });
    return { ...result, pdfUrl: toAbsoluteUrl(result.pdfUrl) };
  }

  /**
   * POST /pdf/template — render a template, or one document per `pages` entry merged in order,
   * into a PDF. The API validates which fields an entry needs, so the body is sent unchanged.
   */
  async createPdfFromTemplate({
    templateId,
    modify,
    pages,
    strict,
  }: {
    templateId?: string;
    modify?: Record<string, unknown>;
    pages?: PdfPageEntry[];
    strict?: boolean;
  }): Promise<GeneratedPdf> {
    const result = await this.request<GeneratedPdf>('/pdf/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, modify, pages, strict }),
    });
    return { ...result, pdfUrl: toAbsoluteUrl(result.pdfUrl) };
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

  /** GET /template/:id — fetch one template, its HTML plain. */
  async getTemplate(templateId: string): Promise<TemplateDetail> {
    return this.request<TemplateDetail>(
      `/template/${encodeURIComponent(templateId)}`,
      { method: 'GET' }
    );
  }

  /** POST /template — create a template from plain HTML. */
  async createTemplate(
    html: string,
    variables?: Record<string, unknown>
  ): Promise<CreatedTemplate> {
    return this.request<CreatedTemplate>('/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: templateBody(html, variables),
    });
  }

  /** PUT /template/:id — replace a template's HTML; without variables the stored defaults stay. */
  async updateTemplate(
    templateId: string,
    html: string,
    variables?: Record<string, unknown>
  ): Promise<CreatedTemplate> {
    return this.request<CreatedTemplate>(`/template/${encodeURIComponent(templateId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: templateBody(html, variables),
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
      | { message?: string; error?: string; logs?: unknown; retryAfter?: unknown }
      | null;
    const serverMessage = body?.message ?? body?.error ?? response.statusText;
    // A 422 carries its reasons in `logs`, such as which `pages` entry is wrong.
    const logs = Array.isArray(body?.logs)
      ? body.logs.filter((log): log is string => typeof log === 'string')
      : [];
    const detail = logs.length ? `${serverMessage}: ${logs.join('; ')}` : serverMessage;
    // A 429 or 503 says how long to wait in Retry-After and the body's retryAfter, in seconds (AC227,
    // AC238).
    const wait = [response.headers.get('retry-after'), body?.retryAfter]
      .map(Number)
      .find((seconds) => Number.isInteger(seconds) && seconds > 0);
    return new OjoApiError(response.status, this.describe(response.status, detail, wait));
  }

  private describe(status: number, serverMessage: string, waitSeconds?: number): string {
    const waitFor = (seconds: number) =>
      seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
    switch (status) {
      case 401:
        return 'Unauthorized — set OJO_API_KEY to a valid oJo API key (create one at https://ojo.so/dashboard/api).';
      case 402:
        return 'Out of credits — this oJo account does not have enough credits for this render.';
      case 422:
        return `The oJo API rejected the request: ${serverMessage}`;
      case 429:
        return waitSeconds === undefined
          ? `Rate limited by the oJo API: ${serverMessage}. Slow down and retry shortly.`
          : `Rate limited by the oJo API: ${serverMessage.replace(/\.$/, '')}. Wait ${waitFor(
              waitSeconds
            )} before retrying.`;
      case 503:
        if (waitSeconds === undefined) break;
        return `The oJo API is busy: ${serverMessage.replace(/\.$/, '')}. Wait ${waitFor(
          waitSeconds
        )} before retrying.`;
    }
    return `oJo API error ${status}: ${serverMessage}`;
  }
}

/** The API may return a scheme-less hotlink (e.g. `ojousercontent.com/...`); make it absolute https. */
export function toAbsoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
