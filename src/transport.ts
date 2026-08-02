import { ArgorixError } from "./errors.js";

export const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/** A single Server-Sent Event emitted by an Argorix streaming endpoint. */
export type StreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type TransportOptions = {
  baseUrl: string;
  appApiKey: string;
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryStatusCodes?: number[];
};

/** Strip trailing slashes and a trailing `/v1` so callers can pass either form. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -"/v1".length) : trimmed;
}

export class HttpTransport {
  readonly baseUrl: string;
  readonly appApiKey: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  readonly retryStatusCodes: Set<number>;
  private readonly userAgent: string;

  constructor(options: TransportOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!this.baseUrl) {
      throw new ArgorixError("baseUrl is required.");
    }
    this.appApiKey = (options.appApiKey ?? "").trim();
    if (!this.appApiKey) {
      throw new ArgorixError("appApiKey is required.");
    }
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.retryBackoffMs = Math.max(0, options.retryBackoffMs ?? 500);
    this.retryStatusCodes = new Set(options.retryStatusCodes ?? DEFAULT_RETRY_STATUS_CODES);
  }

  private headers(accept: string, withBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      Authorization: `Bearer ${this.appApiKey}`,
      "User-Agent": this.userAgent,
    };
    if (withBody) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private shouldRetry(statusCode?: number): boolean {
    return statusCode !== undefined && this.retryStatusCodes.has(statusCode);
  }

  private async sleepBeforeRetry(attempt: number): Promise<void> {
    if (this.retryBackoffMs <= 0) {
      return;
    }
    const delayMs = this.retryBackoffMs * 2 ** Math.max(0, attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async send(
    method: string,
    path: string,
    payload: Record<string, unknown> | undefined,
    accept: string,
    signal: AbortSignal,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(accept, payload !== undefined),
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal,
    });
  }

  async requestJson(
    method: string,
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${path}`;
    let lastError: ArgorixError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.send(method, path, payload, "application/json", controller.signal);
        const rawText = await response.text();
        const body = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
        if (!response.ok) {
          const detail =
            typeof body.detail === "string" && body.detail
              ? body.detail
              : `HTTP ${response.status} calling ${url}`;
          const error = new ArgorixError(detail, {
            statusCode: response.status,
            responseBody: rawText,
          });
          if (attempt < this.maxRetries && this.shouldRetry(response.status)) {
            lastError = error;
            await this.sleepBeforeRetry(attempt + 1);
            continue;
          }
          throw error;
        }
        return body;
      } catch (error) {
        if (error instanceof ArgorixError && !this.shouldRetry(error.statusCode)) {
          throw error;
        }
        const argorixError =
          error instanceof ArgorixError
            ? error
            : new ArgorixError(`Unable to call ${url}: ${String(error)}`);
        if (attempt < this.maxRetries) {
          lastError = argorixError;
          await this.sleepBeforeRetry(attempt + 1);
          continue;
        }
        throw argorixError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new ArgorixError(`Unexpected request failure calling ${url}`);
  }

  /**
   * POST `payload` and yield decoded SSE events until the stream closes.
   *
   * Retries only cover connection setup and the response status; once the event
   * stream starts it is not replayed.
   */
  async *streamSse(
    path: string,
    payload: Record<string, unknown>,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const url = `${this.baseUrl}${path}`;
    let lastError: ArgorixError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.send("POST", path, payload, "text/event-stream", controller.signal);
        if (!response.ok) {
          const rawText = await response.text();
          const error = new ArgorixError(`HTTP ${response.status} calling ${url}`, {
            statusCode: response.status,
            responseBody: rawText,
          });
          if (attempt < this.maxRetries && this.shouldRetry(response.status)) {
            lastError = error;
            clearTimeout(timeout);
            await this.sleepBeforeRetry(attempt + 1);
            continue;
          }
          throw error;
        }
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof ArgorixError && !this.shouldRetry(error.statusCode)) {
          throw error;
        }
        const argorixError =
          error instanceof ArgorixError
            ? error
            : new ArgorixError(`Unable to call ${url}: ${String(error)}`);
        if (attempt < this.maxRetries) {
          lastError = argorixError;
          await this.sleepBeforeRetry(attempt + 1);
          continue;
        }
        throw argorixError;
      }

      if (!response.body) {
        clearTimeout(timeout);
        throw new ArgorixError(`Response to ${url} did not include a readable stream.`);
      }

      try {
        // The stream stays open past timeoutMs on purpose: the timeout guards the
        // handshake, not the lifetime of the event stream.
        clearTimeout(timeout);
        yield* parseSseStream(response.body);
      } finally {
        controller.abort();
      }
      return;
    }
    throw lastError ?? new ArgorixError(`Unexpected request failure calling ${url}`);
  }
}

async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = findSeparator(buffer);
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        const consumed = separatorIndex + separatorLength(buffer, separatorIndex);
        buffer = buffer.slice(consumed);
        const parsed = parseSseBlock(block);
        if (parsed) {
          yield parsed;
        }
        separatorIndex = findSeparator(buffer);
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseBlock(buffer);
    if (parsed) {
      yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function findSeparator(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function separatorLength(buffer: string, index: number): number {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2;
}

function parseSseBlock(block: string): StreamEvent | null {
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event: eventName, data: decodeSseData(dataLines.join("\n")) };
}

function decodeSseData(raw: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(raw) as unknown;
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : { raw: decoded };
  } catch {
    return { raw };
  }
}
