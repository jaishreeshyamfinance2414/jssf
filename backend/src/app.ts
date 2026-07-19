import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env, isProd } from './config/env';
import { logger } from './config/logger';
import api from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1); // correct req.ip behind a reverse proxy

  // ── Security headers ──
  app.use(helmet());

  // ── CORS (credentials on, so refresh cookie flows) ──
  // In development reflect whatever origin the request came from (localhost,
  // LAN IP, ...); in production only the configured whitelist is allowed.
  const corsWhitelist = env.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: isProd ? corsWhitelist : true,
      credentials: true,
    }),
  );

  // ── Body & cookie parsing ──
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ── Request logging ──
  app.use(pinoHttp({ logger }));

  // ── Global rate limit (per-endpoint limits layer on top) ──
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Health check ──
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
  // Uploaded documents are PII — served only via the authenticated /files route
  // (see modules/files/files.routes.ts), never via unauthenticated express.static.

  // ── API ──
  app.use(env.API_PREFIX, api);

  // ── 404 + error handling (must be last) ──
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
