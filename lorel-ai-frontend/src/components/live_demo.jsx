import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";
import { SUGGESTIONS, spineColor, surname } from "../lib/text";
import { Answer, PendingAnswer } from "./answer";
import { SendIcon } from "./icons";
import SourcePanel from "./source_panel";

/* The hero's answer-engine window, now live: a visitor can ask the real pipeline a few
   questions with no account. Same chrome, trace, chips and receipt as the original
   scripted demo, so the page looks the same until someone types. */


let nextTurnId = 1;

function Shelf({ books }) {
  if (!books?.length) return null;
  const years = books.map((b) => b.year).filter(Boolean);
  return (
    <div className="shelf" aria-label="Demo library">
      <ul className="shelf__books">
        {books.map((book) => (
          <li key={book.id} className="shelf__book" title={`${book.title} — ${book.author} (${book.year})`}>
            <span className="shelf__spine" style={{ "--spine": spineColor(book.id) }}>
              {surname(book.author).charAt(0)}
            </span>
            <span className="shelf__text">
              <span className="shelf__title">{book.title}</span>
              <span className="shelf__sub">
                {surname(book.author)} · {book.year}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {years.length > 0 && (
        <p className="shelf__note">
          Public-domain books, {Math.min(...years)}–{Math.max(...years)}. Historical advice, not medical guidance.
        </p>
      )}
    </div>
  );
}

export default function LiveDemo({ inputRef }) {
  const { status: authStatus } = useAuth();
  const [trial, setTrial] = useState(null);
  const [books, setBooks] = useState(null);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    api("/api/trial", { auth: false })
      .then(setTrial)
      .catch(() => setTrial({ limit: 3, used: 0, remaining: 3 }));
    api("/api/books", { auth: false })
      .then((data) => setBooks(data.books))
      .catch(() => setBooks([]));
  }, []);

  // A new question scrolls to the top of the window, so its sources and answer read top-down
  useEffect(() => {
    const body = bodyRef.current;
    const latest = body?.querySelector(".live-demo__turn:last-child");
    if (latest) body.scrollTo({ top: latest.offsetTop - 14, behavior: "smooth" });
  }, [turns.length]);

  const pending = turns.some((turn) => turn.state === "pending");
  const exhausted = trial ? trial.remaining <= 0 : false;

  const updateTurn = (id, patch) => setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));

  const ask = useCallback(
    async (text) => {
      const question = text.trim();
      if (!question || pending || exhausted) return;
      const id = nextTurnId++;
      const history = turns.filter((t) => t.state === "done" && t.response.status !== "error").slice(-2).map((t) => t.question);
      setTurns((all) => [...all, { id, question, state: "pending" }]);
      setDraft("");
      setSource(null);
      try {
        const response = await api("/api/trial/ask", { method: "POST", body: { question, history }, auth: false });
        setTrial(response.trial);
        updateTurn(id, { state: "done", response });
      } catch (error) {
        if (error.body?.status === "error") {
          // The pipeline answered with an error (outage, timeout): show it in the thread
          if (error.body.trial) setTrial(error.body.trial);
          updateTurn(id, { state: "done", response: error.body });
        } else if (error.code === "trial_exhausted" || error.code === "trial_ip_limit") {
          setTrial(error.details ?? { limit: 3, used: 3, remaining: 0 });
          setTurns((all) => all.filter((turn) => turn.id !== id));
        } else {
          updateTurn(id, { state: "failed", message: error.message });
        }
      }
    },
    [pending, exhausted, turns]
  );

  const retry = (turn) => {
    setTurns((all) => all.filter((t) => t.id !== turn.id));
    ask(turn.question);
  };

  const used = trial?.used ?? 0;
  const limit = trial?.limit ?? 3;
  const activeCitations = source?.citations ?? [];

  return (
    <>
      <div className="ai-demo live-demo" id="demo">
        <div className="ai-demo__chrome">
          <span className="ai-demo__dot" />
          <span className="ai-demo__dot" />
          <span className="ai-demo__dot" />
          <span className="ai-demo__chrome-label">lorelai · answer engine</span>
          <span className={`ai-demo__status${pending ? " is-busy" : ""}`}>
            <i className="ai-demo__pulse" />
            {pending ? "retrieving" : "grounded"}
          </span>
        </div>

        <div className="ai-demo__body live-demo__body" ref={bodyRef}>
          {turns.length === 0 ? (
            <div className="live-demo__intro">
              <p className="live-demo__lede">
                Ask a real question. The answer is written only from the books below and every claim is cited to its
                page.
              </p>
              <Shelf books={books} />
              <span className="ai-demo__who">try one</span>
              <div className="live-demo__suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="prompt-chip"
                    onClick={() => ask(suggestion)}
                    disabled={exhausted}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <div className="live-demo__turn" key={turn.id}>
                <div className="ai-demo__row ai-demo__row--user">
                  <span className="ai-demo__who">you</span>
                  <p className="ai-demo__bubble">{turn.question}</p>
                </div>
                {turn.state === "pending" && <PendingAnswer bookCount={books?.length} />}
                {turn.state === "failed" && (
                  <div className="ai-demo__row ai-demo__row--ai">
                    <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
                    <div className="ai-demo__bubble ai-demo__bubble--ai answer__body is-error">
                      <div className="answer__error">
                        <p>{turn.message}</p>
                        <button type="button" className="text-button" onClick={() => retry(turn)}>
                          Try again
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {turn.state === "done" && (
                  <Answer
                    response={turn.response}
                    traceLabel="retrieval · demo library"
                    activeId={source?.turnId === turn.id ? source.citation.id : null}
                    onCite={(citation) => setSource({ turnId: turn.id, citation, citations: turn.response.citations })}
                    onRetry={() => retry(turn)}
                  />
                )}
              </div>
            ))
          )}
        </div>

        {exhausted ? (
          <div className="live-demo__gate">
            <div>
              <p className="live-demo__gate-title">That&rsquo;s your {limit} free questions.</p>
              <p className="live-demo__gate-text">
                {authStatus === "signedIn"
                  ? "Keep going in the app: unlimited questions, saved chats and your own books."
                  : "Create a free account for unlimited questions, saved chats and your own books."}
              </p>
            </div>
            {authStatus === "signedIn" ? (
              <Link className="btn btn--primary" to="/app">
                Open the app
              </Link>
            ) : (
              <div className="live-demo__gate-actions">
                <Link className="btn btn--primary" to="/try?mode=signup">
                  Create free account
                </Link>
                <Link className="text-button" to="/try?mode=signin">
                  Sign in
                </Link>
              </div>
            )}
          </div>
        ) : (
          <form
            className="live-demo__composer"
            onSubmit={(event) => {
              event.preventDefault();
              ask(draft);
            }}
          >
            <label className="visually-hidden" htmlFor="demo-question">
              Ask the demo library a question
            </label>
            <input
              id="demo-question"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={turns.length ? "Ask a follow-up…" : "Ask about feeding, sleep, bathing, weaning…"}
              maxLength={1000}
              autoComplete="off"
              disabled={pending}
            />
            <button type="submit" className="send-button" disabled={pending || !draft.trim()} aria-label="Ask">
              <SendIcon size={17} />
            </button>
          </form>
        )}

        <div className="live-demo__meter">
          <span className="live-demo__pips" aria-hidden="true">
            {Array.from({ length: limit }, (_, i) => (
              <i key={i} className={i < used ? "is-used" : ""} />
            ))}
          </span>
          <span>
            {exhausted ? "free questions used" : `${limit - used} of ${limit} free questions left`}
          </span>
          {!exhausted && authStatus !== "signedIn" && (
            <Link to="/try?mode=signup" className="live-demo__meter-link">
              unlimited with a free account →
            </Link>
          )}
        </div>
      </div>

      <SourcePanel
        citation={source?.citation}
        citations={activeCitations}
        onSelect={(citation) => setSource((current) => ({ ...current, citation }))}
        onClose={() => setSource(null)}
      />
    </>
  );
}
