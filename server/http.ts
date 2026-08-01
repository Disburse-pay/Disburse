export type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  send?: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function assertMethod(request: ApiRequest, method: string) {
  if (request.method !== method) {
    throw new HttpError(405, "Method not allowed.");
  }
}

export function readQueryString(request: ApiRequest, key: string): string | undefined {
  const value = request.query?.[key];
  if (Array.isArray(value)) {
    throw new HttpError(400, `Query parameter "${key}" must be provided exactly once.`);
  }
  return value;
}

/**
 * Read a single HTTP header value without silently accepting ambiguous repeated
 * headers. Header names are case-insensitive, while framework adapters differ
 * on whether they preserve the caller's casing.
 */
export function readHeaderString(request: ApiRequest, key: string): string | undefined {
  const headers = request.headers;
  if (!headers) {
    return undefined;
  }

  const expected = key.toLowerCase();
  const entries = Object.entries(headers).filter(([name]) => name.toLowerCase() === expected);
  if (entries.length === 0) {
    return undefined;
  }

  const value = entries[0][1];
  if (entries.length !== 1 || Array.isArray(value)) {
    throw new HttpError(400, `Header "${key}" must be provided exactly once.`);
  }
  return value;
}

export function readJsonBody(request: ApiRequest): Record<string, unknown> {
  const body = request.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      throw new HttpError(400, "Request body must be valid JSON.");
    }
  }
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

export function sendJson(response: ApiResponse, statusCode: number, body: unknown) {
  response.setHeader?.("cache-control", "no-store");
  response.status(statusCode).json(body);
}

export function sendError(response: ApiResponse, error: unknown) {
  if (error instanceof HttpError) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }

  // Unexpected exceptions often contain SQL, RPC, hostnames, or configuration
  // details. Keep controlled HttpError messages above, but never reflect an
  // arbitrary internal exception to the caller.
  console.error(
    "[api] Unexpected server error.",
    error instanceof Error ? { name: error.name } : { type: typeof error }
  );
  sendJson(response, 500, { error: "Unexpected server error." });
}
