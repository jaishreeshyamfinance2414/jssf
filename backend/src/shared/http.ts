import { NextFunction, Request, Response } from 'express';

/** Wrap async route handlers so rejected promises reach the error middleware. */
export const asyncHandler =
  <T = unknown>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/** Uniform success envelope. */
export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });

export const created = (res: Response, data: unknown) => ok(res, data, 201);
