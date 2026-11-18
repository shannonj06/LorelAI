import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(API_ROOT, '..');

/** Load api/.env into process.env. Variables already set in the environment win. */
export function loadEnvFile(file = path.join(API_ROOT, '.env')) {
  if (existsSync(file)) process.loadEnvFile(file);
}

function int(env, name, fallback, { min = 0 } = {}) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${value}"`);
  }
  return number;
}

function bool(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function list(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function resolvePath(value, fallback) {
  if (!value) return fallback;
  return value === ':memory:' ? value : path.resolve(API_ROOT, value);
}

function trustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** Read settings from environment variables. See .env.example for what each one does. */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  let jwtSecret = env.JWT_SECRET;
  let jwtSecretIsEphemeral = false;
  if (!jwtSecret) {
    if (isProduction) throw new Error('JWT_SECRET must be set in production');
    jwtSecret = crypto.randomBytes(48).toString('base64url');
    jwtSecretIsEphemeral = true;
  } else if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  const dataDir = path.join(API_ROOT, 'data');
  return {
    nodeEnv,
    isProduction,
    host: env.HOST || '127.0.0.1',
    port: int(env, 'PORT', 4000),
    trustProxy: trustProxy(env.TRUST_PROXY),
    logLevel: env.LOG_LEVEL || 'info',
    databasePath: resolvePath(env.DATABASE_PATH, path.join(dataDir, 'lorelai.db')),
    corsOrigins: list(env, 'CORS_ORIGINS', ['http://localhost:5173']),
    // Secure cookies need HTTPS; browsers also accept them on http://localhost
    cookieSecure: bool(env, 'COOKIE_SECURE', isProduction),
    // The built React app (npm run build in lorel-ai-frontend). Served at / when present.
    frontendDist: resolvePath(env.FRONTEND_DIST, path.join(REPO_ROOT, 'lorel-ai-frontend', 'dist')),
    // Extra origins the browser may connect to (the waitlist form talks to Supabase)
    cspConnectSrc: list(env, 'CSP_CONNECT_SRC', ['https://*.supabase.co']),
    trial: {
      questionLimit: int(env, 'TRIAL_QUESTION_LIMIT', 3),
      // Across all trial sessions from one IP, so clearing cookies doesn't reset the trial
      ipDailyLimit: int(env, 'TRIAL_IP_DAILY_LIMIT', 12),
    },
    uploads: {
      dir: resolvePath(env.UPLOADS_DIR, path.join(dataDir, 'uploads')),
      maxBytes: int(env, 'UPLOAD_MAX_MB', 25, { min: 1 }) * 1024 * 1024,
      maxPerUser: int(env, 'UPLOAD_MAX_PER_USER', 5, { min: 1 }),
      ingestTimeoutMs: int(env, 'UPLOAD_INGEST_TIMEOUT_MS', 15 * 60 * 1000, { min: 10_000 }),
    },
    chats: {
      maxSavedPerUser: int(env, 'MAX_SAVED_CHATS', 50, { min: 1 }),
    },
    auth: {
      jwtSecret,
      jwtSecretIsEphemeral,
      accessTokenTtlSeconds: int(env, 'ACCESS_TOKEN_TTL_SECONDS', 900, { min: 30 }),
      refreshTokenTtlDays: int(env, 'REFRESH_TOKEN_TTL_DAYS', 30, { min: 1 }),
      scryptCost: int(env, 'SCRYPT_COST', 16, { min: 10 }),
    },
    rateLimits: {
      // 0 disables a limiter
      authPer15Minutes: int(env, 'AUTH_RATE_LIMIT', 20),
      askPerHour: int(env, 'ASK_RATE_LIMIT_PER_HOUR', 60),
      // Requests per IP per hour to the anonymous trial (on top of the 3-question limit)
      trialPerHour: int(env, 'TRIAL_RATE_LIMIT_PER_HOUR', 20),
      uploadsPerHour: int(env, 'UPLOAD_RATE_LIMIT_PER_HOUR', 10),
    },
    rag: {
      enabled: bool(env, 'RAG_ENABLED', true),
      python: env.RAG_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      script: resolvePath(env.RAG_WORKER_SCRIPT, path.join(REPO_ROOT, 'backend', 'rag_worker.py')),
      concurrency: int(env, 'RAG_CONCURRENCY', 4, { min: 1 }),
      requestTimeoutMs: int(env, 'RAG_TIMEOUT_MS', 120_000, { min: 1000 }),
      readyWaitMs: int(env, 'RAG_READY_WAIT_MS', 30_000),
      topK: int(env, 'RAG_TOP_K', 5, { min: 1 }),
      perBook: int(env, 'RAG_PER_BOOK', 2, { min: 1 }),
      hfOffline: bool(env, 'RAG_HF_OFFLINE', false),
    },
    admin: {
      email: env.ADMIN_EMAIL || null,
      password: env.ADMIN_PASSWORD || null,
    },
  };
}
