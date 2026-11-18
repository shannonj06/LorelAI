import { useEffect, useMemo, useState } from "react";

import { chipLabel, modelName, plural } from "../lib/text";

/* One grounded answer, rendered from the API's structured response: statements with
   their citation chips, the "books differ" note, gaps, and the verification receipt.
   Chips are buttons; onCite(citation) opens the source passage. */

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const prefersReducedMotion = () => Boolean(window.matchMedia?.(MOTION_QUERY).matches);

export function CiteChip({ citation, onCite, active }) {
  if (!citation) return null;
  return (
    <button
      type="button"
      className={`ai-demo__cite cite-chip${active ? " is-active" : ""}${citation.source === "upload" ? " is-upload" : ""}`}
      onClick={() => onCite?.(citation)}
      title={`${citation.title ?? "Source"}${citation.author ? ` — ${citation.author}` : ""}`}
    >
      {chipLabel(citation)}
    </button>
  );
}

/** Chips for a statement, one per distinct label (two chunks of one page share a chip). */
function Chips({ ids, byId, onCite, activeId }) {
  const seen = new Set();
  return ids
    .map((id) => byId[id])
    .filter((citation) => citation && !seen.has(citation.label) && seen.add(citation.label))
    .map((citation) => (
      <CiteChip key={citation.id} citation={citation} onCite={onCite} active={citation.id === activeId} />
    ));
}

/** The retrieval trace: which passages the answer was grounded in, with relevance. */
export function SourceTrace({ response, onCite, activeId, label = "retrieval · library" }) {
  const { citations, meta } = response;
  if (!citations?.length) return null;
  return (
    <div className="ai-demo__trace source-trace">
      <div className="ai-demo__trace-head">
        <span className="ai-demo__trace-label">{label}</span>
        <span className="ai-demo__trace-count">
          {citations.length}/{meta?.passagesRetrieved ?? citations.length} passages cited
        </span>
      </div>
      <ul className="ai-demo__sources">
        {citations.map((citation, index) => (
          <li key={citation.id} style={{ animationDelay: `${index * 90}ms` }}>
            <button
              type="button"
              className={`ai-demo__source is-in source-trace__item${citation.id === activeId ? " is-active" : ""}`}
              onClick={() => onCite?.(citation)}
            >
              <span className="ai-demo__source-meta">
                <span className="ai-demo__source-title">{citation.title}</span>
                <span className="ai-demo__source-sub">
                  {citation.author ?? "Unknown author"}
                  {citation.year ? ` (${citation.year})` : ""} — p. {citation.page ?? "?"}
                  {citation.source === "upload" ? " · your upload" : ""}
                </span>
              </span>
              {typeof citation.score === "number" && (
                <span className="ai-demo__score">
                  <span className="ai-demo__score-bar">
                    <span className="ai-demo__score-fill" style={{ width: `${Math.round(citation.score * 100)}%` }} />
                  </span>
                  {citation.score.toFixed(2)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** While the pipeline works: what it's doing, honestly paced by elapsed time. */
export function PendingAnswer({ bookCount }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);
  const phase =
    seconds < 2
      ? `retrieval · searching ${bookCount ? plural(bookCount, "book") : "the library"}`
      : seconds < 14
        ? "grounding · writing only from the passages"
        : seconds < 30
          ? "verifying · checking every citation"
          : "still working · free models can be slow";
  return (
    <div className="pending-answer" role="status" aria-live="polite">
      <div className="ai-demo__trace is-pending">
        <div className="ai-demo__trace-head">
          <span className="ai-demo__trace-label">{phase}</span>
          <span className="ai-demo__trace-count">{seconds}s</span>
        </div>
        <ul className="ai-demo__sources">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton-row" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </ul>
      </div>
      <div className="ai-demo__row ai-demo__row--ai">
        <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
        <p className="ai-demo__bubble ai-demo__bubble--ai">
          <span className="typing-dots" aria-label="Writing an answer">
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
    </div>
  );
}

function Receipt({ response }) {
  const { status, statements, conflicts, notCovered, meta, error } = response;
  const facts = [meta?.model && modelName(meta.model), meta?.cached ? "instant (cached)" : meta?.latencyMs != null && `${(meta.latencyMs / 1000).toFixed(1)}s`]
    .filter(Boolean)
    .join(" · ");

  if (status === "error") {
    if (error?.code !== "refusal") return null;
    return (
      <div className="ai-demo__verify receipt is-neutral">
        <span className="ai-demo__check">○</span>
        <span>Declined: outside what LorelAI answers. Nothing was generated.</span>
      </div>
    );
  }
  if (status === "insufficient") {
    return (
      <div className="ai-demo__verify receipt is-neutral">
        <span className="ai-demo__check">○</span>
        <span>No passage in these books supports an answer, so nothing was generated.</span>
        {facts && <span className="receipt__facts">{facts}</span>}
      </div>
    );
  }
  const claims = statements.length + conflicts.length;
  return (
    <div className="ai-demo__verify receipt">
      <span className="ai-demo__check">✓</span>
      <span>
        {plural(claims, "claim")} checked · {claims} cited to a page · 0 uncited shipped
        {notCovered.length > 0 && ` · ${plural(notCovered.length, "gap")} flagged`}
      </span>
      {facts && <span className="receipt__facts">{facts}</span>}
    </div>
  );
}

/**
 * A full answer. animate reveals the statements word by word (skipped for reduced motion
 * and for answers loaded from a saved chat).
 */
export function Answer({ response, onCite, activeId, animate = true, onRetry, traceLabel }) {
  const { status, statements = [], conflicts = [], notCovered = [], citations = [], error } = response;
  const byId = useMemo(() => Object.fromEntries(citations.map((c) => [c.id, c])), [citations]);
  const words = useMemo(() => statements.map((s) => s.text.split(" ")), [statements]);
  const totalWords = words.reduce((sum, w) => sum + w.length, 0);

  const [shown, setShown] = useState(() => (animate && !prefersReducedMotion() ? 0 : Infinity));
  useEffect(() => {
    if (shown >= totalWords) return undefined;
    const timer = setTimeout(() => setShown((n) => n + 2), 22);
    return () => clearTimeout(timer);
  }, [shown, totalWords]);
  const done = shown >= totalWords;

  let budget = shown;
  const isError = status === "error";
  return (
    <div className="answer">
      {!isError && <SourceTrace response={response} onCite={onCite} activeId={activeId} label={traceLabel} />}
      <div className="ai-demo__row ai-demo__row--ai">
        <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
        <div className={`ai-demo__bubble ai-demo__bubble--ai answer__body${isError ? " is-error" : ""}`} aria-live="polite">
          {isError ? (
            <div className="answer__error">
              <p>{error?.message ?? response.answer}</p>
              {onRetry && error?.code !== "refusal" && (
                <button type="button" className="text-button" onClick={onRetry}>
                  Try again
                </button>
              )}
            </div>
          ) : status === "insufficient" ? (
            <p className="answer__empty">
              {response.answer} Try asking about feeding, sleep, bathing, teething or weaning, or choose different books.
            </p>
          ) : (
            statements.map((statement, index) => {
              const visible = Math.max(0, Math.min(words[index].length, budget));
              budget -= words[index].length;
              if (visible === 0) return null;
              const complete = visible === words[index].length;
              return (
                <p className="answer__statement" key={index}>
                  {complete ? statement.text : words[index].slice(0, visible).join(" ")}{" "}
                  {complete ? (
                    <Chips ids={statement.citationIds} byId={byId} onCite={onCite} activeId={activeId} />
                  ) : (
                    <span className="ai-demo__caret" />
                  )}
                </p>
              );
            })
          )}

          {done && conflicts.length > 0 && (
            <div className="answer__conflict">
              <span className="answer__conflict-label">where the books differ</span>
              {conflicts.map((conflict, index) => (
                <p key={index}>
                  {conflict.summary} <Chips ids={conflict.citationIds} byId={byId} onCite={onCite} activeId={activeId} />
                </p>
              ))}
            </div>
          )}

          {done && notCovered.length > 0 && (
            <div className="answer__gaps">
              <span className="answer__gaps-label">not in the passages found</span>
              <ul>
                {notCovered.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {done && <Receipt response={response} />}
    </div>
  );
}
