import { useEffect, useState } from "react";

import { CheckIcon, CloseIcon, PlusIcon, TrashIcon, UploadIcon } from "../../components/icons";
import { Link } from "../../lib/router";
import { relativeTime, spineColor, surname } from "../../lib/text";

/** A delete button that asks once: first click arms it, second click deletes. */
function ConfirmDelete({ label, onConfirm, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`row-action${armed ? " is-armed" : ""}`}
      disabled={disabled}
      aria-label={armed ? `Confirm: ${label}` : label}
      title={armed ? "Click again to confirm" : label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      {armed ? "delete?" : <TrashIcon size={14} />}
    </button>
  );
}

function BookRow({ id, title, sub, checked, disabled, onToggle, action, tone }) {
  return (
    <li>
      <label className={`book-row${checked ? " is-on" : ""}${disabled ? " is-disabled" : ""}${tone ? ` is-${tone}` : ""}`}>
        <input
          type="checkbox"
          className="visually-hidden"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(id)}
        />
        <span className="book-row__check" aria-hidden="true">
          <CheckIcon size={11} />
        </span>
        <span className="book-row__spine" style={{ "--spine": spineColor(id) }} aria-hidden="true" />
        <span className="book-row__text">
          <span className="book-row__title">{title}</span>
          <span className="book-row__sub">{sub}</span>
        </span>
        {action}
      </label>
    </li>
  );
}

export default function Sidebar({
  open,
  onClose,
  onNewChat,
  saved,
  activeChatId,
  onDeleteChat,
  library,
  libraryState,
  uploads,
  uploadLimits,
  isSelected,
  onToggleBook,
  onSetLibrary,
  onUpload,
  onDeleteUpload,
}) {
  const allLibraryOn = library.length > 0 && library.every((book) => isSelected(book.id));
  const usedUploads = uploads.filter((u) => u.status !== "failed").length;

  return (
    <>
      <aside className={`sidebar${open ? " is-open" : ""}`} aria-label="Chats and books">
        <div className="sidebar__top">
          <button type="button" className="btn btn--primary btn--block" onClick={onNewChat}>
            <PlusIcon size={16} /> New chat
          </button>
          <button type="button" className="icon-button sidebar__close" onClick={onClose} aria-label="Close menu">
            <CloseIcon size={16} />
          </button>
        </div>

        <section className="sidebar__section">
          <h3 className="sidebar__heading">Saved chats</h3>
          {saved.length === 0 ? (
            <p className="sidebar__empty">
              Chats vanish when you leave. Switch on <em>Save chat</em> to keep one here.
            </p>
          ) : (
            <ul className="chat-list">
              {saved.map((chat) => (
                <li key={chat.id}>
                  <Link
                    to={`/app/chats/${chat.id}`}
                    className={`chat-list__item${chat.id === activeChatId ? " is-active" : ""}`}
                    onClick={onClose}
                  >
                    <span className="chat-list__title">{chat.title}</span>
                    <span className="chat-list__time">{relativeTime(chat.updatedAt)}</span>
                    <ConfirmDelete label={`Delete "${chat.title}"`} onConfirm={() => onDeleteChat(chat)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sidebar__section">
          <div className="sidebar__heading-row">
            <h3 className="sidebar__heading">Library</h3>
            {library.length > 0 && (
              <button type="button" className="text-button text-button--small" onClick={() => onSetLibrary(!allLibraryOn)}>
                {allLibraryOn ? "clear" : "select all"}
              </button>
            )}
          </div>
          {libraryState === "loading" && <p className="sidebar__empty">Opening the library…</p>}
          {libraryState === "starting" && <p className="sidebar__empty">The library is starting up. One moment…</p>}
          <ul className="book-list">
            {library.map((book) => (
              <BookRow
                key={book.id}
                id={book.id}
                title={book.title}
                sub={`${surname(book.author)} · ${book.year}`}
                checked={isSelected(book.id)}
                onToggle={onToggleBook}
              />
            ))}
          </ul>
        </section>

        <section className="sidebar__section">
          <div className="sidebar__heading-row">
            <h3 className="sidebar__heading">
              Your books <span className="beta-tag">beta</span>
            </h3>
          </div>
          {uploads.length > 0 && (
            <ul className="book-list">
              {uploads.map((upload) => {
                const ready = upload.status === "ready";
                const sub =
                  upload.status === "processing" ? (
                    <span className="indexing">
                      <span className="spinner" aria-hidden="true" /> indexing…
                    </span>
                  ) : upload.status === "failed" ? (
                    upload.error
                  ) : (
                    `${upload.author ? `${surname(upload.author)} · ` : ""}${upload.pages} pages`
                  );
                return (
                  <BookRow
                    key={upload.id}
                    id={upload.id}
                    title={upload.title}
                    sub={sub}
                    tone={upload.status === "failed" ? "failed" : null}
                    checked={ready && isSelected(upload.id)}
                    disabled={!ready}
                    onToggle={onToggleBook}
                    action={
                      upload.status !== "processing" && (
                        <ConfirmDelete label={`Remove "${upload.title}"`} onConfirm={() => onDeleteUpload(upload)} />
                      )
                    }
                  />
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="btn btn--outline btn--block btn--sm"
            onClick={onUpload}
            disabled={uploadLimits && usedUploads >= uploadLimits.maxPerUser}
          >
            <UploadIcon size={15} /> Upload a PDF
          </button>
          <p className="sidebar__hint">
            Text-based PDFs only for now.{uploadLimits ? ` ${usedUploads}/${uploadLimits.maxPerUser} used.` : ""}
          </p>
        </section>
      </aside>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
    </>
  );
}
