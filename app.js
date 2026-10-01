'use strict';

/* ============================================================
   Project Planner: a kanban board for projects and clients.
   Data is cached in localStorage on this device. When Supabase is
   configured, cloud.js syncs it across devices.
   ============================================================ */

const STORAGE_KEY = 'planner.v1';

const COLUMNS = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'In progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
];

const PALETTE = ['#2f5bea', '#e0702b', '#1f9d6b', '#c2389b', '#7a4fd6', '#d4a514', '#2a9bb8', '#d23b3b'];

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Sync hooks ----------
   Every change to a client or project is reported here.
   cloud.js fills these in when Supabase is configured. */

const sync = {
  changed(table, id) {},
  removed(table, id) {},
  signOut() {},
};

/* ---------- State ---------- */

let state = load();
let filters = { clientId: 'all', query: '' };

function emptyState() {
  return { version: 1, clients: [], projects: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved data', err);
  }
  return emptyState();
}

function normalize(data) {
  const s = emptyState();
  if (!data || typeof data !== 'object') return s;
  const validStatus = new Set(COLUMNS.map(c => c.id));
  s.clients = (Array.isArray(data.clients) ? data.clients : [])
    .filter(c => c && c.id && c.name)
    .map(c => ({
      id: String(c.id),
      name: String(c.name),
      color: c.color || PALETTE[0],
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || new Date().toISOString(),
    }));
  const clientIds = new Set(s.clients.map(c => c.id));
  s.projects = (Array.isArray(data.projects) ? data.projects : [])
    .filter(p => p && p.id && p.title)
    .map((p, i) => ({
      id: String(p.id),
      title: String(p.title),
      clientId: clientIds.has(p.clientId) ? p.clientId : '',
      status: validStatus.has(p.status) ? p.status : 'backlog',
      due: p.due || '',
      notes: p.notes || '',
      order: Number.isFinite(p.order) ? p.order : i,
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString(),
    }));
  return s;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    alert('Could not save. Your browser storage may be full or disabled.');
  }
}

const clientById = id => state.clients.find(c => c.id === id);

function projectsIn(status) {
  return state.projects
    .filter(p => p.status === status)
    .sort((a, b) => a.order - b.order);
}

function matchesFilters(p) {
  if (filters.clientId === 'none' && p.clientId) return false;
  if (filters.clientId !== 'all' && filters.clientId !== 'none' && p.clientId !== filters.clientId) return false;
  if (filters.query) {
    const client = clientById(p.clientId);
    const hay = `${p.title} ${p.notes} ${client ? client.name : ''}`.toLowerCase();
    if (!hay.includes(filters.query)) return false;
  }
  return true;
}

/* ---------- Rendering ---------- */

const board = $('#board');

function render() {
  renderClientFilter();
  board.replaceChildren(...COLUMNS.map(renderColumn));
}

function renderColumn(col) {
  const all = projectsIn(col.id);
  const shown = all.filter(matchesFilters);

  const section = document.createElement('section');
  section.className = 'column';
  section.dataset.status = col.id;

  const head = document.createElement('div');
  head.className = 'column-head';
  const name = document.createElement('span');
  name.textContent = col.name;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = shown.length === all.length ? all.length : `${shown.length}/${all.length}`;
  head.append(name, count);

  const list = document.createElement('ul');
  list.className = 'cards';
  list.dataset.status = col.id;
  shown.forEach(p => list.append(renderCard(p)));
  if (!shown.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing here';
    list.append(empty);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add-inline';
  add.textContent = '+ Add project';
  add.addEventListener('click', () => openProject(null, col.id));

  section.append(head, list, add);
  return section;
}

function renderCard(p) {
  const li = document.createElement('li');
  li.className = 'card';
  li.tabIndex = 0;
  li.dataset.id = p.id;

  const client = clientById(p.clientId);
  if (client) li.style.setProperty('--client-color', client.color);

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = p.title;
  li.append(title);

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  if (client) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const dot = document.createElement('span');
    dot.className = 'dot';
    chip.append(dot, document.createTextNode(client.name));
    meta.append(chip);
  }

  if (p.due) {
    const due = document.createElement('span');
    due.className = 'due';
    due.textContent = formatDue(p.due);
    if (p.status !== 'done' && p.due < todayISO()) due.classList.add('overdue');
    meta.append(due);
  }

  if (p.notes.trim()) {
    const n = document.createElement('span');
    n.className = 'has-notes';
    n.textContent = 'Notes';
    meta.append(n);
  }

  if (meta.childNodes.length) li.append(meta);

  li.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openProject(p.id);
    }
  });

  return li;
}

function renderClientFilter() {
  const sel = $('#clientFilter');
  const options = [
    ['all', 'All clients'],
    ...[...state.clients].sort(byName).map(c => [c.id, c.name]),
    ['none', 'No client'],
  ];
  if (!options.some(([v]) => v === filters.clientId)) filters.clientId = 'all';
  sel.replaceChildren(...options.map(([v, t]) => new Option(t, v, false, v === filters.clientId)));
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDue(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/* ---------- Project dialog ---------- */

const projectDialog = $('#projectDialog');
const projectForm = $('#projectForm');
let editingId = null;

function fillClientSelect(select, selected) {
  select.replaceChildren(
    new Option('No client', ''),
    ...[...state.clients].sort(byName).map(c => new Option(c.name, c.id, false, c.id === selected)),
    new Option('+ New client…', '__new__'),
  );
  select.value = selected || '';
}

function openProject(id, status) {
  editingId = id;
  const p = id ? state.projects.find(x => x.id === id) : null;
  const f = projectForm.elements;

  $('#projectDialogTitle').textContent = p ? 'Edit project' : 'New project';
  f.title.value = p ? p.title : '';
  const defaultClient = filters.clientId !== 'all' && filters.clientId !== 'none' ? filters.clientId : '';
  fillClientSelect(f.clientId, p ? p.clientId : defaultClient);
  f.status.replaceChildren(...COLUMNS.map(c => new Option(c.name, c.id)));
  f.status.value = p ? p.status : (status || 'backlog');
  f.due.value = p ? p.due : '';
  f.notes.value = p ? p.notes : '';
  $('#deleteProjectBtn').hidden = !p;

  projectDialog.showModal();
  if (!p) f.title.focus();
}

projectForm.elements.clientId.addEventListener('change', e => {
  if (e.target.value !== '__new__') return;
  const name = (prompt('Client name') || '').trim();
  if (!name) {
    e.target.value = '';
    return;
  }
  const client = addClient(name);
  fillClientSelect(e.target, client.id);
});

projectForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = projectForm.elements;
  const title = f.title.value.trim();
  if (!title) return;
  const data = {
    title,
    clientId: f.clientId.value === '__new__' ? '' : f.clientId.value,
    status: f.status.value,
    due: f.due.value,
    notes: f.notes.value,
    updatedAt: new Date().toISOString(),
  };

  if (editingId) {
    const p = state.projects.find(x => x.id === editingId);
    if (p.status !== data.status) data.order = nextOrder(data.status);
    Object.assign(p, data);
    sync.changed('projects', p.id);
  } else {
    const id = uid();
    state.projects.push({
      id,
      ...data,
      order: nextOrder(data.status),
      createdAt: data.updatedAt,
    });
    sync.changed('projects', id);
  }
  save();
  render();
  projectDialog.close();
});

$('#deleteProjectBtn').addEventListener('click', () => {
  const p = state.projects.find(x => x.id === editingId);
  if (!p || !confirm(`Delete "${p.title}"?`)) return;
  state.projects = state.projects.filter(x => x.id !== editingId);
  sync.removed('projects', editingId);
  save();
  render();
  projectDialog.close();
});

function nextOrder(status) {
  const list = projectsIn(status);
  return list.length ? list[list.length - 1].order + 1 : 0;
}

/* ---------- Clients ---------- */

const clientsDialog = $('#clientsDialog');

function addClient(name) {
  const now = new Date().toISOString();
  const client = { id: uid(), name, color: PALETTE[state.clients.length % PALETTE.length], createdAt: now, updatedAt: now };
  state.clients.push(client);
  sync.changed('clients', client.id);
  save();
  render();
  return client;
}

function renderClientList() {
  const list = $('#clientList');
  if (!state.clients.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No clients yet. Add one above.';
    list.replaceChildren(li);
    return;
  }

  list.replaceChildren(...[...state.clients].sort(byName).map(c => {
    const li = document.createElement('li');

    const color = document.createElement('input');
    color.type = 'color';
    color.value = c.color;
    color.setAttribute('aria-label', `Color for ${c.name}`);
    color.addEventListener('input', () => {
      c.color = color.value;
      c.updatedAt = new Date().toISOString();
      sync.changed('clients', c.id);
      save();
      render();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.value = c.name;
    name.setAttribute('aria-label', 'Client name');
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v) { name.value = c.name; return; }
      c.name = v;
      c.updatedAt = new Date().toISOString();
      sync.changed('clients', c.id);
      save();
      render();
    });

    const n = state.projects.filter(p => p.clientId === c.id).length;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${n} project${n === 1 ? '' : 's'}`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      const msg = n
        ? `Delete client "${c.name}"? Its ${n} project${n === 1 ? '' : 's'} will be kept with no client.`
        : `Delete client "${c.name}"?`;
      if (!confirm(msg)) return;
      state.clients = state.clients.filter(x => x.id !== c.id);
      state.projects.forEach(p => {
        if (p.clientId !== c.id) return;
        p.clientId = '';
        sync.changed('projects', p.id);
      });
      sync.removed('clients', c.id);
      save();
      render();
      renderClientList();
    });

    li.append(color, name, count, del);
    return li;
  }));
}

$('#clientsBtn').addEventListener('click', () => {
  renderClientList();
  clientsDialog.showModal();
});

$('#newClientForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = e.target.elements.name;
  const name = input.value.trim();
  if (!name) return;
  addClient(name);
  input.value = '';
  renderClientList();
  input.focus();
});

/* ---------- Dialog helpers ---------- */

document.querySelectorAll('dialog').forEach(d => {
  d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) d.close();
    // Close when the backdrop (outside the dialog box) is clicked.
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) d.close();
    }
  });
});

/* ---------- Top bar ---------- */

$('#addBtn').addEventListener('click', () => openProject(null, 'backlog'));

$('#search').addEventListener('input', e => {
  filters.query = e.target.value.trim().toLowerCase();
  render();
});

$('#clientFilter').addEventListener('change', e => {
  filters.clientId = e.target.value;
  render();
});

const menu = $('#menu');
const menuBtn = $('#menuBtn');

function setMenu(open) {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
}

menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  setMenu(menu.hidden);
});
document.addEventListener('click', e => {
  if (!menu.hidden && !menu.contains(e.target)) setMenu(false);
});

menu.addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  setMenu(false);
  if (action === 'export') exportData();
  if (action === 'import') $('#importFile').click();
  if (action === 'signout') sync.signOut();
});

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `planner-backup-${todayISO()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = normalize(JSON.parse(await file.text()));
    const msg = `Import ${data.projects.length} projects and ${data.clients.length} clients? This replaces your current board.`;
    if (!confirm(msg)) return;
    const keep = { clients: new Set(data.clients.map(c => c.id)), projects: new Set(data.projects.map(p => p.id)) };
    state.projects.forEach(p => { if (!keep.projects.has(p.id)) sync.removed('projects', p.id); });
    state.clients.forEach(c => { if (!keep.clients.has(c.id)) sync.removed('clients', c.id); });
    data.clients.forEach(c => sync.changed('clients', c.id));
    data.projects.forEach(p => sync.changed('projects', p.id));
    state = data;
    save();
    render();
  } catch {
    alert('That file is not a valid Planner backup.');
  }
});

/* ---------- Drag and drop (mouse + touch) ----------
   Mouse: press and move a few pixels to start dragging.
   Touch: press and hold briefly, then drag. A quick swipe scrolls the board. */

const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 250;

let pending = null; // pointer is down on a card, drag not started yet
let drag = null;    // active drag

board.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const card = e.target.closest('.card');
  if (!card) return;

  pending = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, timer: null };
  if (e.pointerType !== 'mouse') {
    pending.timer = setTimeout(() => {
      if (pending) startDrag(pending.x, pending.y);
    }, LONG_PRESS_MS);
  }
});

window.addEventListener('pointermove', e => {
  if (drag) {
    moveDrag(e.clientX, e.clientY);
    return;
  }
  if (!pending || e.pointerId !== pending.pointerId) return;
  const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
  if (pending.type === 'mouse') {
    if (dist > DRAG_THRESHOLD) startDrag(e.clientX, e.clientY);
  } else if (dist > 10) {
    // Finger moved before the long press finished: treat it as a scroll.
    cancelPending();
  } else {
    pending.x = e.clientX;
    pending.y = e.clientY;
  }
});

window.addEventListener('pointerup', e => {
  if (drag) {
    endDrag();
    return;
  }
  if (pending && e.pointerId === pending.pointerId) {
    const id = pending.id;
    cancelPending();
    openProject(id);
  }
});

window.addEventListener('pointercancel', () => {
  // On touch devices the browser may cancel the pointer when it starts scrolling.
  if (drag) endDrag(true);
  cancelPending();
});

// Stop the page from scrolling while a touch drag is active.
document.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (drag || pending?.type === 'touch') e.preventDefault(); });

function cancelPending() {
  if (pending?.timer) clearTimeout(pending.timer);
  pending = null;
}

function startDrag(x, y) {
  const { card, id } = pending;
  cancelPending();

  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);

  const placeholder = document.createElement('li');
  placeholder.className = 'placeholder';
  placeholder.style.height = `${rect.height}px`;
  card.after(placeholder);
  card.classList.add('dragging-source');
  card.style.display = 'none';

  drag = { id, card, ghost, placeholder, offX: x - rect.left, offY: y - rect.top, scrollTimer: null, lastX: x, lastY: y };
  document.body.classList.add('is-dragging');
  if (navigator.vibrate) navigator.vibrate(10);
  moveDrag(x, y);
}

function moveDrag(x, y) {
  drag.lastX = x;
  drag.lastY = y;
  drag.ghost.style.left = `${x - drag.offX}px`;
  drag.ghost.style.top = `${y - drag.offY}px`;

  const list = listAt(x, y);
  if (list) placeInList(list, y);
  autoScroll(x, y);
}

function listAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const column = el?.closest('.column');
  if (column) return column.querySelector('.cards');
  // Pointer is between columns: pick the nearest one horizontally.
  let best = null;
  let bestDist = Infinity;
  board.querySelectorAll('.cards').forEach(l => {
    const r = l.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < bestDist) { bestDist = d; best = l; }
  });
  return bestDist < 40 ? best : null;
}

function placeInList(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.dragging-source)')];
  const before = cards.find(c => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  list.querySelector('.empty')?.remove();
  if (before) list.insertBefore(drag.placeholder, before);
  else list.append(drag.placeholder);
}

function autoScroll(x, y) {
  clearInterval(drag.scrollTimer);
  const edge = 50;
  const br = board.getBoundingClientRect();
  let dx = 0;
  if (x < br.left + edge) dx = -12;
  else if (x > br.right - edge) dx = 12;

  const list = drag.placeholder.parentElement;
  let dy = 0;
  if (list) {
    const lr = list.getBoundingClientRect();
    if (y < lr.top + edge) dy = -10;
    else if (y > lr.bottom - edge) dy = 10;
  }

  if (!dx && !dy) return;
  drag.scrollTimer = setInterval(() => {
    if (!drag) return;
    if (dx) board.scrollLeft += dx;
    if (dy && list) list.scrollTop += dy;
    const l = listAt(drag.lastX, drag.lastY);
    if (l) placeInList(l, drag.lastY);
  }, 16);
}

function endDrag(cancelled = false) {
  const { id, ghost, placeholder, scrollTimer } = drag;
  clearInterval(scrollTimer);
  ghost.remove();
  document.body.classList.remove('is-dragging');

  const list = placeholder.parentElement;
  if (!cancelled && list) {
    const status = list.dataset.status;
    // Order of visible cards in the target column, with the dragged card at the placeholder.
    const ids = [...list.children]
      .map(el => (el === placeholder ? id : el.dataset.id))
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    reorder(id, status, ids);
  }
  drag = null;
  render();
}

// Move a project to `status`, keeping hidden (filtered-out) projects in their relative spots.
function reorder(id, status, visibleIds) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  const moved = p.status !== status;
  p.status = status;

  const column = projectsIn(status).filter(x => x.id !== id);
  const visible = new Set(visibleIds);
  const slots = column.map(x => (visible.has(x.id) ? null : x.id));
  // Hidden cards keep their index; visible cards fill the remaining slots in the new order.
  const result = [];
  const queue = [...visibleIds];
  for (const s of slots) result.push(s === null ? queue.shift() : s);
  result.push(...queue);

  result.forEach((pid, i) => {
    const proj = state.projects.find(x => x.id === pid);
    if (proj && proj.order !== i) {
      proj.order = i;
      sync.changed('projects', pid);
    }
  });
  sync.changed('projects', id);
  if (moved) p.updatedAt = new Date().toISOString();
  save();
}

/* ---------- Sync across tabs ---------- */

window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY) return;
  state = load();
  render();
});

/* ---------- Boot ---------- */

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker failed', err));
}
