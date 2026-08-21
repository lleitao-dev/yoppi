import type { ServerError } from '@yoppi/protocol';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let error: Partial<ServerError> = {};
    try {
      error = (await response.json()) as Partial<ServerError>;
    } catch {
      // The fallback below handles responses without JSON bodies.
    }
    throw new ApiError(
      response.status,
      error.code ?? 'HTTP_ERROR',
      error.message ?? 'Request failed.',
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
