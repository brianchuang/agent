import { z } from "zod";

const errorResponseSchema = z
  .object({
    error: z.string().optional()
  })
  .passthrough();

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function apiRequest<T>(url: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const raw = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(raw);
    throw new ApiError(
      parsedError.success ? parsedError.data.error ?? "Request failed" : "Request failed",
      response.status,
      raw
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("Invalid API response", response.status, parsed.error.flatten());
  }

  return parsed.data;
}

export function apiGet<T>(url: string, schema: z.ZodType<T>, options?: Omit<RequestOptions, "method">) {
  return apiRequest(url, schema, { ...options, method: "GET" });
}

export function apiPost<T>(url: string, body: unknown, schema: z.ZodType<T>, options?: Omit<RequestOptions, "method" | "body">) {
  return apiRequest(url, schema, { ...options, method: "POST", body });
}

export function apiPut<T>(url: string, body: unknown, schema: z.ZodType<T>, options?: Omit<RequestOptions, "method" | "body">) {
  return apiRequest(url, schema, { ...options, method: "PUT", body });
}
