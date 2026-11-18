import { useEffect, useRef, useState } from "react";

import logo from "../assets/lorelai_logo_transparent.svg";
import { useAuth } from "../lib/auth";
import { Link, useRouter } from "../lib/router";
import { MenuIcon } from "./icons";

function initials(user) {
  const source = user.displayName || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/* Top bar for signed-in pages: logo home, section links, and the account menu. */
export default function WorkspaceBar({ onMenu }) {
  const { user, signOut } = useAuth();
  const { path, navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !menuRef.current?.contains(event.target) && setOpen(false);
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  return (
    <header className="workspace__bar">
      {onMenu && (
        <button type="button" className="icon-button workspace__menu" onClick={onMenu} aria-label="Open chats and books">
          <MenuIcon size={18} />
        </button>
      )}
      <Link to="/" className="workspace__logo" aria-label="LorelAI home">
        <img src={logo} alt="LorelAI" />
      </Link>
      <nav className="workspace__nav" aria-label="Sections">
        <Link to="/app" className={path.startsWith("/app") ? "is-active" : ""}>
          Ask
        </Link>
        {user.role === "admin" && (
          <Link to="/admin" className={path === "/admin" ? "is-active" : ""}>
            Admin
          </Link>
        )}
      </nav>
      <div className="account" ref={menuRef}>
        <button type="button" className="account__button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
          <span className="account__avatar">{initials(user)}</span>
          <span className="account__name">{user.displayName || user.email}</span>
        </button>
        {open && (
          <div className="account__menu" role="menu">
            <p className="account__email">{user.email}</p>
            {user.role === "admin" && <span className="beta-tag">admin</span>}
            <button
              type="button"
              role="menuitem"
              className="account__item"
              onClick={async () => {
                await signOut();
                navigate("/");
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
