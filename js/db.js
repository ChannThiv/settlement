/* ═══════════════════════════════════════════════════════════════════
   IFD FILE PARSER SYSTEM — SUPABASE DATABASE MODULE
   js/db.js

   This file handles ALL communication with Supabase.
   It provides simple functions that app.js calls — no Supabase
   details leak into the rest of the codebase.

   HOW TO CONFIGURE:
     1. Replace SUPABASE_URL with your project URL
        → Supabase Dashboard → Settings → API → Project URL
     2. Replace SUPABASE_ANON_KEY with your anon/public key
        → Supabase Dashboard → Settings → API → anon public

   TABLES USED:
     settlement.files        — one row per uploaded file
     settlement.transactions — one row per parsed data row
     audit.activity_logs     — one row per user action
═══════════════════════════════════════════════════════════════════ */


/* ─── CONFIGURATION ─────────────────────────────────────────────────────────
   ⚠️  REPLACE THESE TWO VALUES WITH YOUR OWN FROM SUPABASE DASHBOARD
─────────────────────────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';   // ← change this
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';                    // ← change this


/* ─── INTERNAL HELPERS ──────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

/**
 * dbFetch()
 * Base fetch wrapper for all Supabase REST API calls.
 * Handles headers, error checking, and JSON parsing in one place.
 *
 * @param {string} path    - API path e.g. '/rest/v1/settlement.files'
 * @param {object} options - fetch options (method, body, etc.)
 * @returns {Promise<any>} - parsed JSON response
 */
async function dbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type'  : 'application/json',
      'apikey'        : SUPABASE_ANON_KEY,
      'Authorization' : `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer'        : 'return=representation',   // return inserted rows
      ...options.headers
    }
  });

  // Handle empty responses (e.g. DELETE returns 204 No Content)
  if (response.status === 204) return null;

  const data = await response.json();

  if (!response.ok) {
    // Supabase returns { code, message, details, hint }
    const msg = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`[DB] ${msg}`);
  }

  return data;
}

/**
 * generateUUID()
 * Creates a UUID v4 string without any external library.
 * Used for file IDs before inserting into database.
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}


/* ─── DB STATUS ─────────────────────────────────────────────────────────────
─────────────────────────────────────────────────────────────────────────── */

/**
 * db.isConfigured()
 * Returns true if the URL and key have been filled in.
 * Used by the UI to show/hide the "Save to DB" button.
 */
const db = {

  isConfigured() {
    return (
      SUPABASE_URL      !== 'https://YOUR_PROJECT_REF.supabase.co' &&
      SUPABASE_ANON_KEY !== 'YOUR_ANON_PUBLIC_KEY' &&
      SUPABASE_URL.startsWith('https://')
    );
  },


  /* ─── FILES ───────────────────────────────────────────────────────────────
     settlement.files table — one record per uploaded IFD/IFO file
  ─────────────────────────────────────────────────────────────────────────── */

  /**
   * db.saveFile()
   * Inserts a file record into settlement.files.
   * Returns the inserted row (with its generated id).
   *
   * @param {object} fileObj - parsed file object from state.files[]
   * @returns {Promise<object>} - inserted row from Supabase
   */
  async saveFile(fileObj) {
    const payload = {
      file_name       : fileObj.name,
      format          : fileObj.method,
      file_size       : fileObj.size,
      row_count       : fileObj.rows.length,
      settlement_date : extractSettlementDate(fileObj),
      status          : 'PARSED'
    };

    const result = await dbFetch('/rest/v1/settlement.files', {
      method : 'POST',
      body   : JSON.stringify(payload)
    });

    // Supabase returns array when Prefer: return=representation
    return Array.isArray(result) ? result[0] : result;
  },


  /**
   * db.getFiles()
   * Fetches all file records, newest first.
   * Used to populate the file history list.
   *
   * @returns {Promise<object[]>}
   */
  async getFiles() {
    return dbFetch('/rest/v1/settlement.files?select=*&order=uploaded_at.desc');
  },


  /**
   * db.deleteFile()
   * Deletes a file record AND its related transactions.
   *
   * @param {string} fileId - UUID of the file to delete
   */
  async deleteFile(fileId) {
    // Delete transactions first (foreign key constraint)
    await dbFetch(
      `/rest/v1/settlement.transactions?file_id=eq.${fileId}`,
      { method: 'DELETE' }
    );
    // Then delete the file record
    await dbFetch(
      `/rest/v1/settlement.files?id=eq.${fileId}`,
      { method: 'DELETE' }
    );
  },


  /* ─── TRANSACTIONS ────────────────────────────────────────────────────────
     settlement.transactions — one record per parsed data row
     Uses batch insert (chunks of 500) to avoid request size limits
  ─────────────────────────────────────────────────────────────────────────── */

  /**
   * db.saveTransactions()
   * Batch-inserts all parsed rows for a file into settlement.transactions.
   * Processes in chunks of 500 rows to stay within Supabase limits.
   *
   * @param {string}   fileId  - UUID returned from saveFile()
   * @param {object}   fileObj - parsed file object from state.files[]
   * @param {Function} onProgress - callback(percent) for progress bar
   */
  async saveTransactions(fileId, fileObj, onProgress) {
    const CHUNK_SIZE = 500;
    const rows       = fileObj.rows;
    const headers    = fileObj.headers;
    const panCol     = fileObj.panCol;
    const total      = rows.length;

    // Map column index → header name for raw_fields JSONB
    for (let start = 0; start < total; start += CHUNK_SIZE) {
      const chunk   = rows.slice(start, start + CHUNK_SIZE);
      const payload = chunk.map((row, chunkIdx) => {
        // Build raw_fields as { "column_name": "value" }
        const rawFields = {};
        headers.forEach((h, i) => { rawFields[h] = row[i] ?? ''; });

        return {
          file_id         : fileId,
          row_num         : start + chunkIdx + 1,
          settlement_date : extractSettlementDate(fileObj),
          pan_masked      : panCol >= 0 ? (row[panCol] ?? '') : null,
          amount          : extractAmount(row, headers),
          currency        : extractCurrency(row, headers),
          rrn             : extractField(row, headers, ['RRN','rrn']),
          acq_iin         : extractField(row, headers, ['ACQ IIN Code','ACQ Institution ID Code']),
          fwd_iin         : extractField(row, headers, ['Forward IIN Code','Forwarding Institution ID Code']),
          msg_type        : extractField(row, headers, ['Message Type']),
          processing_code : extractField(row, headers, ['Processing Code']),
          respond_code    : extractField(row, headers, ['Respond Code','Auth ID Respond']),
          raw_fields      : rawFields
        };
      });

      await dbFetch('/rest/v1/settlement.transactions', {
        method  : 'POST',
        body    : JSON.stringify(payload),
        headers : { 'Prefer': 'return=minimal' }  // faster — don't return inserted rows
      });

      if (onProgress) {
        onProgress(Math.round(((start + chunk.length) / total) * 100));
      }
    }
  },


  /**
   * db.getTransactions()
   * Fetches transactions for a specific file with optional search filter.
   *
   * @param {string} fileId   - UUID of the file
   * @param {string} search   - optional search string
   * @param {number} limit    - max rows to return (default 1000)
   * @returns {Promise<object[]>}
   */
  async getTransactions(fileId, search = '', limit = 1000) {
    let path = `/rest/v1/settlement.transactions?file_id=eq.${fileId}&order=row_num.asc&limit=${limit}`;
    if (search) {
      // Search in RRN and PAN fields via ilike (case-insensitive)
      path += `&or=(rrn.ilike.*${encodeURIComponent(search)}*,pan_masked.ilike.*${encodeURIComponent(search)}*)`;
    }
    return dbFetch(path);
  },


  /* ─── AUDIT LOGS ──────────────────────────────────────────────────────────
     audit.activity_logs — tracks every user action
  ─────────────────────────────────────────────────────────────────────────── */

  /**
   * db.log()
   * Records a user action in audit.activity_logs.
   * Silent — never throws, so logging never breaks the main flow.
   *
   * @param {string} action   - e.g. 'UPLOAD_FILE', 'EXPORT_CSV', 'DELETE_FILE'
   * @param {string} resource - what was acted on, e.g. filename
   * @param {object} payload  - any extra data to store as JSONB
   * @param {string} result   - 'SUCCESS' | 'FAILURE' | 'DENIED'
   */
  async log(action, resource = '', payload = {}, result = 'SUCCESS') {
    try {
      await dbFetch('/rest/v1/audit.activity_logs', {
        method  : 'POST',
        body    : JSON.stringify({ action, resource, payload, result }),
        headers : { 'Prefer': 'return=minimal' }
      });
    } catch (e) {
      // Logging must never crash the app — swallow silently
      console.warn('[DB audit] Failed to log:', action, e.message);
    }
  },


  /**
   * db.getLogs()
   * Fetches recent activity logs, newest first.
   *
   * @param {number} limit - max rows (default 100)
   * @returns {Promise<object[]>}
   */
  async getLogs(limit = 100) {
    return dbFetch(`/rest/v1/audit.activity_logs?select=*&order=created_at.desc&limit=${limit}`);
  },


  /* ─── SCHEMES ─────────────────────────────────────────────────────────────
  ─────────────────────────────────────────────────────────────────────────── */

  /**
   * db.getSchemes()
   * Fetches all settlement schemes (UPI, VISA, MASTERCARD, LOCAL).
   *
   * @returns {Promise<object[]>}
   */
  async getSchemes() {
    return dbFetch('/rest/v1/settlement.schemes?select=*&order=code.asc');
  }

};  // end db object


/* ─── FIELD EXTRACTION HELPERS ──────────────────────────────────────────────
   These extract specific field values from a parsed row using header names.
   They are tolerant of different header names across format versions.
─────────────────────────────────────────────────────────────────────────── */

/**
 * extractField()
 * Finds the first matching header name from a list of candidates
 * and returns that column's value from the row.
 */
function extractField(row, headers, candidates) {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(candidate.toLowerCase()));
    if (idx >= 0 && row[idx]) return String(row[idx]).trim() || null;
  }
  return null;
}

/**
 * extractAmount()
 * Finds the transaction amount field and converts to a number.
 * Supabase expects NUMERIC — must not pass an empty string.
 */
function extractAmount(row, headers) {
  const raw = extractField(row, headers, ['Amount Tran', 'Tran Amount', 'Transaction Amount']);
  if (!raw) return null;
  const num = parseFloat(raw.replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? null : num;
}

/**
 * extractCurrency()
 * Extracts the 3-character currency code (e.g. 'USD', '840').
 */
function extractCurrency(row, headers) {
  const raw = extractField(row, headers, ['Currency Code', 'Currency code']);
  return raw ? raw.slice(0, 3) : null;
}

/**
 * extractSettlementDate()
 * Tries to parse a settlement date from the filename (YYMMDD pattern)
 * Falls back to today's date if not found.
 * Supabase expects ISO 8601: 'YYYY-MM-DD'
 */
function extractSettlementDate(fileObj) {
  // Try to find YYMMDD or YYYYMMDD in the filename
  const match = fileObj.name.match(/(\d{6,8})/);
  if (match) {
    const raw = match[1];
    try {
      if (raw.length === 8) {
        // YYYYMMDD
        return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      } else {
        // YYMMDD → assume 20xx
        return `20${raw.slice(0,2)}-${raw.slice(2,4)}-${raw.slice(4,6)}`;
      }
    } catch (e) { /* fall through */ }
  }
  // Fallback to today
  return new Date().toISOString().slice(0, 10);
}
