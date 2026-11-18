import { useCallback, useEffect, useState } from "react";

import WorkspaceBar from "../components/workspace_bar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRouter } from "../lib/router";
import { modelName, plural, relativeTime } from "../lib/text";

const percent = (value) => `${Math.round((value ?? 0) * 100)}%`;
const number = (value) => (value ?? 0).toLocaleString();

function Stat({ value, label, detail }) {
  return (
    <li className="guarantee">
      <span className="guarantee__stat">{value}</span>
      <span className="guarantee__label">{label}</span>
      {detail && <p className="guarantee__detail">{detail}</p>}
    </li>
  );
}

export default function AdminPage() {
  const { status, user } = useAuth();
  const { navigate } = useRouter();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState({ items: [], total: 0 });
  const [activity, setActivity] = useState({ items: [] });
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status === "signedOut") navigate("/try?mode=signin&next=/admin", { replace: true });
    if (status === "signedIn" && user.role !== "admin") navigate("/app", { replace: true });
  }, [status, user, navigate]);

  const fetchAll = useCallback(() => {
    const query = search ? `&search=${encodeURIComponent(search)}` : "";
    return Promise.all([
      api("/api/admin/stats"),
      api(`/api/admin/users?limit=50${query}`),
      api("/api/admin/activity?limit=25"),
    ]);
  }, [search]);

  const apply = ([s, u, a]) => {
    setStats(s);
    setUsers(u);
    setActivity(a);
    setError(null);
  };
  const load = () => fetchAll().then(apply, (caught) => setError(caught.message));

  useEffect(() => {
    if (status !== "signedIn" || user.role !== "admin") return undefined;
    let cancelled = false;
    fetchAll().then(
      (results) => !cancelled && apply(results),
      (caught) => !cancelled && setError(caught.message)
    );
    return () => {
      cancelled = true;
    };
  }, [status, user, fetchAll]);

  async function update(target, changes) {
    try {
      await api(`/api/admin/users/${target.id}`, { method: "PATCH", body: changes });
      await load();
    } catch (caught) {
      setError(caught.message);
    }
  }

  if (status !== "signedIn" || user.role !== "admin") {
    return (
      <div className="workspace workspace--loading">
        <span className="spinner" /> Checking access…
      </div>
    );
  }

  const q = stats?.questions;
  const llm = stats?.pipeline?.llm;
  return (
    <div className="workspace workspace--page">
      <WorkspaceBar />
      <main className="admin">
        <header className="admin__head">
          <p className="small-heading">admin</p>
          <h1 className="big_heading">How LorelAI is being used.</h1>
          <p className="section-lede">
            Usage without content: unsaved chats are never stored, and saved chats stay private to their owner.
          </p>
        </header>

        {error && <p className="form__error">{error}</p>}

        {stats && (
          <>
            <ul className="guarantee-grid admin__stats">
              <Stat value={number(q.total)} label="questions asked" detail={`${number(q.last24h)} in the last 24 hours · ${number(q.byChannel.trial)} from the landing-page demo`} />
              <Stat value={percent(1 - q.errorRate)} label="answered without error" detail={`${number(q.byStatus.answered + q.byStatus.partial)} cited answers · ${number(q.byStatus.insufficient)} not in the books`} />
              <Stat value={q.avgAnswerLatencyMs ? `${(q.avgAnswerLatencyMs / 1000).toFixed(1)}s` : "–"} label="average answer time" detail={`${percent(q.cacheHitRate)} served instantly from cache`} />
              <Stat value={number(stats.users.total)} label="accounts" detail={`${plural(stats.savedChats.chats, "saved chat")} · ${plural(stats.uploads.byStatus.ready, "uploaded book")}`} />
            </ul>

            <section className="admin__panel">
              <div className="admin__panel-head">
                <h2>Answer engine</h2>
                <span className={`status-pill is-${stats.pipeline.state}`}>{stats.pipeline.state}</span>
              </div>
              <dl className="admin__facts">
                <div>
                  <dt>Model</dt>
                  <dd>{llm ? `${modelName(llm.model)} via ${llm.provider}` : "–"}</dd>
                </div>
                <div>
                  <dt>Fallbacks</dt>
                  <dd>{llm?.fallbacks?.length ? llm.fallbacks.map(modelName).join(", ") : "none"}</dd>
                </div>
                <div>
                  <dt>API key</dt>
                  <dd>{llm ? (llm.keySet ? "configured" : "missing") : "–"}</dd>
                </div>
                <div>
                  <dt>Library</dt>
                  <dd>
                    {number(stats.pipeline.books)} books · {number(stats.pipeline.chunks)} passages
                  </dd>
                </div>
                <div>
                  <dt>Tokens used</dt>
                  <dd>
                    {number(q.tokens.input)} in · {number(q.tokens.output)} out
                  </dd>
                </div>
                <div>
                  <dt>Errors</dt>
                  <dd>
                    {Object.entries(q.errorsByCode).map(([code, n]) => `${code} ${n}`).join(" · ") || "none"}
                  </dd>
                </div>
              </dl>
            </section>
          </>
        )}

        <section className="admin__panel">
          <div className="admin__panel-head">
            <h2>Accounts</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                load();
              }}
            >
              <input className="admin__search" placeholder="Search email or name" value={search} onChange={(e) => setSearch(e.target.value)} />
            </form>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.items.map((row) => {
                  const self = row.id === user.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.displayName || row.email}</strong>
                        {row.displayName && <span className="table__sub">{row.email}</span>}
                      </td>
                      <td>{row.role}</td>
                      <td>
                        <span className={`status-pill is-${row.isActive ? "ready" : "disabled"}`}>{row.isActive ? "active" : "disabled"}</span>
                      </td>
                      <td>{relativeTime(row.createdAt)}</td>
                      <td>{row.lastLoginAt ? relativeTime(row.lastLoginAt) : "–"}</td>
                      <td className="table__actions">
                        {!self && (
                          <>
                            <button type="button" className="text-button text-button--small" onClick={() => update(row, { role: row.role === "admin" ? "user" : "admin" })}>
                              {row.role === "admin" ? "make user" : "make admin"}
                            </button>
                            <button type="button" className="text-button text-button--small" onClick={() => update(row, { isActive: !row.isActive })}>
                              {row.isActive ? "disable" : "enable"}
                            </button>
                          </>
                        )}
                        {self && <span className="table__sub">you</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin__panel">
          <div className="admin__panel-head">
            <h2>Recent questions</h2>
            <span className="table__sub">outcome only, never the text</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Outcome</th>
                  <th>Citations</th>
                  <th>Model</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {activity.items.map((event) => (
                  <tr key={event.id}>
                    <td>{relativeTime(event.createdAt)}</td>
                    <td>{event.channel === "trial" ? "demo visitor" : event.userEmail ?? "deleted account"}</td>
                    <td>
                      <span className={`status-pill is-${event.status}`}>{event.errorCode ?? event.status}</span>
                    </td>
                    <td>
                      {event.citations} from {event.booksCited} {event.booksCited === 1 ? "book" : "books"}
                    </td>
                    <td>{event.cached ? "cache" : modelName(event.model) ?? "–"}</td>
                    <td>{(event.latencyMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
                {activity.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      No questions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
