/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — SHARED UTILITIES
   js/utils.js  |  v1.0

   Pure helper functions with no side effects.
   Depends on: nothing
   Used by: app.js, db-ui.js, system.js
═══════════════════════════════════════════════════════════════════ */

/** Escape a string for safe HTML insertion */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape for inline JS onclick attribute values */
function escAttr(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g,  "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Format bytes as human-readable string */
function formatBytes(bytes) {
  if (!bytes)           return '0 B';
  if (bytes < 1024)     return bytes + ' B';
  if (bytes < 1048576)  return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/** Format ISO date string → "21 Mar 2026 · 14:30" */
function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' · '
      + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  } catch {
    return iso;
  }
}

/** Sleep for ms milliseconds (allows browser to repaint) */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Score password strength 0–4 */
function pwScore(pw) {
  let s = 0;
  if (pw.length >= 8)            s++;
  if (/[A-Z]/.test(pw))         s++;
  if (/[0-9]/.test(pw))         s++;
  if (/[^A-Za-z0-9]/.test(pw))  s++;
  return s;
}

/** Apply strength classes to password bar elements */
function applyPwBars(score, barIds) {
  const levels = ['', 'weak', 'fair', 'strong', 'strong'];
  barIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.className = 'pw-bar ' + (i < score ? levels[score] : '');
  });
}

/** Toggle password field visibility */
function togglePwVisible(inputId, btn) {
  const f = document.getElementById(inputId);
  if (!f) return;
  f.type = f.type === 'password' ? 'text' : 'password';
  btn.textContent = f.type === 'password' ? 'Show' : 'Hide';
}

/** Get user role CSS class name */
function roleBadgeClass(role) {
  const map = {
    admin   : 'badge-admin',
    operator: 'badge-operator',
    viewer  : 'badge-viewer',
    auditor : 'badge-auditor'
  };
  return map[role] || 'badge-viewer';
}

/** Render a role badge HTML string */
function roleBadgeHtml(role) {
  return `<span class="badge ${roleBadgeClass(role)}">${escHtml((role || '—').toUpperCase())}</span>`;
}

/* ── Toast notification ─────────────────────────────────────────────
   Usage: toast('Message', 'success' | 'error' | 'info' | 'warn')
─────────────────────────────────────────────────────────────────── */
let _toastTimer = null;

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, type === 'error' ? 4000 : 2200);
}

/* ── Modal helpers ──────────────────────────────────────────────────
   Modals use class "modal-backdrop" + "open" to show/hide.
─────────────────────────────────────────────────────────────────── */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/* ── Table loading overlay ──────────────────────────────────────── */
function setTableLoading(id, show) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('visible', show);
}

/* ── Button loading state ───────────────────────────────────────── */
function setBtnLoading(id, loading, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled   = loading;
  btn.textContent = loading ? 'Saving...' : label;
}

/* ── Clear error messages ───────────────────────────────────────── */
function clearErrors(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

/* ── Auto-close modals on backdrop click ────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => {
      if (e.target === bd) bd.classList.remove('open');
    });
  });
});
