/* ═══════════════════════════════════════════════════════════════════
   IFD FILE PARSER SYSTEM — DATABASE UI INTEGRATION
   js/db-ui.js

   This file connects the db.js module to the existing app.js UI.
   It adds:
     - DB connection status badge in header
     - "Save to DB" button logic
     - DB history panel in sidebar
     - Progress bar during DB save
     - Audit logging on all user actions

   Load order in index.html:
     formats.js → db.js → app.js → db-ui.js  (this file last)
═══════════════════════════════════════════════════════════════════ */


/* ─── 1. INITIALISE ON PAGE LOAD ────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initDbStatus();
  loadDbHistory();
});


/**
 * initDbStatus()
 * Checks if db.js is configured and updates the header badge.
 * Green dot = configured, Red dot = not configured.
 */
function initDbStatus() {
  const dot   = document.getElementById('db-dot');
  const label = document.getElementById('db-label');
  const badge = document.getElementById('badge-db');

  if (db.isConfigured()) {
    dot.classList.add('db-dot-online');
    label.textContent = 'DB CONNECTED';
    badge.classList.add('badge-db-online');
    // Show the Save buttons
    showDbButtons(true);
  } else {
    dot.classList.add('db-dot-offline');
    label.textContent = 'DB NOT CONFIGURED';
    badge.classList.add('badge-db-offline');
    badge.title = 'Edit js/db.js to add your Supabase URL and key';
    showDbButtons(false);
  }
}


/**
 * showDbButtons()
 * Shows or hides all "Save to DB" buttons.
 */
function showDbButtons(show) {
  const btnSidebar  = document.getElementById('btn-save-db');
  const btnToolbar  = document.getElementById('btn-save-db-toolbar');
  if (btnSidebar) btnSidebar.style.display = show ? 'block' : 'none';
  if (btnToolbar) btnToolbar.style.display = show ? 'flex'  : 'none';
}


/* ─── 2. SAVE CURRENT FILE TO DATABASE ──────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

// Track which files have already been saved to avoid duplicates
const savedFileNames = new Set();

/**
 * saveCurrentFileToDb()
 * Saves the currently active file's parsed data to Supabase.
 * Steps:
 *   1. Insert row into settlement.files
 *   2. Batch-insert all parsed rows into settlement.transactions
 *   3. Log the action to audit.activity_logs
 *   4. Update sidebar history
 */
async function saveCurrentFileToDb() {
  if (!db.isConfigured()) {
    showToastMsg('⚠ Configure Supabase in js/db.js first', 'warn');
    return;
  }

  const cur = state.files[state.activeIdx];
  if (!cur) return;

  // Prevent double-saving
  if (savedFileNames.has(cur.name)) {
    showToastMsg('Already saved to database', 'info');
    return;
  }

  // Disable the buttons during save
  setDbButtonsLoading(true);
  showDbSaveBar(0);

  try {
    // Step 1 — Insert file record
    showDbSaveBar(5, `Saving file record...`);
    const fileRecord = await db.saveFile(cur);
    const fileId     = fileRecord.id;

    // Step 2 — Insert transactions in batches
    await db.saveTransactions(fileId, cur, (pct) => {
      showDbSaveBar(5 + Math.round(pct * 0.9), `Saving rows... ${pct}%`);
    });

    // Step 3 — Audit log
    await db.log('UPLOAD_FILE', cur.name, {
      format   : cur.method,
      rows     : cur.rows.length,
      file_id  : fileId,
      size     : cur.size
    }, 'SUCCESS');

    // Step 4 — Mark as saved
    savedFileNames.add(cur.name);
    showDbSaveBar(100, 'Saved successfully!');
    setTimeout(() => hideDbSaveBar(), 2000);

    showToastMsg(`✓ ${cur.rows.length} rows saved to Supabase`, 'success');

    // Refresh the history panel
    loadDbHistory();

  } catch (err) {
    console.error('[DB Save Error]', err);
    hideDbSaveBar();
    showToastMsg(`✗ Save failed: ${err.message}`, 'error');

    await db.log('UPLOAD_FILE', cur.name, { error: err.message }, 'FAILURE');

  } finally {
    setDbButtonsLoading(false);
  }
}


/* ─── 3. DB HISTORY PANEL ───────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

/**
 * loadDbHistory()
 * Fetches recent files from settlement.files and renders them
 * in the sidebar history panel.
 */
async function loadDbHistory() {
  if (!db.isConfigured()) return;

  const list = document.getElementById('db-history-list');
  list.innerHTML = '<div class="db-history-empty">Loading...</div>';

  try {
    const files = await db.getFiles();

    if (!files || files.length === 0) {
      list.innerHTML = '<div class="db-history-empty">No files saved yet</div>';
      return;
    }

    list.innerHTML = '';
    files.slice(0, 20).forEach(f => {
      const item = document.createElement('div');
      item.className = 'db-history-item';

      // Format label color
      const fmtColor = getFormatColor(f.format);

      item.innerHTML = `
        <div class="dh-dot" style="background:${fmtColor}"></div>
        <div class="dh-info">
          <div class="dh-name" title="${escHtml(f.file_name)}">${escHtml(shortName(f.file_name))}</div>
          <div class="dh-meta">${f.row_count ?? 0} rows · ${formatBytes(f.file_size ?? 0)}</div>
          <div class="dh-date">${formatDate(f.uploaded_at)}</div>
        </div>
        <div class="dh-status dh-status-${(f.status||'').toLowerCase()}">${f.status || 'PARSED'}</div>
      `;
      list.appendChild(item);
    });

  } catch (err) {
    list.innerHTML = `<div class="db-history-empty" style="color:#FF4757">Error: ${err.message}</div>`;
  }
}


/* ─── 4. AUDIT LOGGING HOOKS ────────────────────────────────────────────────
   Wrap existing app.js functions to add audit logging transparently.
─────────────────────────────────────────────────────────────────────────── */

// Wrap exportCSV to log exports
const _origExportCSV = typeof exportCSV === 'function' ? exportCSV : null;
if (_origExportCSV) {
  window.exportCSV = async function() {
    _origExportCSV();
    const cur = state.files[state.activeIdx];
    if (cur) await db.log('EXPORT_CSV', cur.name, { rows: cur.rows.length }, 'SUCCESS');
  };
}

// Wrap clearAll to log clears
const _origClearAll = typeof clearAll === 'function' ? clearAll : null;
if (_origClearAll) {
  window.clearAll = async function() {
    const count = state.files.length;
    _origClearAll();
    if (count > 0) await db.log('CLEAR_FILES', `${count} files cleared`, {}, 'SUCCESS');
  };
}


/* ─── 5. UI HELPERS ─────────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

function showDbSaveBar(pct, label = '') {
  const bar      = document.getElementById('db-save-bar');
  const progress = document.getElementById('db-save-progress');
  const lbl      = document.getElementById('db-save-label');
  bar.style.display      = 'flex';
  progress.style.width   = pct + '%';
  if (label) lbl.textContent = label;
}

function hideDbSaveBar() {
  const bar = document.getElementById('db-save-bar');
  if (bar) bar.style.display = 'none';
}

function setDbButtonsLoading(loading) {
  const btns = document.querySelectorAll('#btn-save-db, #btn-save-db-toolbar');
  btns.forEach(b => {
    b.disabled    = loading;
    b.textContent = loading ? '⏳ SAVING...' : '⬆ SAVE TO DB';
  });
}

function showToastMsg(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className   = `show toast-${type}`;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.className = '';
  }, type === 'error' ? 4000 : 2000);
}

function closeDbModal() {
  document.getElementById('db-modal-overlay').style.display = 'none';
}

function getFormatColor(method) {
  const map = {
    'FixedWidth_Format1_IFO_BIN'  : '#00E5FF',
    'FixedWidth_Format2_IFD_ICOM' : '#69FF47',
    'FixedWidth_Format3_IFD_COMN' : '#FF6B35',
    'FixedWidth_Format4_IFD_FDTL' : '#FFD700',
    'FixedWidth_Format5_IFD_ERR'  : '#FF4757',
    'FixedWidth_Format6_IFD_ERRN' : '#A855F7',
    'RawText'                     : '#94A3B8'
  };
  return map[method] || '#94A3B8';
}

function shortName(name) {
  return name.length > 24 ? name.slice(0, 22) + '…' : name;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
