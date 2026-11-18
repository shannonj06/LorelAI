/* Talks to the LorelAI API on the same origin (Vite proxies /api in development).

   Sessions: the access token lives only in memory. The refresh token is an httpOnly
   cookie this code never sees; the "X-LorelAI-Client: web" header tells the API to
   use it. An expired access token is refreshed once, transparently, and parallel
   requests share that one refresh. */

const CLIENT_HEADERS = { "X-LorelAI-Client": "web" };

let session = null; // {user, accessToken, expiresIn, ...}
let expiresAt = 0;
let refreshInFlight = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || body?.answer || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? null;
    this.details = body?.error?.details ?? null;
    this.body = body;
  }
}

/** Subscribe to sign-in / sign-out / refresh. Returns an unsubscribe function. */
export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A non-secret flag: "this browser has signed in before", so first-time visitors
// don't fire a refresh request that can only fail.
const SESSION_HINT = "lorelai.signedIn";

export function hasSessionHint() {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return true; // storage blocked: just try the refresh
  }
}

function setSession(next) {
  session = next;
  expiresAt = next ? Date.now() + next.expiresIn * 1000 : 0;
  try {
    if (next) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    /* storage unavailable: harmless */
  }
  listeners.forEach((listener) => listener(next));
}

export const sessionExpiresAt = () => expiresAt;

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function send(path, { method = "GET", body, headers = {}, auth = true, signal } = {}) {
  const init = { method, headers: { ...CLIENT_HEADERS, ...headers }, credentials: "same-origin", signal };
  if (body !== undefined) {
    if (body instanceof Blob) {
      init.body = body;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }
  if (auth && session?.accessToken) init.headers.Authorization = `Bearer ${session.accessToken}`;

  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, {
      error: { code: "network", message: "Can't reach LorelAI right now. Check your connection and try again." },
    });
  }
  return { response, data: parseJson(await response.text()) };
}

/** Exchange the refresh cookie for a new session. Resolves to the session, or null if signed out. */
export function refreshSession() {
  refreshInFlight ??= send("/api/auth/refresh", { method: "POST", body: {}, auth: false })
    .then(({ response, data }) => {
      setSession(response.ok ? data : null);
      return response.ok ? data : null;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** JSON request. Throws ApiError for non-2xx responses (the parsed body is on error.body). */
export async function api(path, options = {}) {
  let { response, data } = await send(path, options);
  const expired = ["token_expired", "invalid_token"].includes(data?.error?.code);
  if (response.status === 401 && options.auth !== false && session && expired) {
    if (await refreshSession()) ({ response, data } = await send(path, options));
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export const authApi = {
  async signIn(email, password) {
    const data = await api("/api/auth/signin", { method: "POST", body: { email, password }, auth: false });
    setSession(data);
    return data.user;
  },
  async signUp({ email, password, displayName }) {
    const body = { email, password, ...(displayName ? { displayName } : {}) };
    const data = await api("/api/auth/signup", { method: "POST", body, auth: false });
    setSession(data);
    return data.user;
  },
  async signOut() {
    try {
      await send("/api/auth/signout", { method: "POST", body: {}, auth: false });
    } finally {
      setSession(null);
    }
  },
};

/** Upload a PDF with progress (fetch can't report upload progress). Resolves to the upload record. */
export function uploadPdf(file, { title, author, year }, onProgress) {
  const params = new URLSearchParams({ title, filename: file.name });
  if (author) params.set("author", author);
  if (year) params.set("year", String(year));

  const attempt = () =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/uploads?${params}`);
      xhr.setRequestHeader("Content-Type", "application/pdf");
      xhr.setRequestHeader("X-LorelAI-Client", "web");
      if (session?.accessToken) xhr.setRequestHeader("Authorization", `Bearer ${session.accessToken}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        const data = parseJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.upload);
        else reject(new ApiError(xhr.status, data));
      };
      xhr.onerror = () =>
        reject(new ApiError(0, { error: { code: "network", message: "The upload was interrupted. Try again." } }));
      xhr.send(file);
    });

  return attempt().catch(async (error) => {
    if (error.status === 401 && (await refreshSession())) return attempt();
    throw error;
  });
}
