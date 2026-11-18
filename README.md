# LorelAI

**The parenting AI that can't make things up.** LorelAI answers questions from parenting
books only, and every sentence it writes is cited to the page it came from. When the books
disagree, it says so. When they don't cover something, it says that instead of guessing.

This repository has the whole product:

| What | Where | Built with |
|---|---|---|
| Website: landing page with a live 3-question demo, sign-up/sign-in, the chat app, admin | [`lorel-ai-frontend/`](lorel-ai-frontend/) | React 19, Vite |
| API: accounts, sessions, asking, saved chats, uploaded books, admin; serves the site | [`api/`](api/) | Node 22+, Express 5, SQLite |
| Answer engine: retrieval across books, grounded generation, citation checks, PDF ingestion | [`backend/`](backend/) | Python 3.11, Chroma, sentence-transformers, OpenRouter |

[DESIGN_PROCESS.md](DESIGN_PROCESS.md) explains what was built and why: the user experience,
architecture, security model, verification, and known limitations.

## Quick start

You need **Node 22.13+** and **Python 3.11** (the version the pipeline was tested with).

```bash
# 1. Install
npm run setup                                  # API + website dependencies
python -m pip install -r backend/requirements.txt

# 2. Configure: copy the template and add a model key
cp api/.env.example api/.env                   # then set OPENROUTER_API_KEY (and JWT_SECRET)

# 3. Build the site and start everything
npm run build
npm start                                      # → http://127.0.0.1:4000
```

Open http://127.0.0.1:4000:

- The landing page's live demo answers 3 questions without an account.
- **Try it now** creates an account for unlimited questions, saved chats and uploads.

The first start takes about 15 seconds while the embedding model loads; the demo says
"starting up" until then.

**Make yourself an admin:**

```bash
npm run create-admin -- --email you@example.com --password "a long password"
```

or set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `api/.env` before the first start. Admins get an
**Admin** link in the app.

## Developing

Run two terminals for hot reload:

```bash
npm run dev:api        # API on :4000, restarts on changes
npm run dev:web        # Vite on http://localhost:5173, proxies /api to :4000
```

| Check | Command | Status |
|---|---|---|
| API tests | `npm test` | 96 tests |
| Pipeline tests | `cd backend && python -m pytest testing` | 142 tests; loads the embedding model, ~25 s |
| Website lint | `npm run lint` | |
| End to end against a running server | `npm run smoke` | Makes one real model call |

## Configuration

Everything lives in `api/.env` (gitignored). The full list, with explanations, is in
[`api/.env.example`](api/.env.example). The ones that matter:

| Variable | Default | What it does |
|---|---|---|
| `OPENROUTER_API_KEY` | – | Key for OpenRouter's free models. **Required** to get answers. |
| `OPENROUTER_MODEL` | `google/gemma-4-26b-a4b-it:free` | Primary model. When it's busy, OpenRouter falls back to Gemma 4 31B, then Nemotron 3.5 (`OPENROUTER_FALLBACK_MODELS`). |
| `LLM_PROVIDER` | `openrouter` when a key is set | `anthropic` switches to Claude (needs `ANTHROPIC_API_KEY`). |
| `JWT_SECRET` | random per start | Signs sessions. Set it, or everyone is signed out on every restart. Required in production. |
| `TRIAL_QUESTION_LIMIT` | `3` | Free questions on the landing page. |
| `UPLOAD_MAX_MB` / `UPLOAD_MAX_PER_USER` | `25` / `5` | Limits on uploaded books. |
| `RAG_PYTHON` | `python` (Windows) / `python3` | The Python with `backend/requirements.txt` installed. |

`lorel-ai-frontend/.env.local` holds the Supabase keys used only by the waitlist form.

## How a question is answered

1. The question is embedded and matched against every selected book: the best passages overall,
   plus the best ones from each book, so differing views reach the model.
2. Off-topic questions stop here with "not in the books", without a model call.
3. The model writes JSON in which each sentence lists the passages that support it.
4. The pipeline checks the reply: every cited passage exists, quotes appear verbatim, page
   numbers match, conflicts cite both sides. If a check fails, the model gets one retry with
   feedback; if it fails again, nothing is shown.
5. The site shows the answer with clickable `[Book, p.X]` chips. Each opens the passage itself.

More in [DESIGN_PROCESS.md](DESIGN_PROCESS.md#how-an-answer-is-made).

## Repository layout

```
api/                   Express API (src/, test/, scripts/), README with every endpoint
backend/               Python answer engine: retrieval.py, generation.py, llm.py, ingest.py, rag_worker.py
  books/, books_clean/   the four public-domain books (source and cleaned text)
  chroma_db/             their vector index (committed)
  testing/               pytest suites
lorel-ai-frontend/     React site (src/pages, src/components, src/lib)
docs/                  earlier backend report (API layer milestone)
DESIGN_PROCESS.md      what was built and why
```

## Good to know

- **The demo library is four public-domain books from 1878–1916.** Their advice is historical,
  not medical guidance. The site says so wherever answers appear. The landing page's "licensed
  books" copy describes the product vision, not this demo corpus.
- **Free models are slow and rate-limited.** Expect 8–30 s per answer. Repeated questions are
  answered instantly from a cache. OpenRouter's free tier caps daily requests; check your
  account's limits before a demo.
- **Uploads are a work in progress.** Only PDFs with a text layer work. Scanned books are
  rejected with a clear message, because they need OCR.
- **Chats vanish unless saved.** Unsaved conversations are never stored on the server; admins see
  only usage counts, never question text.
