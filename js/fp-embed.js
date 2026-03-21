/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — EMBEDDED FILE PARSER
   js/fp-embed.js

   Self-contained file parser that runs inside the File Parser
   page panel in system.html. Uses the same formats.js logic
   (already loaded). All IDs are prefixed "fp-" to avoid conflicts
   with any other page components.

   Depends on: formats.js (must load before this)
═══════════════════════════════════════════════════════════════════ */

/* ── State ──────────────────────────────────────────────────────── */
const _fp = {
  files    : [],
  activeIdx: 0,
  search   : ''
};

let _fpCopyTimer = null;


/* ── Encoding-aware file reader ─────────────────────────────────── */
async function _fpReadFile(file) {
  const encodings = ['iso-8859-1', 'utf-8', 'windows-1252', 'tis-620'];
  const buffer    = await file.arrayBuffer();
  let bestText = '', bestMax = -1;
  for (const enc of encodings) {
    try {
      const text  = new TextDecoder(enc, { fatal: false }).decode(buffer);
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const max   = lines.length > 0 ? Math.max(...lines.map(l => l.length)) : 0;
      if (max > bestMax) { bestMax = max; bestText = text; }
    } catch {}
  }
  return bestText;
}


/* ── File input handler ─────────────────────────────────────────── */
function fpHandleInput(fileList) {
  fpProcessFiles([...fileList]);
  document.getElementById('fp-file-input').value = '';
}


/* ── Process files ──────────────────────────────────────────────── */
async function fpProcessFiles(fileList) {
  if (!fileList.length) return;

  _fpShowLoading(true);

  for (let i = 0; i < fileList.length; i++) {
    const file   = fileList[i];
    const method = getParsingMethod(file.name);
    const text   = await _fpReadFile(file);
    const parsed = parseFileContent(text, method);
    _fp.files.push({ name: file.name, size: file.size, method, ...parsed });
    _fpSetProgress(Math.round(((i + 1) / fileList.length) * 100));
    await new Promise(r => setTimeout(r, 30));
  }

  _fp.activeIdx = _fp.files.length - 1;
  _fp.search    = '';
  _fpShowLoading(false);
  fpRenderAll();
}


/* ── Clear all ──────────────────────────────────────────────────── */
function fpClearAll() {
  _fp.files     = [];
  _fp.activeIdx = 0;
  _fp.search    = '';
  fpRenderAll();
}


/* ── Master render ──────────────────────────────────────────────── */
function fpRenderAll() {
  const has = _fp.files.length > 0;
  document.getElementById('fp-dropzone-wrap').style.display = has ? 'none'  : 'block';
  document.getElementById('fp-file-view').style.display     = has ? 'flex'  : 'none';
  if (has) {
    _fpRenderTabs();
    _fpRenderTable();
  }
}


/* ── Render tabs ────────────────────────────────────────────────── */
function _fpRenderTabs() {
  const bar = document.getElementById('fp-tabs-bar');
  bar.innerHTML = '';

  _fp.files.forEach((f, idx) => {
    const active = idx === _fp.activeIdx;
    const tab    = document.createElement('div');
    tab.style.cssText = `
      display:flex;align-items:center;gap:7px;
      padding:0 14px;
      border-bottom:2px solid ${active ? f.color : 'transparent'};
      cursor:pointer;font-size:10px;font-weight:${active ? 600 : 400};
      color:${active ? f.color : 'var(--text-tertiary)'};
      white-space:nowrap;flex-shrink:0;
      background:${active ? 'rgba(0,0,0,.2)' : 'transparent'};
      transition:all .15s;min-width:0;max-width:200px;
    `;
    tab.innerHTML = `
      <span style="width:6px;height:6px;border-radius:50%;background:${f.color};flex-shrink:0;${active ? `box-shadow:0 0 6px ${f.color}` : ''}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;font-family:var(--font-data)">${escHtml(f.name)}</span>
      <span style="background:rgba(255,255,255,.05);border-radius:3px;padding:1px 5px;font-size:9px;color:var(--text-muted);flex-shrink:0">${f.rows.length}</span>
      <span onclick="event.stopPropagation();fpRemoveFile(${idx})" style="color:var(--text-muted);font-size:13px;padding:0 2px;flex-shrink:0;cursor:pointer;line-height:1" title="Remove">×</span>
    `;
    tab.addEventListener('click', () => { _fp.activeIdx = idx; _fp.search = ''; fpRenderAll(); });
    bar.appendChild(tab);
  });
}


/* ── Render table ───────────────────────────────────────────────── */
function _fpRenderTable() {
  const cur = _fp.files[_fp.activeIdx];
  if (!cur) return;

  const q        = _fp.search.trim().toLowerCase();
  const filtered = q
    ? cur.rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(q)))
    : cur.rows;

  // Format badge
  const badge = document.getElementById('fp-format-badge');
  badge.textContent      = cur.label;
  badge.style.background = cur.color + '18';
  badge.style.border     = `1px solid ${cur.color}44`;
  badge.style.color      = cur.color;

  // Export button
  const expBtn        = document.getElementById('fp-btn-export');
  expBtn.style.border = `1px solid ${cur.color}44`;
  expBtn.style.color  = cur.color;

  // Stats
  document.getElementById('fp-stat-rows').textContent = filtered.length.toLocaleString();
  document.getElementById('fp-stat-cols').textContent = cur.headers.length;
  document.getElementById('fp-stat-size').textContent = formatBytes(cur.size);

  const note = document.getElementById('fp-filter-note');
  if (q && filtered.length < cur.rows.length) {
    note.style.display = 'inline';
    note.textContent   = `(${cur.rows.length - filtered.length} filtered)`;
  } else {
    note.style.display = 'none';
  }

  document.getElementById('fp-search').value                     = _fp.search;
  document.getElementById('fp-search-clear').style.display       = _fp.search ? 'inline' : 'none';

  // Table header
  const thead = document.getElementById('fp-table-head');
  thead.innerHTML = `
    <tr style="background:var(--bg-surface);border-bottom:1px solid ${cur.color}33">
      <th style="padding:9px 10px;text-align:center;background:var(--bg-surface);font-family:var(--font-ui);font-size:9px;color:var(--text-muted);border-right:1px solid var(--border-dim);min-width:44px;position:sticky;left:0;z-index:6">#</th>
      ${cur.headers.map((h, ci) => {
        const isPan = ci === cur.panCol;
        return `<th style="padding:9px 14px;background:var(--bg-surface);font-family:var(--font-ui);font-size:10px;font-weight:600;letter-spacing:.5px;white-space:nowrap;border-right:1px solid var(--border-dim);color:${isPan ? '#EAB308' : cur.color + 'BB'}">${isPan ? '🔒 ' : ''}${escHtml(h)}</th>`;
      }).join('')}
    </tr>`;

  // Table body
  const tbody = document.getElementById('fp-table-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${cur.headers.length + 1}" style="padding:48px;text-align:center;font-style:italic;color:var(--text-muted)">
      ${q ? `No rows matching "${escHtml(q)}"` : 'No data rows'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((row, ri) => `
    <tr style="border-bottom:1px solid rgba(13,31,53,.7);${ri % 2 ? 'background:rgba(255,255,255,.01)' : ''};transition:background .1s"
      onmouseover="this.style.background='rgba(0,212,245,.04)'" onmouseout="this.style.background='${ri % 2 ? 'rgba(255,255,255,.01)' : ''}'">
      <td style="padding:7px 10px;text-align:center;color:var(--text-muted);font-size:9px;font-family:var(--font-data);border-right:1px solid var(--border-dim);user-select:none;position:sticky;left:0;background:var(--bg-surface)">${ri + 1}</td>
      ${cur.headers.map((_, ci) => {
        const val   = row[ci] !== undefined ? row[ci] : '';
        const empty = !val;
        const isPan = ci === cur.panCol;
        return `<td
          style="padding:7px 14px;border-right:1px solid rgba(13,31,53,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;font-family:var(--font-data);font-size:11px;cursor:pointer;transition:background .1s;${isPan ? 'color:rgba(234,179,8,.6)' : 'color:var(--text-secondary)'};${empty ? 'color:var(--text-muted);font-style:italic' : ''}"
          onclick="fpCopyCell(this,'${escAttr(String(val))}')"
          title="Click to copy"
        >${empty ? '—' : escHtml(String(val))}</td>`;
      }).join('')}
    </tr>
  `).join('');
}


/* ── Remove file tab ────────────────────────────────────────────── */
function fpRemoveFile(idx) {
  _fp.files.splice(idx, 1);
  _fp.activeIdx = Math.max(0, Math.min(_fp.activeIdx, _fp.files.length - 1));
  fpRenderAll();
}


/* ── Search ─────────────────────────────────────────────────────── */
function fpSearch(val) {
  _fp.search = val;
  document.getElementById('fp-search-clear').style.display = val ? 'inline' : 'none';
  _fpRenderTable();
}

function fpClearSearch() {
  _fp.search = '';
  fpRenderAll();
}


/* ── Copy cell ──────────────────────────────────────────────────── */
function fpCopyCell(td, val) {
  navigator.clipboard?.writeText(val).then(() => {
    td.style.background = 'rgba(0,212,245,.18)';
    setTimeout(() => { td.style.background = ''; }, 1200);
    toast('Copied!', 'info');
  });
}


/* ── Export CSV ─────────────────────────────────────────────────── */
function fpExportCSV() {
  const cur = _fp.files[_fp.activeIdx];
  if (!cur) return;
  const esc   = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [cur.headers.map(esc).join(','), ...cur.rows.map(row => row.map(esc).join(','))];
  const blob  = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = cur.name.replace(/\.[^.]+$/, '') + '_parsed.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}


/* ── Drag & drop ────────────────────────────────────────────────── */
function fpDragOver(e) {
  e.preventDefault();
  document.getElementById('fp-dropzone').style.borderColor = 'var(--cyan)';
  document.getElementById('fp-dropzone').style.background  = 'rgba(0,212,245,.025)';
}

function fpDragLeave() {
  document.getElementById('fp-dropzone').style.borderColor = '';
  document.getElementById('fp-dropzone').style.background  = '';
}

function fpDrop(e) {
  e.preventDefault();
  fpDragLeave();
  fpProcessFiles([...e.dataTransfer.files]);
}


/* ── Loading helpers ────────────────────────────────────────────── */
function _fpShowLoading(show) {
  document.getElementById('fp-loading-wrap').style.display = show ? 'flex'  : 'none';
  document.getElementById('fp-dz-content').style.display   = show ? 'none'  : 'block';
}

function _fpSetProgress(pct) {
  document.getElementById('fp-prog-bar').style.width       = pct + '%';
  document.getElementById('fp-loading-text').textContent   = 'Processing... ' + pct + '%';
}
