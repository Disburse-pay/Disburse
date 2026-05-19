export type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
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
  return Array.isArray(value) ? value[0] : value;
}

export function readJsonBody(request: ApiRequest): Record<string, unknown> {
  const body = request.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
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

  const message = error instanceof Error && error.message.trim() ? error.message : "Unexpected server error.";
  sendJson(response, 500, { error: message });
}
