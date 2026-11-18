import { existsSync } from 'node:fs';
import path from 'node:path';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { notFound } from './errors.js';
import { createRequireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { adminRouter } from './routes/admin.js';
import { askRouter } from './routes/ask.js';
import { authRouter } from './routes/auth.js';
import { booksRouter } from './routes/books.js';
import { chatsRouter } from './routes/chats.js';
import { healthRouter } from './routes/health.js';
import { trialRouter } from './routes/trial.js';
import { uploadsRouter } from './routes/uploads.js';
import { AuthService } from './services/auth.js';
import { createPasswordHasher } from './services/passwords.js';
import { createTokenService } from './services/tokens.js';
import { purgeUploadsForUser } from './services/uploads.js';

/**
 * Build the Express app. Dependencies are passed in so tests can use an
 * in-memory database and a fake pipeline.
 *
 *   config  from loadConfig()
 *   db      from openDatabase(), already migrated
 *   rag     a RagWorker (or anything with ask/books/ingest/deleteBook/status/restart)
 *   logger  from createLogger()
 *
 * When the React app has been built (lorel-ai-frontend/dist), it is served from
 * the same origin, so the browser needs no CORS and cookies stay first-party.
 */
export function createApp({ config, db, rag, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestLogger(logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // React sets some inline style attributes; Google Fonts serves the two typefaces
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...config.cspConnectSrc],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-LorelAI-Client'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  // Saving a chat sends its answers back, so that one route takes larger bodies
  app.use('/api/chats', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '32kb' }));

  const passwords = createPasswordHasher({ cost: config.auth.scryptCost });
  const tokens = createTokenService(config.auth);
  const auth = new AuthService({ db, passwords, tokens, logger });
  const requireAuth = createRequireAuth({ db, tokens });
  const limiters = createRateLimiters(config.rateLimits);
  const deps = { db, rag, config, logger, requireAuth, limiters };
  const beforeAccountDeleted = (userId) => purgeUploadsForUser({ db, rag, logger }, userId);

  app.use('/api/health', healthRouter({ db, rag }));
  app.use('/api/auth', authRouter({ auth, db, config, requireAuth, limiters, beforeAccountDeleted }));
  app.use('/api/ask', askRouter(deps));
  app.use('/api/trial', trialRouter(deps));
  app.use('/api/books', booksRouter({ rag }));
  app.use('/api/chats', chatsRouter(deps));
  app.use('/api/uploads', uploadsRouter(deps));
  app.use('/api/admin', adminRouter(deps));
  app.use('/api', (req, res, next) => next(notFound(`No route for ${req.method} ${req.originalUrl}`)));

  const indexHtml = config.frontendDist && path.join(config.frontendDist, 'index.html');
  if (indexHtml && existsSync(indexHtml)) {
    app.use(
      express.static(config.frontendDist, {
        index: false,
        // Vite puts content-hashed files in /assets, so they can be cached for good
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // Client-side routes (/try, /app, /admin...) all load the single-page app
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (req, res) => {
      res.json({
        name: 'LorelAI API',
        health: '/api/health',
        note: 'Build the frontend (cd lorel-ai-frontend && npm run build) to serve the site from here.',
      });
    });
  }

  app.use((req, res, next) => next(notFound(`No route for ${req.method} ${req.path}`)));
  app.use(errorHandler(logger));

  return app;
}
