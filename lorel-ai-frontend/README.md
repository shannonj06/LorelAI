# LorelAI website

React 19 + Vite. One app covers four screens:

- the landing page, with a live demo of 3 free questions;
- Try it now (sign up / sign in);
- the app (chat, saved chats, library, your uploaded books);
- admin.

Setup and the full picture: [../README.md](../README.md). Design decisions: [../DESIGN_PROCESS.md](../DESIGN_PROCESS.md).

```bash
npm install
npm run dev      # http://localhost:5173; proxies /api to the API on :4000 (start it with `npm start` in ../api)
npm run build    # dist/, which the API serves at http://127.0.0.1:4000
npm run lint
```

`.env.local` holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, which only the waitlist form uses.
Without them, the waitlist form shows a friendly message and the rest of the site works normally.

```
src/main.jsx, App.jsx        entry point; routes: / · /try · /app · /app/chats/:id · /admin
src/index.css, ai.css        the original landing-page design (tokens, hero, demo window, sections)
src/product.css              everything new, built from the same tokens
src/lib/                     api (fetch + session refresh), auth, router, text helpers, waitlist
src/components/              landing sections, live_demo, answer (chips, trace, receipt), source_panel, icons
src/pages/                   landing, try_page, app/ (app_page, sidebar, chat_pane, upload_dialog), admin_page
```
