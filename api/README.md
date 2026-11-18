# LorelAI API

The Express server behind LorelAI. It handles accounts, the landing page's free trial,
`POST /api/ask`, saved chats, uploaded books and the admin area. It stores everything in
SQLite and serves the built website from the same origin.

```
browser ──HTTP──▶ Express (this folder) ──stdin/stdout JSON──▶ backend/rag_worker.py ──▶ model (OpenRouter / Anthropic)
                     │                                             │
                  SQLite                               Chroma vector stores + bge-small embeddings
```

The server starts the Python worker itself and keeps it running, so the embedding model
loads once (about 15 s) rather than on every question.

- Setup for the whole project: [../README.md](../README.md).
- Design decisions: [../DESIGN_PROCESS.md](../DESIGN_PROCESS.md).

## Run

```bash
npm install
cp .env.example .env          # set OPENROUTER_API_KEY (and JWT_SECRET for anything beyond local dev)
npm start                     # http://127.0.0.1:4000 (serves the site too, once lorel-ai-frontend is built)
npm test                      # 96 tests: in-memory DB, fake pipeline, fake worker process
npm run smoke                 # against the running server; makes one real model call
npm run create-admin -- --email you@example.com --password "a long password"
```

All settings are documented in [.env.example](.env.example).

## Endpoints

All bodies are JSON unless noted. "user" means `Authorization: Bearer <accessToken>` is required.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | – | Database and pipeline state, and which model answers |
| `GET /api/books` | – | The shared library |
| `GET /api/trial` | – | `{limit, used, remaining}` for this visitor |
| `POST /api/trial/ask` | – | `{question, history?}` → an answer from the shared library, plus `trial` |
| `POST /api/auth/signup` | – | `{email, password, displayName?}` → 201 session |
| `POST /api/auth/signin` | – | `{email, password}` → session |
| `POST /api/auth/refresh` | – | `{refreshToken}`, or the cookie in browser mode → new session |
| `POST /api/auth/signout` | – | Revoke the refresh token → 204 |
| `POST /api/auth/signout-all` | user | End every session for this account → 204 |
| `GET` / `PATCH /api/auth/me` | user | Current user / change display name |
| `POST /api/auth/change-password` | user | `{currentPassword, newPassword}` → new session; other devices signed out |
| `DELETE /api/auth/me` | user | `{password}` → 204; deletes the account, its chats and its uploaded books |
| `POST /api/ask` | user | `{question, books?, perBook?, chatId?, history?}` → answer with citations |
| `GET` / `POST /api/chats` | user | List saved chats / save a conversation `{title?, messages[]}` |
| `GET` / `PATCH` / `DELETE /api/chats/:id` | user | Open / rename / unsave a chat |
| `GET /api/uploads` | user | Your uploaded books, plus limits |
| `POST /api/uploads?title=&author=&year=` | user | Body: the PDF (`Content-Type: application/pdf`) → 202, status `processing` |
| `GET` / `DELETE /api/uploads/:id` | user | Status (`processing` / `ready` / `failed`) / remove the book and its passages |
| `GET /api/admin/stats` | admin | Users, questions by status, channel and model, tokens, latency, uploads, pipeline |
| `GET /api/admin/users`, `GET` / `PATCH` / `DELETE /api/admin/users/:id` | admin | Manage accounts (role, active) |
| `POST /api/admin/users/:id/revoke-sessions` | admin | Sign a user out everywhere |
| `GET /api/admin/activity` | admin | Recent questions: outcome, citations, model, latency. Never the text. |
| `GET /api/admin/uploads`, `GET /api/admin/audit-log` | admin | Uploaded books across users; admin actions |
| `GET /api/admin/pipeline`, `POST /api/admin/pipeline/restart` | admin | Worker state; restart it |

### Asking

```bash
curl -X POST http://127.0.0.1:4000/api/ask -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"question": "Is it good to rock a baby to sleep?"}'
```

```json
{
  "question": "Is it good to rock a baby to sleep?",
  "status": "answered",
  "answer": "Rocking a baby to sleep is not recommended... [Chavasse 1878, p. 80; Holt 1894, p. 98] ...",
  "citations": [
    { "id": "S1", "label": "Chavasse 1878, p. 80", "bookId": "chavasse_1878",
      "title": "Advice to a Mother on the Management of Her Children", "author": "Pye Henry Chavasse",
      "year": 1878, "page": 80, "chunkId": "chavasse_1878_p80_c0", "text": "…passage…",
      "source": "library", "score": 0.802 }
  ],
  "statements": [ { "text": "…", "citationIds": ["S1", "S6"] } ],
  "conflicts": [],
  "notCovered": [],
  "error": null,
  "meta": { "latencyMs": 9554, "passagesRetrieved": 7, "booksRetrieved": ["chavasse_1878", "holt_1894", "read_1916", "sadler_1916"],
            "model": "nvidia/nemotron-3.5-super-vl:free", "cached": false },
  "chatId": null,
  "createdAt": "2026-11-18T21:20:11.000Z"
}
```

- **`books`.** Library IDs (`holt_1894`) and/or your upload IDs (`up_3fa1c2…`). Omit it to search
  everything you can see. Another reader's upload ID is rejected.
- **`chatId`.** A saved chat to append this exchange to. Without it, nothing about the question is
  stored, only a usage event with no text.
- **`history`.** Up to 4 earlier questions, so follow-ups like "and at night?" work.
- **`status`.** One of `answered`, `partial` (gaps listed in `notCovered`), `insufficient` (nothing
  relevant in the books, so no model call is made), or `error`.
- **Errors keep the same shape.** They add `error: {code, message}`, and `answer` holds a message
  that can be shown to the user. The HTTP status depends on the code:

  | Code | HTTP status |
  |---|---|
  | `refusal` | 200 |
  | `service_unavailable`, `pipeline_unavailable` | 503 |
  | `pipeline_timeout` | 504 |
  | `service_error`, `invalid_output`, `internal_error` | 502 |

### Sessions

Sign-up and sign-in return:

```
{user, tokenType: "Bearer", accessToken, expiresIn: 900, refreshToken, refreshTokenExpiresAt}
```

Each refresh token works once. If an already-used refresh token is presented again, every session
from that sign-in is revoked.

**Browser mode.** Requests with the header `X-LorelAI-Client: web` behave differently:

- The refresh token is set as an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`, and
  left out of the response body.
- `/refresh` and `/signout` read the token from that cookie, but only when the header is present.

A page on another site can't send the cookie, or add the header without a preflight that CORS refuses.

### Errors

```json
{ "error": { "code": "invalid_request", "message": "Some fields are missing or invalid",
             "details": [ { "field": "body.password", "message": "Password must be at least 8 characters" } ] },
  "requestId": "4f7c…" }
```

Codes by HTTP status:

| HTTP | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_json` |
| 401 | `unauthorized`, `invalid_credentials`, `token_expired`, `invalid_token`, `invalid_refresh_token` |
| 403 | `forbidden`, `account_disabled`, `self_modification`, `trial_exhausted` |
| 404 | `not_found` |
| 409 | `email_taken`, `last_admin`, `chat_limit`, `upload_limit`, `still_processing` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited`, `trial_ip_limit` |
| 503 | `pipeline_unavailable` |

## Code layout

```
src/server.js            start-up: config, migrations, worker, HTTP server
src/app.js               the Express app: security headers, CORS, routes, static site
src/config.js            environment variables → config
src/cookies.js           the two cookies (session refresh token, trial token)
src/db/                  SQLite behind async get/all/run/transaction (the MySQL swap point); migrations/*.sql
src/repositories/        SQL per table: users, refresh tokens, chats, user books, trial sessions, ask events, audit log
src/services/            auth, passwords (scrypt), tokens (JWT), answers (ask + record), uploads, rag/ (worker bridge, formatting)
src/middleware/          auth, zod validation, rate limits, request log, error handler
src/routes/              health, auth, ask, trial, books, chats, uploads, admin
scripts/                 create-admin, smoke
test/                    node:test + supertest
```
