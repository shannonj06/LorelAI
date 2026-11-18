import { useEffect, useRef } from "react";

import { readablePassage } from "../lib/text";
import { CiteChip } from "./answer";
import { CloseIcon } from "./icons";

/* The receipt behind a citation: which book, which page, and the passage itself.
   "drawer" slides over the page (landing, phones); "docked" sits beside the chat. */
export default function SourcePanel({ citation, citations = [], onSelect, onClose, variant = "drawer" }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!citation) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [citation, onClose]);

  useEffect(() => {
    if (citation && variant === "drawer") closeRef.current?.focus({ preventScroll: true });
  }, [citation, variant]);

  if (!citation) return null;
  const others = citations.filter((c) => c.id !== citation.id);
  const isUpload = citation.source === "upload";

  const panel = (
    <aside
      className={`source-panel source-panel--${variant}`}
      aria-label={`Source: ${citation.title}`}
      role={variant === "drawer" ? "dialog" : "complementary"}
      aria-modal={variant === "drawer" ? "true" : undefined}
    >
      <header className="source-panel__head">
        <span className="source-panel__eyebrow">
          source {citation.id}
          {isUpload ? " · your upload" : " · library"}
        </span>
        <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close source">
          <CloseIcon size={16} />
        </button>
      </header>

      <h3 className="source-panel__title">{citation.title}</h3>
      <p className="source-panel__meta">
        {[citation.author, citation.year, citation.page != null && `p. ${citation.page}`].filter(Boolean).join(" · ")}
      </p>

      {typeof citation.score === "number" && (
        <div className="source-panel__score">
          <span>match to your question</span>
          <span className="ai-demo__score-bar">
            <span className="ai-demo__score-fill" style={{ width: `${Math.round(citation.score * 100)}%` }} />
          </span>
          <span>{citation.score.toFixed(2)}</span>
        </div>
      )}

      <blockquote className="source-panel__passage">{readablePassage(citation.text ?? "")}</blockquote>

      <p className="source-panel__note">
        {isUpload
          ? "From your uploaded PDF. Page numbers are the PDF's own pages."
          : "From the indexed text of a public-domain edition. Page numbers refer to sections of that digitized text, not a printed edition. Capitalization restored for reading."}
      </p>

      {others.length > 0 && (
        <div className="source-panel__others">
          <span className="source-panel__eyebrow">also cited in this answer</span>
          <div className="source-panel__chips">
            {others.map((other) => (
              <CiteChip key={other.id} citation={other} onCite={onSelect} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );

  if (variant === "docked") return panel;
  return (
    <div className="source-drawer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {panel}
    </div>
  );
}
