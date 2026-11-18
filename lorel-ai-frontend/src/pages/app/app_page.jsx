import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SourcePanel from "../../components/source_panel";
import WorkspaceBar from "../../components/workspace_bar";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useRouter } from "../../lib/router";
import ChatPane from "./chat_pane";
import Sidebar from "./sidebar";
import UploadDialog from "./upload_dialog";

const EMPTY_CHAT = { id: null, title: null, turns: [] };
const EXCLUDED_KEY = "lorelai.excludedBooks";
let nextTurnId = 1;

/* Books are on unless the reader switched them off, so new uploads join automatically.
   The choice is a per-browser convenience; storage may be unavailable (private mode). */
function loadExcluded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function storeExcluded(set) {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...set]));
  } catch {
    /* not persisted; the selection still works for this visit */
  }
}

/** Saved chat messages -> turns (a question plus the answer shown for it). */
function turnsFromMessages(messages) {
  const turns = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ id: nextTurnId++, question: message.content, state: "pending" });
    } else if (turns.length) {
      const response = message.response ?? {
        status: "answered",
        answer: message.content,
        statements: [{ text: message.content, citationIds: [] }],
        conflicts: [],
        notCovered: [],
        citations: [],
      };
      turns[turns.length - 1] = { ...turns[turns.length - 1], state: "done", response };
    }
  }
  return turns.filter((turn) => turn.state === "done");
}

/** Turns -> messages to save (failed attempts are left out). */
const messagesFromTurns = (turns) =>
  turns
    .filter((turn) => turn.state === "done" && turn.response.status !== "error")
    .flatMap((turn) => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.response.answer, response: turn.response },
    ]);

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  return [toast, (message, tone = "info") => setToast({ message, tone, key: Date.now() })];
}

export default function AppPage() {
  const { status } = useAuth();
  const { path, navigate } = useRouter();
  const routeChatId = Number(path.match(/^\/app\/chats\/(\d+)$/)?.[1]) || null;
  const wide = useMediaQuery("(min-width: 1180px)");

  const [library, setLibrary] = useState([]);
  const [libraryState, setLibraryState] = useState("loading");
  const [uploads, setUploads] = useState([]);
  const [uploadLimits, setUploadLimits] = useState(null);
  const [excluded, setExcluded] = useState(loadExcluded);
  const [saved, setSaved] = useState([]);
  const [chat, setChat] = useState(EMPTY_CHAT);
  const [loadingChat, setLoadingChat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, showToast] = useToast();
  const composerRef = useRef(null);
  // The latest chat, for async handlers and effects that shouldn't re-run on every change.
  // Declared first so it's current before the effects below run.
  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
  });

  // Signed out (or the session expired): go to sign-in and come back here after
  useEffect(() => {
    if (status === "signedOut") navigate(`/try?mode=signin&next=${encodeURIComponent(path)}`, { replace: true });
  }, [status, path, navigate]);

  // The library; the pipeline may still be loading its model right after a restart
  useEffect(() => {
    if (status !== "signedIn") return undefined;
    let cancelled = false;
    let timer;
    const load = async () => {
      try {
        const data = await api("/api/books");
        if (!cancelled) {
          setLibrary(data.books);
          setLibraryState("ready");
        }
      } catch {
        if (!cancelled) {
          setLibraryState("starting");
          timer = setTimeout(load, 3000);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status]);

  // Apply a fresh uploads list, announcing books that just finished indexing
  const applyUploads = useCallback((data) => {
    setUploadLimits(data.limits);
    setUploads((previous) => {
      for (const upload of data.items) {
        const before = previous.find((p) => p.id === upload.id);
        if (before?.status === "processing" && upload.status === "ready") {
          showToast(`“${upload.title}” is ready: ${upload.pages} pages indexed.`, "success");
        }
        if (before?.status === "processing" && upload.status === "failed") {
          showToast(`“${upload.title}” couldn't be indexed.`, "error");
        }
      }
      return data.items;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUploads = useCallback(() => api("/api/uploads").then(applyUploads), [applyUploads]);
  const loadSaved = useCallback(() => api("/api/chats").then((data) => setSaved(data.items)), []);

  useEffect(() => {
    if (status !== "signedIn") return undefined;
    let cancelled = false;
    Promise.all([api("/api/uploads"), api("/api/chats")])
      .then(([uploadData, chatData]) => {
        if (cancelled) return;
        applyUploads(uploadData);
        setSaved(chatData.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, applyUploads]);

  // Poll while a book is being indexed
  const processing = uploads.some((u) => u.status === "processing");
  useEffect(() => {
    if (!processing) return undefined;
    const timer = setInterval(() => loadUploads().catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, [processing, loadUploads]);

  // Open the saved chat named in the URL
  useEffect(() => {
    if (status !== "signedIn" || !routeChatId || routeChatId === chatRef.current.id) return;
    let cancelled = false;
    setLoadingChat(true);
    setSource(null);
    api(`/api/chats/${routeChatId}`)
      .then((data) => {
        if (!cancelled) setChat({ id: data.chat.id, title: data.chat.title, turns: turnsFromMessages(data.messages) });
      })
      .catch(() => {
        if (!cancelled) {
          showToast("That chat isn't available.", "error");
          navigate("/app", { replace: true });
        }
      })
      .finally(() => !cancelled && setLoadingChat(false));
    return () => {
      cancelled = true;
    };
  }, [routeChatId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to /app from a saved chat (e.g. browser back): start fresh
  useEffect(() => {
    if (path === "/app" && chatRef.current.id) setChat(EMPTY_CHAT);
  }, [path]);

  const available = useMemo(
    () => [...library.map((b) => b.id), ...uploads.filter((u) => u.status === "ready").map((u) => u.id)],
    [library, uploads]
  );
  const selected = available.filter((id) => !excluded.has(id));
  const isSelected = (id) => !excluded.has(id);

  const setExcludedAndStore = (next) => {
    setExcluded(next);
    storeExcluded(next);
  };
  const toggleBook = (id) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedAndStore(next);
  };
  const setLibraryAll = (on) => {
    const next = new Set(excluded);
    for (const book of library) {
      if (on) next.delete(book.id);
      else next.add(book.id);
    }
    setExcludedAndStore(next);
  };

  const updateTurn = (id, patch) =>
    setChat((current) => ({ ...current, turns: current.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  async function ask(text) {
    const question = text.trim();
    if (!question) return;
    if (selected.length === 0) {
      showToast("Pick at least one book first.", "error");
      return;
    }
    const current = chatRef.current;
    const id = nextTurnId++;
    const history = current.turns
      .filter((t) => t.state === "done" && t.response.status !== "error")
      .slice(-3)
      .map((t) => t.question);
    const books = selected.length === available.length ? undefined : selected;
    setChat((c) => ({ ...c, turns: [...c.turns, { id, question, state: "pending" }] }));
    setSource(null);
    try {
      const response = await api("/api/ask", {
        method: "POST",
        body: { question, history, ...(books ? { books } : {}), ...(current.id ? { chatId: current.id } : {}) },
      });
      updateTurn(id, { state: "done", response, fresh: true });
      if (current.id) loadSaved().catch(() => {});
    } catch (error) {
      if (error.body?.status === "error") updateTurn(id, { state: "done", response: error.body, fresh: true });
      else updateTurn(id, { state: "failed", message: error.message });
    }
  }

  const retry = (turn) => {
    setChat((c) => ({ ...c, turns: c.turns.filter((t) => t.id !== turn.id) }));
    ask(turn.question);
  };

  async function setChatSaved(on) {
    setSaving(true);
    try {
      if (on) {
        const data = await api("/api/chats", { method: "POST", body: { messages: messagesFromTurns(chat.turns) } });
        setChat((c) => ({ ...c, id: data.chat.id, title: data.chat.title }));
        navigate(`/app/chats/${data.chat.id}`, { replace: true });
        showToast("Chat saved. New questions here are added to it.", "success");
      } else {
        await api(`/api/chats/${chat.id}`, { method: "DELETE" });
        setChat((c) => ({ ...c, id: null, title: null }));
        navigate("/app", { replace: true });
        showToast("Removed from saved chats. It will vanish when you leave.");
      }
      await loadSaved();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function renameChat(title) {
    try {
      await api(`/api/chats/${chat.id}`, { method: "PATCH", body: { title } });
      setChat((c) => ({ ...c, title }));
      await loadSaved();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteSavedChat(target) {
    try {
      await api(`/api/chats/${target.id}`, { method: "DELETE" });
      if (target.id === chat.id) {
        // Keep it on screen, now unsaved
        setChat((c) => ({ ...c, id: null, title: null }));
        navigate("/app", { replace: true });
      }
      await loadSaved();
      showToast(`Deleted “${target.title}”.`);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteUpload(upload) {
    try {
      await api(`/api/uploads/${upload.id}`, { method: "DELETE" });
      await loadUploads();
      showToast(`Removed “${upload.title}” and its passages.`);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function newChat() {
    setChat(EMPTY_CHAT);
    setSource(null);
    setSidebarOpen(false);
    navigate("/app");
    setTimeout(() => composerRef.current?.focus(), 50);
  }

  if (status !== "signedIn") {
    return (
      <div className="workspace workspace--loading">
        <span className="spinner" /> Loading your library…
      </div>
    );
  }

  return (
    <div className="workspace">
      <WorkspaceBar onMenu={() => setSidebarOpen(true)} />
      <div className={`workspace__grid${source && wide ? " has-source" : ""}`}>
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNewChat={newChat}
          saved={saved}
          activeChatId={chat.id}
          onDeleteChat={deleteSavedChat}
          library={library}
          libraryState={libraryState}
          uploads={uploads}
          uploadLimits={uploadLimits}
          isSelected={isSelected}
          onToggleBook={toggleBook}
          onSetLibrary={setLibraryAll}
          onUpload={() => setUploadOpen(true)}
          onDeleteUpload={deleteUpload}
        />
        <ChatPane
          chat={chat}
          loading={loadingChat}
          bookCount={available.length}
          selectedCount={selected.length}
          saving={saving}
          onSave={setChatSaved}
          onRename={renameChat}
          onAsk={ask}
          onRetry={retry}
          source={source}
          onCite={(turn, citation) => setSource({ turnId: turn.id, citation, citations: turn.response.citations })}
          composerRef={composerRef}
        />
        <SourcePanel
          variant={wide ? "docked" : "drawer"}
          citation={source?.citation}
          citations={source?.citations}
          onSelect={(citation) => setSource((s) => ({ ...s, citation }))}
          onClose={() => setSource(null)}
        />
      </div>

      {uploadOpen && (
        <UploadDialog
          limits={uploadLimits}
          onClose={() => setUploadOpen(false)}
          onUploaded={(upload) => {
            setUploadOpen(false);
            setUploads((list) => [upload, ...list]);
            showToast(`Indexing “${upload.title}”. You can keep asking meanwhile.`);
          }}
        />
      )}

      {toast && (
        <div key={toast.key} className={`toast toast--${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
