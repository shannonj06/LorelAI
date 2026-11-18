import { useEffect, useRef, useState } from "react";

import { Answer, PendingAnswer } from "../../components/answer";
import { SendIcon } from "../../components/icons";
import { SUGGESTIONS, plural } from "../../lib/text";

function SaveToggle({ saved, disabled, onChange }) {
  return (
    <label className={`save-toggle${saved ? " is-on" : ""}${disabled ? " is-disabled" : ""}`}>
      <span className="switch">
        <input type="checkbox" role="switch" checked={saved} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <i aria-hidden="true" />
      </span>
      <span className="save-toggle__text">
        <strong>{saved ? "Saved" : "Save chat"}</strong>
        <small>{saved ? "Kept in your saved chats" : "Off: this chat vanishes when you leave"}</small>
      </span>
    </label>
  );
}

function ChatTitle({ chat, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(chat.title ?? "");

  if (!chat.id) return <h1 className="chat__title">New chat</h1>;
  if (!editing) {
    return (
      <h1 className="chat__title">
        <button
          type="button"
          className="chat__title-button"
          onClick={() => {
            setValue(chat.title ?? "");
            setEditing(true);
          }}
          title="Rename"
        >
          {chat.title}
        </button>
      </h1>
    );
  }
  const finish = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== chat.title) onRename(value.trim());
  };
  return (
    <input
      className="chat__title-input"
      value={value}
      autoFocus
      maxLength={120}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish();
        if (e.key === "Escape") {
          setValue(chat.title);
          setEditing(false);
        }
      }}
      aria-label="Chat title"
    />
  );
}

function Composer({ onAsk, disabled, busy, hint, composerRef }) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef(null);

  useEffect(() => {
    if (composerRef) composerRef.current = textareaRef.current;
  }, [composerRef]);

  // Grow with the text, up to six lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = () => {
    if (!draft.trim() || busy || disabled) return;
    onAsk(draft);
    setDraft("");
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="composer__box">
        <label className="visually-hidden" htmlFor="question">
          Your question
        </label>
        <textarea
          id="question"
          ref={textareaRef}
          rows={1}
          value={draft}
          maxLength={1000}
          placeholder={disabled ? "Pick a book to ask" : "Ask the books a question…"}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="send-button" disabled={busy || disabled || !draft.trim()} aria-label="Ask">
          <SendIcon size={17} />
        </button>
      </div>
      <p className="composer__hint">{hint}</p>
    </form>
  );
}

export default function ChatPane({
  chat,
  loading,
  bookCount,
  selectedCount,
  saving,
  onSave,
  onRename,
  onAsk,
  onRetry,
  source,
  onCite,
  composerRef,
}) {
  const threadRef = useRef(null);
  const busy = chat.turns.some((t) => t.state === "pending");
  const canSave = chat.turns.some((t) => t.state === "done" && t.response.status !== "error");

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [chat.turns.length, busy]);

  const scope =
    selectedCount === bookCount ? `all ${plural(bookCount, "book")}` : `${selectedCount} of ${plural(bookCount, "book")}`;

  return (
    <main className="chat">
      <div className="chat__head">
        <div className="chat__heading">
          <ChatTitle chat={chat} onRename={onRename} />
          <span className="chat__scope">answering from {scope}</span>
        </div>
        <SaveToggle saved={Boolean(chat.id)} disabled={saving || (!chat.id && !canSave)} onChange={onSave} />
      </div>

      <div className="chat__thread" ref={threadRef}>
        {loading ? (
          <div className="chat__loading">
            <span className="spinner" /> Opening chat…
          </div>
        ) : chat.turns.length === 0 ? (
          <div className="chat-empty">
            <p className="small-heading">your library · {plural(selectedCount, "book")} selected</p>
            <h2 className="chat-empty__title">
              What&rsquo;s on your mind <span>tonight?</span>
            </h2>
            <p className="chat-empty__lede">
              Answers come only from the books selected on the left, and every claim is cited to its page. Tap a
              citation to read the passage it came from.
            </p>
            <div className="chat-empty__suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="prompt-chip" onClick={() => onAsk(suggestion)} disabled={selectedCount === 0}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.turns.map((turn) => (
            <div className="chat__turn" key={turn.id}>
              <div className="ai-demo__row ai-demo__row--user">
                <span className="ai-demo__who">you</span>
                <p className="ai-demo__bubble">{turn.question}</p>
              </div>
              {turn.state === "pending" && <PendingAnswer bookCount={selectedCount} />}
              {turn.state === "failed" && (
                <div className="ai-demo__row ai-demo__row--ai">
                  <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
                  <div className="ai-demo__bubble ai-demo__bubble--ai answer__body is-error">
                    <div className="answer__error">
                      <p>{turn.message}</p>
                      <button type="button" className="text-button" onClick={() => onRetry(turn)}>
                        Try again
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {turn.state === "done" && (
                <Answer
                  response={turn.response}
                  animate={Boolean(turn.fresh)}
                  traceLabel="retrieval · your library"
                  activeId={source?.turnId === turn.id ? source.citation.id : null}
                  onCite={(citation) => onCite(turn, citation)}
                  onRetry={() => onRetry(turn)}
                />
              )}
            </div>
          ))
        )}
      </div>

      <Composer
        onAsk={onAsk}
        busy={busy}
        disabled={selectedCount === 0}
        composerRef={composerRef}
        hint={
          chat.id
            ? "Enter to ask · Shift+Enter for a new line · this chat is saved"
            : "Enter to ask · Shift+Enter for a new line · not saved unless you switch on Save chat"
        }
      />
    </main>
  );
}
