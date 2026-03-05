/* ═══════════════════════════════════════════════════════════════════
   IFD FILE PARSER SYSTEM — APPLICATION LOGIC
   app.js

   This file handles:
   1. Application State
   2. File Processing   — reading files, calling parser, storing results
   3. Render Functions  — updating DOM based on state
   4. User Interactions — search, tabs, copy cell, export CSV
   5. Drag & Drop
   6. Utility Helpers

   Dependencies (must load before this file):
     - formats.js  (provides: FORMATS, getParsingMethod, parseFileContent)
═══════════════════════════════════════════════════════════════════ */


/* ─── 1. APPLICATION STATE ──────────────────────────────────────────────────
   Central state object. All UI derives from this.
   Modify only via the functions below — never manipulate state.files directly
   from event handlers.
─────────────────────────────────────────────────────────────────────────── */
const state = {
  files    : [],   // Array of parsed file objects
  activeIdx: 0,    // Index of currently visible file tab
  search   : ''    // Current search/filter string
};


/* ─── 2. FILE PROCESSING ────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

/**
 * handleFileInput()
 * Called by the hidden <input type="file"> onChange event.
 */
function handleFileInput(fileList) {
  processFiles([...fileList]);
  document.getElementById('file-input').value = ''; // reset so same file can be re-uploaded
}

/**
 * processFiles()
 * Reads each File object as text, parses it, stores result in state.
 * Shows loading UI with a progress bar during processing.
 *
 * @param {File[]} fileList
 */
async function processFiles(fileList) {
  if (!fileList.length) return;

  showLoading(true);
  const results = [];

  for (let i = 0; i < fileList.length; i++) {
    const file   = fileList[i];
    const method = getParsingMethod(file.name);         // from formats.js
    const text   = await file.text();
    const parsed = parseFileContent(text, method);      // from formats.js

    results.push({
      name  : file.name,
      size  : file.size,
      method: method,
      ...parsed   // spreads: headers, rows, label, color, panCol
    });

    updateProgress(Math.round(((i + 1) / fileList.length) * 100));
    await sleep(30); // small delay so progress bar is visible
  }

  // Merge new files into state and activate the last one
  state.files     = [...state.files, ...results];
  state.activeIdx = state.files.length - 1;
  state.search    = '';

  showLoading(false);
  renderAll();
}

/**
 * removeFile()
 * Removes one file tab by index. Adjusts active index if needed.
 *
 * @param {number} idx - Index to remove
 */
function removeFile(idx) {
  state.files.splice(idx, 1);
  if (state.activeIdx >= state.files.length) {
    state.activeIdx = Math.max(0, state.files.length - 1);
  }
  renderAll();
}

/**
 * clearAll()
 * Removes all loaded files and resets to the drop zone view.
 */
function clearAll() {
  state.files     = [];
  state.activeIdx = 0;
  state.search    = '';
  renderAll();
}


/* ─── 3. RENDER FUNCTIONS ───────────────────────────────────────────────────
   Each render function is responsible for one section of the UI.
   renderAll() calls them all in the correct order.
─────────────────────────────────────────────────────────────────────────── */

/**
 * renderAll()
 * Master render function. Decides what to show based on state.
 */
function renderAll() {
  renderLegend();
  renderBadgeFiles();

  const hasFiles = state.files.length > 0;
  document.getElementById('dropzone-wrap').style.display = hasFiles ? 'none'  : 'flex';
  document.getElementById('file-view').style.display     = hasFiles ? 'flex'  : 'none';
  document.getElementById('btn-clear').style.display     = hasFiles ? 'block' : 'none';

  if (hasFiles) {
    renderTabs();
    renderActiveFile();
  }
}

/**
 * renderBadgeFiles()
 * Updates the "N FILES LOADED" badge in the header.
 */
function renderBadgeFiles() {
  const el = document.getElementById('badge-files');
  if (state.files.length > 0) {
    el.style.display = 'flex';
    el.textContent   = state.files.length + ' FILE' + (state.files.length !== 1 ? 'S' : '') + ' LOADED';
  } else {
    el.style.display = 'none';
  }
}

/**
 * renderLegend()
 * Updates the format legend in the sidebar.
 * Dots light up when that format is currently loaded.
 */
function renderLegend() {
  const loadedMethods = new Set(state.files.map(f => f.method));
  const container     = document.getElementById('format-legend');
  container.innerHTML = '';

  Object.entries(FORMATS).forEach(([key, cfg]) => {
    const isLoaded = loadedMethods.has(key);
    const item     = document.createElement('div');
    item.className = 'legend-item';
    item.style.borderLeftColor = isLoaded ? cfg.color + '66' : 'transparent';
    item.innerHTML = `
      <div class="legend-dot" style="
        background: ${isLoaded ? cfg.color : '#1E3A5F'};
        ${isLoaded ? 'box-shadow: 0 0 8px ' + cfg.color + '88' : ''}
      "></div>
      <div>
        <div class="legend-label" style="
          color: ${isLoaded ? cfg.color : '#334155'};
          font-weight: ${isLoaded ? 600 : 400}
        ">${cfg.label}</div>
        <div class="legend-sub">${key.replace('FixedWidth_', '').replace(/_/g, ' ')}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

/**
 * renderTabs()
 * Renders one tab per loaded file in the tabs bar.
 */
function renderTabs() {
  const bar     = document.getElementById('tabs-bar');
  const addWrap = document.getElementById('tab-add-wrap');
  bar.innerHTML = '';  // clear existing tabs

  state.files.forEach((f, idx) => {
    const isActive = idx === state.activeIdx;
    const tab      = document.createElement('div');

    tab.className            = 'tab' + (isActive ? ' active' : '');
    tab.style.borderBottomColor = isActive ? f.color : 'transparent';
    tab.onclick              = () => { state.activeIdx = idx; state.search = ''; renderAll(); };

    tab.innerHTML = `
      <div class="tab-dot" style="
        background: ${f.color};
        ${isActive ? 'box-shadow: 0 0 8px ' + f.color : ''}
      "></div>
      <span class="tab-name" style="color: ${isActive ? f.color : '#475569'}"
            title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="tab-count">${f.rows.length}</span>
      <button class="tab-close"
        onclick="event.stopPropagation(); removeFile(${idx})"
        title="Remove">×</button>
    `;
    bar.appendChild(tab);
  });

  bar.appendChild(addWrap); // keep the "+ ADD" button at the end
}

/**
 * renderActiveFile()
 * Renders toolbar stats, format badge, and data table for the active file.
 */
function renderActiveFile() {
  const cur = state.files[state.activeIdx];
  if (!cur) return;

  const searchLower = state.search.trim().toLowerCase();
  const filtered    = searchLower
    ? cur.rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(searchLower)))
    : cur.rows;

  // ── Format badge & export button color ──────────────────────
  const badge = document.getElementById('format-badge');
  badge.textContent   = cur.label;
  badge.style.background = cur.color + '18';
  badge.style.border     = '1px solid ' + cur.color + '44';
  badge.style.color      = cur.color;

  const exportBtn = document.getElementById('btn-export');
  exportBtn.style.border = '1px solid ' + cur.color + '44';
  exportBtn.style.color  = cur.color;

  // ── Stats bar ────────────────────────────────────────────────
  document.getElementById('stat-rows').textContent = filtered.length.toLocaleString();
  document.getElementById('stat-cols').textContent = cur.headers.length;
  document.getElementById('stat-size').textContent = formatBytes(cur.size);

  const filterNote = document.getElementById('filter-note');
  if (searchLower && filtered.length < cur.rows.length) {
    filterNote.style.display = 'inline';
    filterNote.textContent   = '(' + (cur.rows.length - filtered.length) + ' FILTERED)';
  } else {
    filterNote.style.display = 'none';
  }

  // ── Search input state ───────────────────────────────────────
  document.getElementById('search-input').value    = state.search;
  document.getElementById('search-clear').style.display = state.search ? 'inline' : 'none';

  // ── Table header ─────────────────────────────────────────────
  const thead = document.getElementById('table-head');
  let headerHTML = `<tr style="border-bottom: 1px solid ${cur.color}33">`;
  headerHTML += `<th class="num-col">#</th>`;
  cur.headers.forEach((h, ci) => {
    const isPan = ci === cur.panCol;
    headerHTML += `<th
      class="${isPan ? 'pan-col' : ''}"
      style="color: ${isPan ? '#FFD700' : cur.color + 'BB'}"
    >${isPan ? '🔒 ' : ''}${escHtml(h)}</th>`;
  });
  headerHTML += '</tr>';
  thead.innerHTML = headerHTML;

  // ── Table body ───────────────────────────────────────────────
  const tbody = document.getElementById('table-body');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr id="empty-row"><td colspan="${cur.headers.length + 1}">
      ${searchLower ? 'No rows matching "' + escHtml(searchLower) + '"' : 'No data rows parsed'}
    </td></tr>`;
    return;
  }

  let bodyHTML = '';
  filtered.forEach((row, ri) => {
    const delay = Math.min(ri * 8, 300);
    bodyHTML += `<tr class="row-in" style="animation-delay: ${delay}ms">`;
    bodyHTML += `<td class="num-td" style="background: ${ri % 2 === 0 ? '#070B14' : '#080D18'}">${ri + 1}</td>`;

    cur.headers.forEach((_, ci) => {
      const val     = row[ci] !== undefined ? row[ci] : '';
      const isEmpty = !val || val === '';
      const isPan   = ci === cur.panCol;

      const classes = ['cell'];
      if (isPan)    classes.push('pan-td');
      if (isEmpty)  classes.push('empty-td');

      bodyHTML += `<td
        class="${classes.join(' ')}"
        onclick="copyCell(this, '${escAttr(val)}')"
        title="Click to copy: ${escAttr(val)}"
      >${isEmpty ? '—' : escHtml(String(val))}</td>`;
    });

    bodyHTML += '</tr>';
  });
  tbody.innerHTML = bodyHTML;

  // ── Status bar file summary ──────────────────────────────────
  const statusFiles = document.getElementById('status-files');
  statusFiles.innerHTML = state.files.map(f => `
    <div class="status-file-item">
      <div class="status-dot" style="background: ${f.color}"></div>
      ${f.rows.length.toLocaleString()} rows
    </div>
  `).join('');
}


/* ─── 4. USER INTERACTIONS ──────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

/**
 * onSearch()
 * Called on every keystroke in the search input.
 *
 * @param {string} val - Current input value
 */
function onSearch(val) {
  state.search = val;
  document.getElementById('search-clear').style.display = val ? 'inline' : 'none';
  renderActiveFile();
}

/**
 * clearSearch()
 * Clears the search filter and re-renders.
 */
function clearSearch() {
  state.search = '';
  renderAll();
}

/**
 * copyCell()
 * Copies a cell value to clipboard and shows visual feedback.
 *
 * @param {HTMLElement} td  - The <td> element that was clicked
 * @param {string}      val - The text value to copy
 */
let toastTimer = null;

function copyCell(td, val) {
  navigator.clipboard?.writeText(val).then(() => {
    // Flash the cell
    td.classList.add('copied');
    setTimeout(() => td.classList.remove('copied'), 1200);

    // Show toast
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
  });
}

/**
 * exportCSV()
 * Exports the current active file's parsed data as a .csv download.
 * Uses the original filename with "_parsed.csv" suffix.
 */
function exportCSV() {
  const cur = state.files[state.activeIdx];
  if (!cur) return;

  const escapeCSV = v => `"${String(v).replace(/"/g, '""')}"`;
  const csvLines  = [
    cur.headers.map(escapeCSV).join(','),
    ...cur.rows.map(row => row.map(escapeCSV).join(','))
  ];

  const blob     = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url      = URL.createObjectURL(blob);
  const link     = document.createElement('a');
  link.href      = url;
  link.download  = cur.name.replace(/\.[^.]+$/, '') + '_parsed.csv';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


/* ─── 5. DRAG & DROP ────────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

function onDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('drag');
}

function onDragLeave(e) {
  document.getElementById('dropzone').classList.remove('drag');
}

function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('drag');
  processFiles([...e.dataTransfer.files]);
}

// Allow dropping anywhere on page when files are already loaded
document.addEventListener('dragover', e => {
  if (state.files.length > 0) e.preventDefault();
});

document.addEventListener('drop', e => {
  if (state.files.length > 0) {
    e.preventDefault();
    processFiles([...e.dataTransfer.files]);
  }
});


/* ─── 6. UTILITY HELPERS ────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

/**
 * formatBytes()
 * Converts byte count to human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes > 1024)    return (bytes / 1024).toFixed(1)    + ' KB';
  return bytes + ' B';
}

/**
 * sleep()
 * Returns a promise that resolves after ms milliseconds.
 * Used to allow the browser to repaint between heavy operations.
 *
 * @param {number} ms
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * showLoading()
 * Toggles the loading spinner vs the default drop zone content.
 *
 * @param {boolean} show
 */
function showLoading(show) {
  document.getElementById('loading-wrap').style.display = show ? 'flex'  : 'none';
  document.getElementById('dz-content').style.display   = show ? 'none'  : 'block';
}

/**
 * updateProgress()
 * Updates the progress bar percentage and label text.
 *
 * @param {number} pct - 0 to 100
 */
function updateProgress(pct) {
  document.getElementById('progress-bar').style.width    = pct + '%';
  document.getElementById('loading-text').textContent    = 'PROCESSING FILES... ' + pct + '%';
}

/**
 * escHtml()
 * Escapes a string for safe insertion as HTML text content.
 *
 * @param {string} s
 * @returns {string}
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * escAttr()
 * Escapes a string for safe use inside a JS onclick="..." attribute value.
 *
 * @param {string} s
 * @returns {string}
 */
function escAttr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g,  "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}


/* ─── INIT ──────────────────────────────────────────────────────────────────
   Run on page load. Renders the initial empty state (drop zone).
─────────────────────────────────────────────────────────────────────────── */
renderAll();
