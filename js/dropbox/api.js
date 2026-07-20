// Dropbox HTTP API + OAuth2 PKCE flow. No DOM access; callers handle UI.
//
// Tokens and the chosen folder live in localStorage under dbx_* keys
// (stable — existing connections must survive updates).

const APP_KEY = "1oe92pcj5nr35d9";

// --- PKCE ---

const base64UrlEncode = (bytes) => {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const generateCodeVerifier = () => {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
};

const generateCodeChallenge = async (verifier) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
};

// --- Tokens ---

export const isConnected = () =>
  !!(localStorage.getItem("dbx_access_token") && localStorage.getItem("dbx_refresh_token"));

export const disconnect = () => {
  localStorage.removeItem("dbx_access_token");
  localStorage.removeItem("dbx_refresh_token");
  localStorage.removeItem("dbx_token_expiry");
  localStorage.removeItem("dbx_current_file");
  localStorage.removeItem("dbx_pkce_verifier");
  // dbx_folder_path is kept so reconnecting remembers the folder.
};

const refreshToken = async () => {
  const token = localStorage.getItem("dbx_refresh_token");
  if (!token) return false;
  try {
    const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token,
        client_id: APP_KEY,
      }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    localStorage.setItem("dbx_access_token", data.access_token);
    localStorage.setItem("dbx_token_expiry", String(Date.now() + data.expires_in * 1000));
    return true;
  } catch {
    return false;
  }
};

const getToken = async () => {
  const expiry = parseInt(localStorage.getItem("dbx_token_expiry") || "0", 10);
  if (Date.now() > expiry - 300000) {
    const ok = await refreshToken();
    if (!ok) {
      disconnect();
      throw new Error("Session expired. Please reconnect to Dropbox.");
    }
  }
  return localStorage.getItem("dbx_access_token");
};

// Keep the Dropbox-API-Arg header ASCII-safe (filenames like "Für ...").
const encodeApiArg = (arg) =>
  JSON.stringify(arg).replace(/[\u0080-\uFFFF]/g, (ch) =>
    "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );

const dbxFetch = async (url, options = {}) => {
  const token = await getToken();
  options.headers = options.headers || {};
  options.headers["Authorization"] = `Bearer ${token}`;

  let resp = await fetch(url, options);

  if (resp.status === 401) {
    const ok = await refreshToken();
    if (!ok) {
      disconnect();
      throw new Error("Authentication failed. Please reconnect to Dropbox.");
    }
    options.headers["Authorization"] = `Bearer ${localStorage.getItem("dbx_access_token")}`;
    resp = await fetch(url, options);
  }

  return resp;
};

// --- OAuth flow ---

export const startAuth = async () => {
  const verifier = generateCodeVerifier();
  localStorage.setItem("dbx_pkce_verifier", verifier);

  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = window.location.origin + window.location.pathname;

  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: redirectUri,
  });

  window.location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
};

// Handles the ?code= redirect. Returns true when a connection was made;
// throws when the exchange fails.
export const handleRedirect = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;

  const verifier = localStorage.getItem("dbx_pkce_verifier");
  if (!verifier) return false;

  const redirectUri = window.location.origin + window.location.pathname;

  const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: APP_KEY,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Dropbox token exchange failed (${resp.status})`);
  }

  const data = await resp.json();
  localStorage.setItem("dbx_access_token", data.access_token);
  localStorage.setItem("dbx_refresh_token", data.refresh_token);
  localStorage.setItem("dbx_token_expiry", String(Date.now() + data.expires_in * 1000));
  localStorage.removeItem("dbx_pkce_verifier");

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("code");
  window.history.replaceState({}, "", cleanUrl.toString());

  return true;
};

// --- Files ---

export const listFolder = async (path) => {
  const resp = await dbxFetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: path || "", recursive: false, include_deleted: false }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_summary || "Failed to list folder");
  }

  const data = await resp.json();
  let entries = data.entries;

  let cursor = data.cursor;
  let hasMore = data.has_more;
  while (hasMore) {
    const more = await dbxFetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cursor }),
    });
    if (!more.ok) break;
    const moreData = await more.json();
    entries = entries.concat(moreData.entries);
    cursor = moreData.cursor;
    hasMore = moreData.has_more;
  }

  return entries;
};

export const downloadFile = async (path) => {
  const resp = await dbxFetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { "Dropbox-API-Arg": encodeApiArg({ path: (path || "").normalize("NFC") }) },
  });
  if (!resp.ok) throw new Error("Failed to download file");
  return resp.text();
};

export const uploadFile = async (path, content) => {
  const resp = await dbxFetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": encodeApiArg({
        path: (path || "").normalize("NFC"),
        mode: "overwrite",
        autorename: false,
        mute: false,
      }),
    },
    body: content,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_summary || "Failed to upload file");
  }
  return resp.json();
};

// --- Current file / folder bookkeeping ---

export const getCurrentFile = () => localStorage.getItem("dbx_current_file");
export const setCurrentFile = (path) => localStorage.setItem("dbx_current_file", path);
export const clearCurrentFile = () => localStorage.removeItem("dbx_current_file");

export const getFolderPath = () => localStorage.getItem("dbx_folder_path");
export const setFolderPath = (path) => localStorage.setItem("dbx_folder_path", path);
export const clearFolderPath = () => localStorage.removeItem("dbx_folder_path");
