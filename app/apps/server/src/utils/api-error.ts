export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(error);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}