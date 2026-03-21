/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — DATABASE MODULE
   js/db.js  |  v2.1

   All Supabase communication for settlement data.
   Depends on: nothing (loads independently from auth.js)

   Public API:
     db.isConfigured()                       → boolean
     db.saveFile(fileObj)                    → fileRecord
     db.getFiles()                           → FileRecord[]
     db.deleteFile(fileId)
     db.saveTransactions(fileId, fileObj, onProgress)
     db.getTransactions(fileId, search, limit) → Transaction[]
     db.log(action, resource, payload, result)
     db.getLogs(limit)                       → LogRecord[]
     db.getSchemes()                         → Scheme[]

   Configuration:
     Update SUPABASE_URL and SUPABASE_KEY below.
     Get values from: Supabase Dashboard → Settings → API
═══════════════════════════════════════════════════════════════════ */

/* ── Configuration ──────────────────────────────────────────────── */
const SUPABASE_URL = 'https://zsmtqxexroyxhgcknnbi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_u3k5r8xCtireQeps4DsgRg_JgUg_LTk';

/* ── Private helpers ────────────────────────────────────────────── */

/**
 * Supabase REST fetch with optional schema routing.
 * Non-public schemas require Accept-Profile + Content-Profile headers.
 * URL format: /rest/v1/table_name  (no schema prefix in the path)
 *
 * @param {string} path    - e.g. '/rest/v1/files?...'
 * @param {object} opts    - fetch options
 * @param {string} schema  - schema name, defaults to 'public'
 */
async function _dbFetch(path, opts = {}, schema = 'public') {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'Content-Type'   : 'application/json',
      'apikey'         : SUPABASE_KEY,
      'Authorization'  : `Bearer ${SUPABASE_KEY}`,
      'Prefer'         : 'return=representation',
      // Schema routing — tells PostgREST which schema to use
      'Accept-Profile' : schema,
      'Content-Profile': schema,
      ...opts.headers
    }
  });

  if (res.status === 204) return null;

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`[DB] ${data?.message || data?.error || 'HTTP ' + res.status}`);
  }
  return data;
}

function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ── Field extraction helpers ───────────────────────────────────── */

function _field(row, headers, candidates) {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(candidate.toLowerCase()));
    if (idx >= 0 && row[idx]) return String(row[idx]).trim() || null;
  }
  return null;
}

function _amount(row, headers) {
  const raw = _field(row, headers, ['Amount Tran', 'Tran Amount', 'Transaction Amount']);
  if (!raw) return null;
  const num = parseFloat(raw.replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? null : num;
}

function _currency(row, headers) {
  const raw = _field(row, headers, ['Currency Code', 'Currency code']);
  return raw ? raw.slice(0, 3) : null;
}

function _settlementDate(fileObj) {
  const match = fileObj.name.match(/(\d{6,8})/);
  if (match) {
    const raw = match[1];
    try {
      if (raw.length === 8) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      return `20${raw.slice(0,2)}-${raw.slice(2,4)}-${raw.slice(4,6)}`;
    } catch {}
  }
  return new Date().toISOString().slice(0, 10);
}

/* ── Database public API ────────────────────────────────────────── */

/**
 * @typedef {{ id:string, file_name:string, format:string, file_size:number, row_count:number, settlement_date:string, status:string, uploaded_at:string }} FileRecord
 * @typedef {{ id:string, file_id:string, row_num:number, pan_masked:string, amount:number, currency:string, rrn:string, raw_fields:object }} TxnRecord
 * @typedef {{ id:string, action:string, resource:string, result:string, payload:object, created_at:string }} LogRecord
 */

const db = {

  /** @returns {boolean} */
  isConfigured() {
    return (
      SUPABASE_URL !== 'https://YOUR_PROJECT_REF.supabase.co' &&
      SUPABASE_KEY !== 'YOUR_ANON_PUBLIC_KEY' &&
      SUPABASE_URL.startsWith('https://')
    );
  },

  /* ── Files ──────────────────────────────────────────────────────
     settlement.files — one record per uploaded file
  ─────────────────────────────────────────────────────────────── */

  /**
   * Insert a file record into settlement.files.
   * @param {{ name:string, method:string, size:number, rows:any[][] }} fileObj
   * @returns {Promise<FileRecord>}
   */
  async saveFile(fileObj) {
    const result = await _dbFetch('/rest/v1/files', {
      method: 'POST',
      body  : JSON.stringify({
        file_name      : fileObj.name,
        format         : fileObj.method,
        file_size      : fileObj.size,
        row_count      : fileObj.rows.length,
        settlement_date: _settlementDate(fileObj),
        status         : 'PARSED'
      })
    }, 'settlement');
    return Array.isArray(result) ? result[0] : result;
  },

  /** @returns {Promise<FileRecord[]>} */
  async getFiles() {
    return _dbFetch('/rest/v1/files?select=*&order=uploaded_at.desc', {}, 'settlement');
  },

  async deleteFile(fileId) {
    await _dbFetch(`/rest/v1/transactions?file_id=eq.${fileId}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } }, 'settlement');
    await _dbFetch(`/rest/v1/files?id=eq.${fileId}`,            { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } }, 'settlement');
  },

  /* ── Transactions ───────────────────────────────────────────────
     settlement.transactions — one record per parsed data row
     Batch-inserts in chunks of 500 rows to stay within API limits.
  ─────────────────────────────────────────────────────────────── */

  async saveTransactions(fileId, fileObj, onProgress) {
    const CHUNK  = 500;
    const rows   = fileObj.rows;
    const hdrs   = fileObj.headers;
    const panCol = fileObj.panCol;
    const total  = rows.length;

    for (let start = 0; start < total; start += CHUNK) {
      const chunk   = rows.slice(start, start + CHUNK);
      const payload = chunk.map((row, i) => {
        const rawFields = {};
        hdrs.forEach((h, ci) => { rawFields[h] = row[ci] ?? ''; });
        return {
          file_id        : fileId,
          row_num        : start + i + 1,
          settlement_date: _settlementDate(fileObj),
          pan_masked     : panCol >= 0 ? (row[panCol] ?? '') : null,
          amount         : _amount(row, hdrs),
          currency       : _currency(row, hdrs),
          rrn            : _field(row, hdrs, ['RRN', 'rrn']),
          acq_iin        : _field(row, hdrs, ['ACQ IIN Code', 'ACQ Institution ID Code']),
          fwd_iin        : _field(row, hdrs, ['Forward IIN Code', 'Forwarding Institution ID Code']),
          msg_type       : _field(row, hdrs, ['Message Type']),
          processing_code: _field(row, hdrs, ['Processing Code']),
          respond_code   : _field(row, hdrs, ['Respond Code', 'Auth ID Respond']),
          raw_fields     : rawFields
        };
      });

      await _dbFetch('/rest/v1/transactions', {
        method : 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify(payload)
      }, 'settlement');

      if (onProgress) {
        onProgress(Math.round(((start + chunk.length) / total) * 100));
      }
    }
  },

  async getTransactions(fileId, search = '', limit = 1000) {
    let path = `/rest/v1/transactions?file_id=eq.${fileId}&order=row_num.asc&limit=${limit}`;
    if (search) {
      path += `&or=(rrn.ilike.*${encodeURIComponent(search)}*,pan_masked.ilike.*${encodeURIComponent(search)}*)`;
    }
    return _dbFetch(path, {}, 'settlement');
  },

  /* ── Audit logs ─────────────────────────────────────────────────
     audit.activity_logs — immutable action trail
     Silent — never throws (logging must not break the app flow)
  ─────────────────────────────────────────────────────────────── */

  async log(action, resource = '', payload = {}, result = 'SUCCESS') {
    try {
      await _dbFetch('/rest/v1/activity_logs', {
        method : 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body   : JSON.stringify({ action, resource, payload, result })
      }, 'audit');
    } catch (e) {
      console.warn('[DB audit] Failed to log:', action, e.message);
    }
  },

  async getLogs(limit = 100) {
    return _dbFetch(`/rest/v1/activity_logs?select=*&order=created_at.desc&limit=${limit}`, {}, 'audit');
  },

  /* ── Schemes ────────────────────────────────────────────────────
     settlement.schemes — UPI, VISA, MASTERCARD, LOCAL
  ─────────────────────────────────────────────────────────────── */

  async getSchemes() {
    return _dbFetch('/rest/v1/schemes?select=*&order=code.asc', {}, 'settlement');
  }
};