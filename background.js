const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const LOCK_URL = () => chrome.runtime.getURL('lock.html');

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, key, 256));
}
const getCfg = () => chrome.storage.local.get({ hash: null, salt: null, autoLockMinutes: 0 });
const sess = (k) => chrome.storage.session.get(k);
async function isLocked() { return (await sess({ locked: false })).locked; }
async function checkPassword(pw) {
  const { hash, salt } = await getCfg();
  return !!hash && (await derive(pw, unb64(salt))) === hash;
}

/* ---------- Lock window handling ---------- */
let lockCreating = null;

function ensureLockWindow() {
  if (lockCreating) return lockCreating;
  lockCreating = (async () => {
    const { lockWinId } = await sess('lockWinId');
    if (lockWinId != null) {
      try { await chrome.windows.update(lockWinId, { focused: true, state: 'maximized' }); return lockWinId; }
      catch { /* window is gone, create a new one */ }
    }
    const w = await chrome.windows.create({ url: LOCK_URL(), type: 'popup', state: 'maximized', focused: true });
    await chrome.storage.session.set({ lockWinId: w.id });
    return w.id;
  })().finally(() => { lockCreating = null; });
  return lockCreating;
}

async function hideWindow(w) {
  const { prev = {} } = await sess('prev');
  if (w.state !== 'minimized') prev[w.id] = w.state || 'normal';
  await chrome.storage.session.set({ prev });
  chrome.windows.update(w.id, { state: 'minimized' }).catch(() => {});
}

async function lockUI() {
  await ensureLockWindow();
  const { lockWinId } = await sess('lockWinId');
  for (const w of await chrome.windows.getAll()) if (w.id !== lockWinId) await hideWindow(w);
}

async function setLocked(locked) {
  await chrome.storage.session.set({ locked });
  chrome.action.setBadgeText({ text: locked ? '🔒' : '' });
  if (locked) return lockUI();
  const { lockWinId, prev = {} } = await sess(['lockWinId', 'prev']);
  await chrome.storage.session.remove(['lockWinId', 'prev']);
  for (const [id, state] of Object.entries(prev))
    chrome.windows.update(Number(id), { state: state === 'minimized' ? 'normal' : state }).catch(() => {});
  if (lockWinId != null) chrome.windows.remove(lockWinId).catch(() => {});
}

chrome.windows.onCreated.addListener(async (w) => {
  if (!(await isLocked())) return;
  if (lockCreating) await lockCreating;
  const { lockWinId } = await sess('lockWinId');
  if (w.id === lockWinId) return;
  await hideWindow(w);
  ensureLockWindow();
});
chrome.windows.onRemoved.addListener(async (id) => {
  const { lockWinId } = await sess('lockWinId');
  if (await isLocked()) {
    // Closing the lock window = closing the app: close everything, stay locked.
    if (id === lockWinId) {
      await chrome.storage.session.remove('lockWinId');
      for (const w of await chrome.windows.getAll()) chrome.windows.remove(w.id).catch(() => {});
    }
    return;
  }
  // Unlocked and the last window was closed: lock again so the next open asks for the password.
  const { hash } = await getCfg();
  if (hash && (await chrome.windows.getAll()).length === 0) {
    await chrome.storage.session.set({ locked: true });
    chrome.action.setBadgeText({ text: '🔒' });
  }
});
chrome.windows.onFocusChanged.addListener(async (id) => {
  if (id === chrome.windows.WINDOW_ID_NONE || !(await isLocked())) return;
  const { lockWinId } = await sess('lockWinId');
  if (id !== lockWinId) {
    try { await hideWindow(await chrome.windows.get(id)); } catch {}
    ensureLockWindow();
  }
});

/* ---------- Brute-force throttle ---------- */
async function throttled() {
  const { until = 0 } = await sess('until');
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
async function recordFail() {
  const { fails = 0 } = await sess('fails');
  const n = fails + 1, u = { fails: n };
  if (n >= 5) u.until = Date.now() + Math.min(300, 15 * 2 ** (n - 5)) * 1000;
  await chrome.storage.session.set(u);
}

/* ---------- Idle + startup ---------- */
async function applyIdle() {
  const { autoLockMinutes, hash } = await getCfg();
  if (hash && autoLockMinutes > 0) chrome.idle.setDetectionInterval(Math.max(15, autoLockMinutes * 60));
}
chrome.idle.onStateChanged.addListener(async (state) => {
  const { autoLockMinutes, hash } = await getCfg();
  if (hash && autoLockMinutes > 0 && state !== 'active') setLocked(true);
});
chrome.runtime.onStartup.addListener(async () => {
  const { hash } = await getCfg();
  if (hash) setLocked(true);
});

/* ---------- Messages ---------- */
async function handle(msg) {
  const cfg = await getCfg();
  switch (msg.type) {
    case 'getState':
      return { locked: await isLocked(), hasPassword: !!cfg.hash,
               autoLockMinutes: cfg.autoLockMinutes };
    case 'lock':
      if (!cfg.hash) return { ok: false, error: 'Set a password first.' };
      await setLocked(true); return { ok: true };
    case 'unlock': {
      const wait = await throttled();
      if (wait) return { ok: false, error: `Too many attempts. Try again in ${wait}s.` };
      if (await checkPassword(msg.password)) {
        await chrome.storage.session.set({ fails: 0, until: 0 });
        await setLocked(false); return { ok: true };
      }
      await recordFail();
      return { ok: false, error: 'Incorrect password.' };
    }
    case 'setPassword': {
      if (await isLocked()) return { ok: false, error: 'Browser is locked.' };
      if (cfg.hash && !(await checkPassword(msg.current || ''))) return { ok: false, error: 'Current password is incorrect.' };
      if (!msg.password || msg.password.length < 4) return { ok: false, error: 'Use at least 4 characters.' };
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await chrome.storage.local.set({ salt: b64(salt), hash: await derive(msg.password, salt) });
      await applyIdle(); return { ok: true };
    }
    case 'saveSettings':
      if (await isLocked()) return { ok: false, error: 'Browser is locked.' };
      await chrome.storage.local.set({
        autoLockMinutes: Math.max(0, Math.min(1440, Number(msg.autoLockMinutes) || 0)) });
      await applyIdle(); return { ok: true };
    case 'removePassword':
      if (!(await checkPassword(msg.current || ''))) return { ok: false, error: 'Incorrect password.' };
      await chrome.storage.local.remove(['hash', 'salt']);
      await setLocked(false); return { ok: true };
  }
  return { ok: false };
}
chrome.runtime.onMessage.addListener((msg, _s, send) => { handle(msg).then(send); return true; });

applyIdle();
isLocked().then((l) => chrome.action.setBadgeText({ text: l ? '🔒' : '' }));
