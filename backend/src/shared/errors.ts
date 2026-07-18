/** Typed application errors carrying an HTTP status. Thrown anywhere, handled centrally. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const BadRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError(400, msg, 'BAD_REQUEST', details);
export const Unauthorized = (msg = 'Unauthorized') => new AppError(401, msg, 'UNAUTHORIZED');
export const Forbidden = (msg = 'Forbidden') => new AppError(403, msg, 'FORBIDDEN');
export const NotFound = (msg = 'Not found') => new AppError(404, msg, 'NOT_FOUND');
export const Conflict = (msg = 'Conflict') => new AppError(409, msg, 'CONFLICT');
export const Locked = (msg = 'Account locked') => new AppError(423, msg, 'LOCKED');
