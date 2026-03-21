/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — FILE PARSER APPLICATION
   js/app.js  |  v2.1

   Core logic for the IFD/IFO file parser (index.html).
   Depends on: formats.js, db.js, utils.js (load before this)

   State model:
     state.files[]   — array of parsed file objects
     state.activeIdx — index of currently visible tab
     state.search    — current search string
═══════════════════════════════════════════════════════════════════ */

/* ── Application state ──────────────────────────────────────────── */
const state = {
  files    : [],
  activeIdx: 0,
  search   : ''
};

/* ── Set of filenames already saved to DB ───────────────────────── */
const _savedFiles = new Set();


/* ══════════════════════════════════════════════════════════════════
   FILE PROCESSING
══════════════════════════════════════════════════════════════════ */

/** Called by the hidden <input type="file"> onChange */
function handleFileInput(fileList) {
  processFiles([...fileList]);
  document.getElementById('file-input').value = '';
}

/**
 * Try multiple encodings and return the best-decoded text.
 * Banking files are often Latin-1, not UTF-8.
 */
async function readFileWithBestEncoding(file) {
  const encodings = ['iso-8859-1', 'utf-8', 'windows-1252', 'tis-620'];
  const buffer    = await file.arrayBuffer();

  let bestText = '', bestMax = -1;

  for (const enc of encodings) {
    try {
      const text   = new TextDecoder(enc, { fatal: false }).decode(buffer);
      const lines  = text.split(/\r?\n/).filter(l => l.trim());
      const maxLen = lines.length > 0 ? Math.max(...lines.map(l => l.length)) : 0;
      if (maxLen > bestMax) { bestMax = maxLen; bestText = text; }
    } catch {}
  }
  return bestText;
}

/** Read, parse, and store files. Shows progress during processing. */
async function processFiles(fileList) {
  if (!fileList.length) return;

  _showLoading(true);
  const results = [];

  for (let i = 0; i < fileList.length; i++) {
    const file   = fileList[i];
    const method = getParsingMethod(file.name);
    const text   = await readFileWithBestEncoding(file);
    const parsed = parseFileContent(text, method);

    results.push({ name: file.name, size: file.size, method, ...parsed });
    _updateProgress(Math.round(((i + 1) / fileList.length) * 100));
    await sleep(30);
  }

  state.files     = [...state.files, ...results];
  state.activeIdx = state.files.length - 1;
  state.search    = '';

  _showLoading(false);
  renderAll();
}

function removeFile(idx) {
  state.files.splice(idx, 1);
  state.activeIdx = Math.max(0, Math.min(state.activeIdx, state.files.length - 1));
  renderAll();
}

function clearAll() {
  const count = state.files.length;
  state.files     = [];
  state.activeIdx = 0;
  state.search    = '';
  renderAll();
  if (count > 0) db.log('CLEAR_FILES', `${count} files cleared`).catch(() => {});
}


/* ══════════════════════════════════════════════════════════════════
   RENDER FUNCTIONS
══════════════════════════════════════════════════════════════════ */

function renderAll() {
  const has = state.files.length > 0;

  document.getElementById('dropzone-wrap').style.display = has ? 'none'  : 'flex';
  document.getElementById('file-view').style.display     = has ? 'flex'  : 'none';
  document.getElementById('btn-clear').style.display     = has ? 'block' : 'none';

  _renderLegend();
  _renderFileBadge();
  _renderDbButtons(has);

  if (has) {
    _renderTabs();
    _renderTable();
  }
}

function _renderLegend() {
  const loaded = new Set(state.files.map(f => f.method));
  const el     = document.getElementById('format-legend');
  el.innerHTML = '';

  Object.entries(FORMATS).forEach(([key, cfg]) => {
    const active = loaded.has(key);
    const item   = document.createElement('div');
    item.className = 'legend-item';
    item.style.borderLeftColor = active ? cfg.color + '66' : 'transparent';
    item.innerHTML = `
      <div class="legend-dot" style="
        background:${active ? cfg.color : '#1E3A5F'};
        ${active ? `box-shadow:0 0 8px ${cfg.color}88` : ''}
      "></div>
      <div>
        <div class="legend-label" style="color:${active ? cfg.color : '#334155'};font-weight:${active ? 600 : 400}">${cfg.label}</div>
        <div class="legend-sub">${key.replace('FixedWidth_', '').replace(/_/g, ' ')}</div>
      </div>
    `;
    el.appendChild(item);
  });
}

function _renderFileBadge() {
  const el = document.getElementById('badge-files');
  if (state.files.length > 0) {
    el.style.display = 'flex';
    el.textContent   = state.files.length + ' FILE' + (state.files.length !== 1 ? 'S' : '') + ' LOADED';
  } else {
    el.style.display = 'none';
  }
}

function _renderDbButtons(show) {
  const configured = typeof db !== 'undefined' && db.isConfigured();
  ['btn-save-db', 'btn-save-db-toolbar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (show && configured) ? '' : 'none';
  });
}

function _renderTabs() {
  const bar     = document.getElementById('tabs-bar');
  const addWrap = document.getElementById('tab-add-wrap');
  bar.innerHTML = '';

  state.files.forEach((f, idx) => {
    const active = idx === state.activeIdx;
    const tab    = document.createElement('div');
    tab.className = 'tab' + (active ? ' active' : '');
    tab.style.borderBottomColor = active ? f.color : 'transparent';
    tab.onclick   = () => { state.activeIdx = idx; state.search = ''; renderAll(); };
    tab.innerHTML = `
      <div class="tab-dot" style="background:${f.color};${active ? `box-shadow:0 0 8px ${f.color}` : ''}"></div>
      <span class="tab-name" style="color:${active ? f.color : '#475569'}" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="tab-count">${f.rows.length}</span>
      <button class="tab-close" onclick="event.stopPropagation();removeFile(${idx})" title="Remove">×</button>
    `;
    bar.appendChild(tab);
  });

  bar.appendChild(addWrap);
}

function _renderTable() {
  const cur = state.files[state.activeIdx];
  if (!cur) return;

  const q        = state.search.trim().toLowerCase();
  const filtered = q
    ? cur.rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(q)))
    : cur.rows;

  // Format badge
  const badge             = document.getElementById('format-badge');
  badge.textContent       = cur.label;
  badge.style.background  = cur.color + '18';
  badge.style.border      = `1px solid ${cur.color}44`;
  badge.style.color       = cur.color;

  // Export button
  const expBtn           = document.getElementById('btn-export');
  expBtn.style.border    = `1px solid ${cur.color}44`;
  expBtn.style.color     = cur.color;

  // Stats
  document.getElementById('stat-rows').textContent = filtered.length.toLocaleString();
  document.getElementById('stat-cols').textContent = cur.headers.length;
  document.getElementById('stat-size').textContent = formatBytes(cur.size);

  const filterNote = document.getElementById('filter-note');
  if (q && filtered.length < cur.rows.length) {
    filterNote.style.display = 'inline';
    filterNote.textContent   = `(${(cur.rows.length - filtered.length)} filtered)`;
  } else {
    filterNote.style.display = 'none';
  }

  document.getElementById('search-input').value          = state.search;
  document.getElementById('search-clear').style.display  = state.search ? 'inline' : 'none';

  // Table header
  const thead = document.getElementById('table-head');
  thead.innerHTML = `<tr style="border-bottom:1px solid ${cur.color}33">
    <th class="num-col">#</th>
    ${cur.headers.map((h, ci) => {
      const isPan = ci === cur.panCol;
      return `<th class="${isPan ? 'pan-col' : ''}" style="color:${isPan ? '#FFD700' : cur.color + 'BB'}">${isPan ? '🔒 ' : ''}${escHtml(h)}</th>`;
    }).join('')}
  </tr>`;

  // Table body
  const tbody = document.getElementById('table-body');

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${cur.headers.length + 1}" style="padding:48px;text-align:center;color:#1E3A5F;font-style:italic">
      ${q ? `No rows matching "${escHtml(q)}"` : 'No data rows'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((row, ri) => `
    <tr class="row-in" style="animation-delay:${Math.min(ri * 8, 300)}ms">
      <td class="num-td">${ri + 1}</td>
      ${cur.headers.map((_, ci) => {
        const val   = row[ci] !== undefined ? row[ci] : '';
        const empty = !val;
        return `<td
          class="${ci === cur.panCol ? 'pan-td' : ''}"
          onclick="copyCell(this,'${escAttr(String(val))}')"
          title="Click to copy"
        >${empty ? '—' : escHtml(String(val))}</td>`;
      }).join('')}
    </tr>
  `).join('');

  // Status bar
  document.getElementById('status-files').innerHTML = state.files.map(f => `
    <div class="status-file-item">
      <div class="status-dot" style="background:${f.color}"></div>
      ${f.rows.length.toLocaleString()} rows
    </div>
  `).join('');
}


/* ══════════════════════════════════════════════════════════════════
   USER INTERACTIONS
══════════════════════════════════════════════════════════════════ */

function onSearch(val) {
  state.search = val;
  document.getElementById('search-clear').style.display = val ? 'inline' : 'none';
  _renderTable();
}

function clearSearch() {
  state.search = '';
  renderAll();
}

let _copyTimer = null;

function copyCell(td, val) {
  navigator.clipboard?.writeText(val).then(() => {
    td.classList.add('copied');
    setTimeout(() => td.classList.remove('copied'), 1200);
    const t = document.getElementById('toast');
    t.textContent = 'Copied!';
    t.className   = 'show info';
    clearTimeout(_copyTimer);
    _copyTimer = setTimeout(() => { t.className = ''; }, 1500);
  });
}

function exportCSV() {
  const cur = state.files[state.activeIdx];
  if (!cur) return;

  const esc  = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    cur.headers.map(esc).join(','),
    ...cur.rows.map(row => row.map(esc).join(','))
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = cur.name.replace(/\.[^.]+$/, '') + '_parsed.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  db.log('EXPORT_CSV', cur.name, { rows: cur.rows.length }).catch(() => {});
}


/* ══════════════════════════════════════════════════════════════════
   DATABASE SAVE
══════════════════════════════════════════════════════════════════ */

async function saveCurrentFileToDb() {
  if (!db.isConfigured()) {
    toast('Configure Supabase in js/db.js first', 'warn');
    return;
  }

  const cur = state.files[state.activeIdx];
  if (!cur) return;

  if (_savedFiles.has(cur.name)) {
    toast('Already saved to database', 'info');
    return;
  }

  _setDbBtnsLoading(true);
  _showDbProgress(5, 'Saving file record...');

  try {
    const fileRecord = await db.saveFile(cur);
    await db.saveTransactions(fileRecord.id, cur, pct => {
      _showDbProgress(5 + Math.round(pct * 0.9), `Saving rows... ${pct}%`);
    });

    await db.log('UPLOAD_FILE', cur.name, {
      format: cur.method, rows: cur.rows.length, size: cur.size
    });

    _savedFiles.add(cur.name);
    _showDbProgress(100, 'Saved!');
    setTimeout(() => _hideDbProgress(), 2000);
    toast(`✓ ${cur.rows.length} rows saved`, 'success');
    loadDbHistory();

  } catch (err) {
    _hideDbProgress();
    toast(`Save failed: ${err.message}`, 'error');
    db.log('UPLOAD_FILE', cur.name, { error: err.message }, 'FAILURE').catch(() => {});
  } finally {
    _setDbBtnsLoading(false);
  }
}

async function loadDbHistory() {
  if (typeof db === 'undefined' || !db.isConfigured()) return;

  const list = document.getElementById('db-history-list');
  if (!list) return;
  list.innerHTML = '<div class="db-history-empty">Loading...</div>';

  try {
    const files = await db.getFiles();
    if (!files || !files.length) {
      list.innerHTML = '<div class="db-history-empty">No files saved yet</div>';
      return;
    }

    list.innerHTML = '';
    files.slice(0, 20).forEach(f => {
      const color = FORMATS[f.format]?.color || '#94A3B8';
      const item  = document.createElement('div');
      item.className = 'db-history-item';
      item.innerHTML = `
        <div class="dh-dot" style="background:${color}"></div>
        <div class="dh-info">
          <div class="dh-name" title="${escHtml(f.file_name)}">${escHtml(f.file_name.length > 24 ? f.file_name.slice(0,22) + '…' : f.file_name)}</div>
          <div class="dh-meta">${f.row_count ?? 0} rows · ${formatBytes(f.file_size ?? 0)}</div>
          <div class="dh-date">${formatDate(f.uploaded_at)}</div>
        </div>
        <div class="dh-status dh-status-${(f.status||'').toLowerCase()}">${f.status || 'PARSED'}</div>
      `;
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<div class="db-history-empty" style="color:var(--red)">Error: ${escHtml(err.message)}</div>`;
  }
}


/* ══════════════════════════════════════════════════════════════════
   DRAG & DROP
══════════════════════════════════════════════════════════════════ */

function onDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('drag');
}

function onDragLeave() {
  document.getElementById('dropzone').classList.remove('drag');
}

function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('drag');
  processFiles([...e.dataTransfer.files]);
}

document.addEventListener('dragover',  e => { if (state.files.length > 0) e.preventDefault(); });
document.addEventListener('drop', e => { if (state.files.length > 0) { e.preventDefault(); processFiles([...e.dataTransfer.files]); } });


/* ══════════════════════════════════════════════════════════════════
   PRIVATE UI HELPERS
══════════════════════════════════════════════════════════════════ */

function _showLoading(show) {
  document.getElementById('loading-wrap').style.display = show ? 'flex'   : 'none';
  document.getElementById('dz-content').style.display   = show ? 'none'   : 'block';
}

function _updateProgress(pct) {
  document.getElementById('progress-bar').style.width  = pct + '%';
  document.getElementById('loading-text').textContent   = 'PROCESSING... ' + pct + '%';
}

function _showDbProgress(pct, label = '') {
  const bar = document.getElementById('db-save-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  document.getElementById('db-save-progress').style.width = pct + '%';
  if (label) document.getElementById('db-save-label').textContent = label;
}

function _hideDbProgress() {
  const bar = document.getElementById('db-save-bar');
  if (bar) bar.style.display = 'none';
}

function _setDbBtnsLoading(loading) {
  document.querySelectorAll('#btn-save-db, #btn-save-db-toolbar').forEach(b => {
    b.disabled    = loading;
    b.textContent = loading ? '⏳ Saving...' : '⬆ Save to DB';
  });
}


/* ── DB status badge ────────────────────────────────────────────── */
function _initDbStatus() {
  const dot   = document.getElementById('db-dot');
  const label = document.getElementById('db-label');
  const badge = document.getElementById('badge-db');
  if (!badge) return;

  const ok = typeof db !== 'undefined' && db.isConfigured();
  if (dot)   dot.classList.add(ok ? 'db-dot-online' : 'db-dot-offline');
  if (label) label.textContent = ok ? 'DB CONNECTED' : 'DB OFFLINE';
  badge.classList.toggle('badge-db-online', ok);
  badge.classList.toggle('badge-db-offline', !ok);
}

/* ── Init ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  _initDbStatus();
  loadDbHistory();
  renderAll();
});
