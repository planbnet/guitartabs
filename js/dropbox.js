// === Dropbox Integration (OAuth2 PKCE + HTTP API) ===

const DBX_APP_KEY = '1oe92pcj5nr35d9';

// --- PKCE Utilities ---

const dbxBase64UrlEncode = (bytes) => {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const dbxGenerateCodeVerifier = () => {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return dbxBase64UrlEncode(array);
};

const dbxGenerateCodeChallenge = async (verifier) => {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return dbxBase64UrlEncode(new Uint8Array(digest));
};

// --- Token Management ---

const dbxIsConnected = () => {
  return !!(localStorage.getItem('dbx_access_token') && localStorage.getItem('dbx_refresh_token'));
};

const dbxDisconnect = () => {
  localStorage.removeItem('dbx_access_token');
  localStorage.removeItem('dbx_refresh_token');
  localStorage.removeItem('dbx_token_expiry');
  localStorage.removeItem('dbx_current_file');
  localStorage.removeItem('dbx_pkce_verifier');
  // Keep dbx_folder_path so reconnecting remembers the folder
};

const dbxRefreshToken = async () => {
  const refreshToken = localStorage.getItem('dbx_refresh_token');
  if (!refreshToken) return false;

  try {
    const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: DBX_APP_KEY
      })
    });

    if (!resp.ok) return false;

    const data = await resp.json();
    localStorage.setItem('dbx_access_token', data.access_token);
    localStorage.setItem('dbx_token_expiry', String(Date.now() + data.expires_in * 1000));
    return true;
  } catch {
    return false;
  }
};

const dbxGetToken = async () => {
  const expiry = parseInt(localStorage.getItem('dbx_token_expiry') || '0', 10);
  if (Date.now() > expiry - 300000) {
    const ok = await dbxRefreshToken();
    if (!ok) {
      dbxDisconnect();
      throw new Error('Session expired. Please reconnect to Dropbox.');
    }
  }
  return localStorage.getItem('dbx_access_token');
};

const dbxEncodeApiArg = (arg) => {
  // Keep header ASCII-safe so filenames like "Für ..." work in Dropbox-API-Arg.
  return JSON.stringify(arg).replace(/[\u0080-\uFFFF]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
};

// Authenticated fetch wrapper with auto-refresh
const dbxFetch = async (url, options = {}) => {
  const token = await dbxGetToken();
  options.headers = options.headers || {};
  options.headers['Authorization'] = 'Bearer ' + token;

  let resp = await fetch(url, options);

  if (resp.status === 401) {
    const ok = await dbxRefreshToken();
    if (ok) {
      options.headers['Authorization'] = 'Bearer ' + localStorage.getItem('dbx_access_token');
      resp = await fetch(url, options);
    } else {
      dbxDisconnect();
      throw new Error('Authentication failed. Please reconnect to Dropbox.');
    }
  }

  return resp;
};

// --- OAuth2 PKCE Flow ---

const dbxStartAuth = async () => {
  const verifier = dbxGenerateCodeVerifier();
  localStorage.setItem('dbx_pkce_verifier', verifier);

  const challenge = await dbxGenerateCodeChallenge(verifier);
  const redirectUri = window.location.origin + window.location.pathname;

  const params = new URLSearchParams({
    client_id: DBX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri
  });

  window.location.href = 'https://www.dropbox.com/oauth2/authorize?' + params.toString();
};

const dbxHandleRedirect = async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;

  const verifier = localStorage.getItem('dbx_pkce_verifier');
  if (!verifier) return false;

  const redirectUri = window.location.origin + window.location.pathname;

  try {
    const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        client_id: DBX_APP_KEY,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    });

    if (!resp.ok) {
      console.error('Dropbox token exchange failed:', resp.status);
      alert('Failed to connect to Dropbox. Please try again.');
      return false;
    }

    const data = await resp.json();
    localStorage.setItem('dbx_access_token', data.access_token);
    localStorage.setItem('dbx_refresh_token', data.refresh_token);
    localStorage.setItem('dbx_token_expiry', String(Date.now() + data.expires_in * 1000));
    localStorage.removeItem('dbx_pkce_verifier');
  } catch (err) {
    console.error('Dropbox auth error:', err);
    alert('Failed to connect to Dropbox. Please try again.');
    return false;
  }

  // Clean URL
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('code');
  window.history.replaceState({}, '', cleanUrl.toString());

  return true;
};

// --- Dropbox API Calls ---

const dbxListFolder = async (path) => {
  const resp = await dbxFetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: path || '',
      recursive: false,
      include_deleted: false
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_summary || 'Failed to list folder');
  }

  const data = await resp.json();
  let entries = data.entries;

  // Handle pagination
  let cursor = data.cursor;
  while (data.has_more) {
    const more = await dbxFetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor })
    });
    if (!more.ok) break;
    const moreData = await more.json();
    entries = entries.concat(moreData.entries);
    cursor = moreData.cursor;
    if (!moreData.has_more) break;
  }

  return entries;
};

const dbxDownloadFile = async (path) => {
  const normalizedPath = (path || '').normalize('NFC');
  const resp = await dbxFetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Dropbox-API-Arg': dbxEncodeApiArg({ path: normalizedPath })
    }
  });

  if (!resp.ok) {
    throw new Error('Failed to download file');
  }

  return resp.text();
};

const dbxUploadFile = async (path, content) => {
  const normalizedPath = (path || '').normalize('NFC');
  const resp = await dbxFetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': dbxEncodeApiArg({
        path: normalizedPath,
        mode: 'overwrite',
        autorename: false,
        mute: false
      })
    },
    body: content
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_summary || 'Failed to upload file');
  }

  return resp.json();
};

// --- High-Level Actions ---

const dbxOpenFile = async (path) => {
  try {
    const content = await dbxDownloadFile(path);
    parseImportedContent(content);
    localStorage.setItem('dbx_current_file', path);
    render();
    save();
    if (typeof dbxSyncSettingsUI === 'function') dbxSyncSettingsUI();
  } catch (err) {
    console.error('Failed to open file:', err);
    alert('Failed to open file: ' + err.message);
  }
};

const dbxClearCurrentFile = () => {
  localStorage.removeItem('dbx_current_file');
  if (typeof dbxSyncSettingsUI === 'function') dbxSyncSettingsUI();
};

const dbxHasMeaningfulContent = () => {
  return blocks.some((block) => {
    if (block.type === 'text') {
      return (block.data || '').trim() !== '';
    }
    if (isTabBlock(block)) {
      return block.data.some((row) =>
        row.some((char) => char !== '-' && char !== '|' && char !== ' ')
      );
    }
    return false;
  });
};

const dbxSaveFile = async () => {
  const content = formatContentForExport();
  const currentFile = localStorage.getItem('dbx_current_file');

  if (currentFile && dbxHasMeaningfulContent()) {
    // Auto-overwrite existing file
    try {
      await dbxUploadFile(currentFile, content);
      const filename = currentFile.split('/').pop();
      dbxShowToast('Saved ' + filename);
    } catch (err) {
      console.error('Failed to save:', err);
      alert('Failed to save: ' + err.message);
    }
  } else {
    if (currentFile) dbxClearCurrentFile();
    // Show filename prompt
    dbxShowSaveModal(content);
  }
};

const dbxShowToast = (message) => {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);' +
    'background:#171a21;color:#7ee787;border:1px solid #2a2f3a;border-radius:8px;' +
    'padding:.5rem 1rem;font:600 13px/1 ui-monospace,monospace;z-index:9999;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.4);';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
};

// --- Modal Rendering Helpers ---

// Render file list for the Open modal
const dbxRenderOpenList = async (path) => {
  const list = document.getElementById('dbx-open-list');
  const pathDisplay = document.getElementById('dbx-open-path');
  const loading = document.getElementById('dbx-open-loading');
  const errorEl = document.getElementById('dbx-open-error');

  list.innerHTML = '';
  errorEl.style.display = 'none';
  loading.style.display = 'block';
  pathDisplay.textContent = path || '/';

  // Store current browse path on the modal
  document.getElementById('dbx-open-modal')._browsePath = path;

  try {
    const entries = await dbxListFolder(path);

    // Sort: folders first, then .txt files, alphabetically
    const folders = entries
      .filter(e => e['.tag'] === 'folder')
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = entries
      .filter(e => e['.tag'] === 'file' && e.name.toLowerCase().endsWith('.txt'))
      .sort((a, b) => a.name.localeCompare(b.name));

    loading.style.display = 'none';

    // Parent directory entry
    if (path && path !== '') {
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '';
      const item = document.createElement('div');
      item.className = 'dbx-file-item folder dbx-parent-item';
      item.innerHTML = '<span class="dbx-icon">..</span><span>Parent folder</span>';
      item.addEventListener('click', () => dbxRenderOpenList(parentPath));
      list.appendChild(item);
    }

    folders.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'dbx-file-item folder';
      item.innerHTML = `<span class="dbx-icon">\u{1F4C1}</span><span>${entry.name}</span>`;
      item.addEventListener('click', () => dbxRenderOpenList(entry.path_display));
      list.appendChild(item);
    });

    files.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'dbx-file-item';
      item.innerHTML = `<span class="dbx-icon">\u{1F3B5}</span><span>${entry.name}</span>`;
      item.addEventListener('click', async () => {
        await dbxOpenFile(entry.path_display);
        document.getElementById('dbx-open-modal').style.display = 'none';
        focusKeyboard();
      });
      list.appendChild(item);
    });

    if (folders.length === 0 && files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dbx-loading';
      empty.textContent = 'No folders or .txt files found';
      list.appendChild(empty);
    }
  } catch (err) {
    loading.style.display = 'none';
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
};

const dbxShowOpenModal = () => {
  if (!dbxIsConnected()) {
    alert('Please connect to Dropbox first (Settings > Dropbox).');
    return;
  }

  const folderPath = localStorage.getItem('dbx_folder_path');
  if (!folderPath && folderPath !== '') {
    // No folder set — show folder browser first
    dbxShowFolderBrowser('');
    return;
  }

  const modal = document.getElementById('dbx-open-modal');
  modal.style.display = 'flex';
  dbxRenderOpenList(folderPath);
};

// Render folder list for folder browser
const dbxRenderFolderList = async (path) => {
  const list = document.getElementById('dbx-folder-list');
  const pathDisplay = document.getElementById('dbx-folder-path');
  const loading = document.getElementById('dbx-folder-loading');
  const errorEl = document.getElementById('dbx-folder-error');

  list.innerHTML = '';
  errorEl.style.display = 'none';
  loading.style.display = 'block';
  pathDisplay.textContent = path || '/ (root)';

  // Store current browse path on the modal
  document.getElementById('dbx-folder-modal')._browsePath = path;

  try {
    const entries = await dbxListFolder(path);

    const folders = entries
      .filter(e => e['.tag'] === 'folder')
      .sort((a, b) => a.name.localeCompare(b.name));

    loading.style.display = 'none';

    // Parent directory entry
    if (path && path !== '') {
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '';
      const item = document.createElement('div');
      item.className = 'dbx-file-item folder dbx-parent-item';
      item.innerHTML = '<span class="dbx-icon">..</span><span>Parent folder</span>';
      item.addEventListener('click', () => dbxRenderFolderList(parentPath));
      list.appendChild(item);
    }

    folders.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'dbx-file-item folder';
      item.innerHTML = `<span class="dbx-icon">\u{1F4C1}</span><span>${entry.name}</span>`;
      item.addEventListener('click', () => dbxRenderFolderList(entry.path_display));
      list.appendChild(item);
    });

    if (folders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dbx-loading';
      empty.textContent = 'No subfolders';
      list.appendChild(empty);
    }
  } catch (err) {
    loading.style.display = 'none';
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
};

const dbxShowFolderBrowser = (startPath) => {
  const modal = document.getElementById('dbx-folder-modal');
  modal.style.display = 'flex';
  dbxRenderFolderList(startPath || '');
};

const dbxShowSaveModal = (content) => {
  const modal = document.getElementById('dbx-save-modal');
  const input = document.getElementById('dbx-save-filename');
  const errorEl = document.getElementById('dbx-save-error');

  errorEl.style.display = 'none';

  // Pre-fill filename from title
  const title = extractTitle(content);
  input.value = title ? sanitizeFilename(title) + '.txt' : 'guitar-tab.txt';

  modal.style.display = 'flex';
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
};
