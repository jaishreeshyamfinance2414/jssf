import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors';
import { logger } from '../config/logger';
import { isProd } from '../config/env';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: err.flatten() },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code ?? 'ERROR', message: err.message, details: err.details },
    });
  }

  // Postgres unique-violation → 409
  if (typeof err === 'object' && err && (err as { code?: string }).code === '23505') {
    return res
      .status(409)
      .json({ success: false, error: { code: 'CONFLICT', message: 'Duplicate value' } });
  }

  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: isProd ? 'Internal server error' : String(err) },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
