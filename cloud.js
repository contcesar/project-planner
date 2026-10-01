'use strict';

/* ============================================================
   Cloud sync with Supabase.

   How it works:
   - The board always reads and writes the local copy first, so the
     app is fast and works offline.
   - Each change is added to an outbox. The outbox is sent to
     Supabase in the background and retried until it succeeds.
   - The full board is pulled from Supabase on sign-in, when the app
     comes back to the foreground, and when another device changes
     something (Supabase Realtime).

   Uses `state`, `save`, `render`, `normalize`, `emptyState`, `sync`
   and `drag` from app.js.
   ============================================================ */

(() => {
  const config = window.PLANNER_CONFIG || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) return;

  const OUTBOX_KEY = 'planner.outbox';
  const OWNER_KEY = 'planner.owner';
  const RETRY_MS = 15000;

  const db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const $ = sel => document.querySelector(sel);
  const authScreen = $('#authScreen');
  const authForm = $('#authForm');
  const authMessage = $('#authMessage');
  const statusEl = $('#syncStatus');

  authForm.querySelector('[data-mode=signup]').hidden = !config.allowSignup;

  let user = null;
  let channel = null;
  let flushing = false;
  let flushTimer = null;
  let pullTimer = null;
  let retryTimer = null;

  /* ---------- Outbox ---------- */
  // Map of "table:id" → "upsert" | "delete". Later changes replace earlier ones.

  let outbox = loadOutbox();

  function loadOutbox() {
    try {
      return new Map(JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'));
    } catch {
      return new Map();
    }
  }

  function saveOutbox() {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox]));
    } catch { /* storage full; the outbox still lives in memory */ }
  }

  function queue(table, id, op) {
    outbox.set(`${table}:${id}`, op);
    saveOutbox();
    scheduleFlush();
  }

  sync.changed = (table, id) => queue(table, id, 'upsert');
  sync.removed = (table, id) => queue(table, id, 'delete');
  sync.signOut = signOut;

  /* ---------- Row mapping ---------- */

  const clientToRow = c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  });

  const projectToRow = p => ({
    id: p.id,
    client_id: p.clientId || null,
    title: p.title,
    status: p.status,
    due: p.due || null,
    notes: p.notes,
    sort_order: p.order,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  });

  const rowToClient = r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  const rowToProject = r => ({
    id: r.id,
    clientId: r.client_id || '',
    title: r.title,
    status: r.status,
    due: r.due || '',
    notes: r.notes || '',
    order: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  /* ---------- Push local changes ---------- */

  function scheduleFlush(delay = 400) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  async function flush() {
    if (!user || flushing || !outbox.size) return;
    flushing = true;
    setStatus('syncing');

    const snapshot = new Map(outbox);
    const ids = { clients: { upsert: [], delete: [] }, projects: { upsert: [], delete: [] } };
    for (const [key, op] of snapshot) {
      const [table, ...rest] = key.split(':');
      if (ids[table]) ids[table][op].push(rest.join(':'));
    }

    const clientRows = state.clients.filter(c => ids.clients.upsert.includes(c.id)).map(clientToRow);
    const projectRows = state.projects.filter(p => ids.projects.upsert.includes(p.id)).map(projectToRow);

    // Order matters for the client_id foreign key:
    // create clients before projects use them, delete projects before their clients.
    const steps = [
      () => clientRows.length && db.from('clients').upsert(clientRows),
      () => projectRows.length && db.from('projects').upsert(projectRows),
      () => ids.projects.delete.length && db.from('projects').delete().in('id', ids.projects.delete),
      () => ids.clients.delete.length && db.from('clients').delete().in('id', ids.clients.delete),
    ];

    try {
      for (const step of steps) {
        const res = await step();
        if (res && res.error) throw res.error;
      }
      // Clear only entries that did not change again while we were sending.
      for (const [key, op] of snapshot) {
        if (outbox.get(key) === op) outbox.delete(key);
      }
      saveOutbox();
      flushing = false;
      if (outbox.size) scheduleFlush(0);
      else setStatus('synced');
    } catch (err) {
      flushing = false;
      console.warn('Sync failed', err);
      setStatus(navigator.onLine ? 'error' : 'offline', err.message);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(syncNow, RETRY_MS);
    }
  }

  /* ---------- Pull the board ---------- */

  function schedulePull(delay = 300) {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(pull, delay);
  }

  async function pull() {
    if (!user) return;
    setStatus('syncing');
    const [clients, projects] = await Promise.all([
      db.from('clients').select('*'),
      db.from('projects').select('*'),
    ]);
    const error = clients.error || projects.error;
    if (error) {
      console.warn('Pull failed', error);
      setStatus(navigator.onLine ? 'error' : 'offline', error.message);
      return;
    }

    // Start from the server copy, then lay unsent local changes on top.
    const merged = {
      clients: mergeTable('clients', clients.data.map(rowToClient), state.clients),
      projects: mergeTable('projects', projects.data.map(rowToProject), state.projects),
    };
    state = normalize({ version: 1, ...merged });
    save();
    if (!drag) render();
    setStatus(outbox.size ? 'syncing' : 'synced');
  }

  function mergeTable(table, remote, local) {
    const byId = new Map(remote.map(r => [r.id, r]));
    for (const [key, op] of outbox) {
      const [t, ...rest] = key.split(':');
      if (t !== table) continue;
      const id = rest.join(':');
      if (op === 'delete') {
        byId.delete(id);
      } else {
        const item = local.find(x => x.id === id);
        if (item) byId.set(id, item);
      }
    }
    return [...byId.values()];
  }

  async function syncNow() {
    if (!user) return;
    clearTimeout(retryTimer);
    await flush();
    await pull();
  }

  /* ---------- Realtime ---------- */

  function subscribe() {
    unsubscribe();
    channel = db.channel('planner-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => schedulePull())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => schedulePull())
      .subscribe();
  }

  function unsubscribe() {
    if (channel) db.removeChannel(channel);
    channel = null;
  }

  /* ---------- Status ---------- */

  const STATUS_TEXT = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' };

  function setStatus(s, detail) {
    statusEl.hidden = false;
    statusEl.dataset.state = s;
    statusEl.textContent = STATUS_TEXT[s];
    statusEl.title = detail || '';
  }

  /* ---------- Auth ---------- */

  function showAuth(message = '', isError = false) {
    authScreen.hidden = false;
    authMessage.textContent = message;
    authMessage.classList.toggle('error', isError);
  }

  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const mode = config.allowSignup && e.submitter?.dataset.mode === 'signup' ? 'signup' : 'signin';
    const email = authForm.elements.email.value.trim();
    const password = authForm.elements.password.value;
    const buttons = authForm.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    showAuth(mode === 'signup' ? 'Creating account…' : 'Signing in…');

    try {
      if (mode === 'signup') {
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        if (!data.session) showAuth('Check your email to confirm your account, then sign in here.');
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      showAuth(err.message || 'Something went wrong.', true);
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  });

  async function onSignedIn(newUser) {
    if (user && user.id === newUser.id) return;
    user = newUser;
    authScreen.hidden = true;
    authForm.reset();
    $('#accountInfo').textContent = `Signed in as ${user.email}`;
    $('#accountInfo').hidden = false;
    $('#signOutItem').hidden = false;

    let owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch { /* ignore */ }

    if (owner && owner !== user.id) {
      // Cached board belongs to a different account: drop it.
      state = emptyState();
      outbox.clear();
      saveOutbox();
      save();
      render();
    } else if (!owner) {
      // First sign-in on this device: upload anything made before sync was set up.
      state.clients.forEach(c => outbox.set(`clients:${c.id}`, 'upsert'));
      state.projects.forEach(p => outbox.set(`projects:${p.id}`, 'upsert'));
      saveOutbox();
    }
    try { localStorage.setItem(OWNER_KEY, user.id); } catch { /* ignore */ }

    subscribe();
    syncNow();
  }

  function onSignedOut() {
    user = null;
    unsubscribe();
    $('#accountInfo').hidden = true;
    $('#signOutItem').hidden = true;
    statusEl.hidden = true;
    showAuth();
  }

  async function signOut() {
    if (outbox.size && !confirm('Some changes have not synced yet and will be lost. Sign out anyway?')) return;
    outbox.clear();
    saveOutbox();
    state = emptyState();
    save();
    render();
    try { localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ }
    await db.auth.signOut();
    onSignedOut();
  }

  db.auth.onAuthStateChange((event, session) => {
    // Supabase advises against awaiting other Supabase calls inside this callback.
    setTimeout(() => {
      if (session?.user) onSignedIn(session.user);
      else if (user || event === 'INITIAL_SESSION') onSignedOut();
    }, 0);
  });

  /* ---------- Stay fresh ---------- */

  window.addEventListener('online', syncNow);
  window.addEventListener('offline', () => user && setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
})();
