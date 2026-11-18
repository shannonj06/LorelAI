import { useEffect, useRef, useState } from "react";

import { CloseIcon, UploadIcon } from "../../components/icons";
import { uploadPdf } from "../../lib/api";
import { formatBytes, titleFromFilename } from "../../lib/text";

/* Add a book from a PDF. Work in progress: only PDFs with a text layer can be read
   (born-digital books, exported documents); scanned books need OCR, which comes later. */
export default function UploadDialog({ limits, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState({ title: "", author: "", year: "" });
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const maxBytes = limits?.maxBytes ?? 25 * 1024 * 1024;

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && progress === null && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, progress]);

  function pick(candidate) {
    setError(null);
    if (!candidate) return;
    if (candidate.type !== "application/pdf" && !/\.pdf$/i.test(candidate.name)) {
      setError("That isn't a PDF. Choose a .pdf file.");
      return;
    }
    if (candidate.size > maxBytes) {
      setError(`That file is ${formatBytes(candidate.size)}; the limit is ${formatBytes(maxBytes)}.`);
      return;
    }
    setFile(candidate);
    setMeta((m) => ({ ...m, title: m.title || titleFromFilename(candidate.name) }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!file || !meta.title.trim()) return;
    setError(null);
    setProgress(0);
    try {
      const upload = await uploadPdf(
        file,
        { title: meta.title.trim(), author: meta.author.trim(), year: meta.year ? Number(meta.year) : undefined },
        setProgress
      );
      onUploaded(upload);
    } catch (caught) {
      setError(caught.details?.[0]?.message ?? caught.message);
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title" ref={dialogRef} tabIndex={-1} onSubmit={submit}>
        <header className="dialog__head">
          <div>
            <p className="dialog__eyebrow">your books · beta</p>
            <h2 id="upload-title" className="dialog__title">
              Add a book
            </h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </header>

        <div
          className={`dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files?.[0]);
          }}
          onClick={() => !busy && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            onChange={(event) => pick(event.target.files?.[0])}
            tabIndex={-1}
          />
          <UploadIcon size={22} />
          {file ? (
            <p>
              <strong>{file.name}</strong>
              <span>{formatBytes(file.size)} · click to choose a different file</span>
            </p>
          ) : (
            <p>
              <strong>Drop a PDF here, or browse</strong>
              <span>Up to {formatBytes(maxBytes)}</span>
            </p>
          )}
        </div>

        <div className="form form--grid">
          <label className="field field--wide">
            <span className="field__label">Title</span>
            <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} maxLength={200} required disabled={busy} />
          </label>
          <label className="field">
            <span className="field__label">
              Author <em>optional</em>
            </span>
            <input value={meta.author} onChange={(e) => setMeta({ ...meta, author: e.target.value })} maxLength={120} disabled={busy} />
          </label>
          <label className="field">
            <span className="field__label">
              Year <em>optional</em>
            </span>
            <input value={meta.year} onChange={(e) => setMeta({ ...meta, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" disabled={busy} />
          </label>
        </div>

        <div className="dialog__note">
          <strong>Work in progress.</strong> Only text-based PDFs can be read today (ebooks, exported documents). Scanned
          books are page images and need OCR, which is on the roadmap. Your book is private to your account, and the PDF
          file is deleted once its text is indexed.
        </div>

        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <div className="progress" aria-label="Upload progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        <footer className="dialog__foot">
          <button type="button" className="text-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!file || !meta.title.trim() || busy}>
            {busy ? (progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Starting…") : "Upload and index"}
          </button>
        </footer>
      </form>
    </div>
  );
}
