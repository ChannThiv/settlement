/* ═══════════════════════════════════════════════════════════════════
   IFD FILE PARSER SYSTEM — FORMATS & VBA CORE LOGIC
   formats.js

   This file contains:
   1. VBA Core Logic  — maskPan, getParsingMethod, cleanRawText
   2. Format Configs  — all 7 file format definitions with headers & parsers
   3. parseFileContent — main dispatcher that returns structured data

   To add a new format:
   - Add a new key to FORMATS object below
   - Define: label, color, headers[], panCol, and either parse() or widths[]
   - Update getParsingMethod() to detect the new filename pattern
═══════════════════════════════════════════════════════════════════ */


/* ─── VBA CORE LOGIC ────────────────────────────────────────────────────────
   These functions are direct JavaScript ports of the original VBA macros.
   Do NOT change logic here unless the source VBA spec changes.
─────────────────────────────────────────────────────────────────────────── */

/**
 * maskPan()
 * Mirrors VBA: MaskPan(panValue As String)
 * Keeps first 6 and last 4 digits, masks the middle with asterisks.
 * If card number is shorter than 10 chars, masks everything.
 *
 * @param {string} pan - Raw PAN value from file
 * @returns {string} - Masked PAN string
 */
function maskPan(pan) {
  const clean = String(pan).trim();
  const len = clean.length;
  if (len >= 10) {
    return clean.slice(0, 6) + '*'.repeat(len - 10) + clean.slice(-4);
  }
  return '*'.repeat(len);
}


/**
 * getParsingMethod()
 * Mirrors VBA: GetParsingMethod(fileName As String)
 * Detects which format to use based on the first 3 and last 3 characters
 * of the filename (case-insensitive).
 *
 * Detection rules:
 *  ifo + contains "bin" → FixedWidth_Format1_IFO_BIN
 *  ifd + ends "com"     → FixedWidth_Format2_IFD_ICOM
 *  ifd + ends "omn"     → FixedWidth_Format3_IFD_COMN
 *  ifd + ends "dtl"     → FixedWidth_Format4_IFD_FDTL
 *  ifd + ends "err"     → FixedWidth_Format5_IFD_ERR
 *  ifd + ends "rrn"     → FixedWidth_Format6_IFD_ERRN
 *  anything else        → RawText
 *
 * @param {string} fileName - Name of the uploaded file
 * @returns {string} - Format key matching a key in FORMATS object
 */
function getParsingMethod(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.length < 7) return 'RawText';

  const first3 = lower.slice(0, 3);
  const last3  = lower.slice(-3);

  if (first3 === 'ifo' && lower.includes('bin')) return 'FixedWidth_Format1_IFO_BIN';
  if (first3 === 'ifd' && last3 === 'com')        return 'FixedWidth_Format2_IFD_ICOM';
  if (first3 === 'ifd' && last3 === 'omn')        return 'FixedWidth_Format3_IFD_COMN';
  if (first3 === 'ifd' && last3 === 'dtl')        return 'FixedWidth_Format4_IFD_FDTL';
  if (first3 === 'ifd' && last3 === 'err')        return 'FixedWidth_Format5_IFD_ERR';
  if (first3 === 'ifd' && last3 === 'rrn')        return 'FixedWidth_Format6_IFD_ERRN';
  return 'RawText';
}


/**
 * buildStartPositions()
 * Computes start character positions from a widths array.
 * VBA rule: startPos[i] = startPos[i-1] + widths[i-1] + 1  (1-space separator)
 *
 * @param {number[]} widths - Array of column widths
 * @returns {number[]} - Array of 0-based start positions
 */
function buildStartPositions(widths) {
  const positions = [0];
  for (let i = 1; i < widths.length; i++) {
    positions.push(positions[i - 1] + widths[i - 1] + 1);
  }
  return positions;
}


/**
 * cleanRawText()
 * Mirrors VBA: RawText cleaning steps inside ImportAndParseFile()
 * Strips control characters, non-printable chars, keeps ASCII 32–126 only.
 * Converts tabs to spaces. Truncates at 32767 chars (Excel cell limit).
 *
 * @param {string} line - Raw line from file
 * @returns {string} - Cleaned printable string
 */
function cleanRawText(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code === 0 || code === 10 || code === 13) continue; // null, LF, CR
    if (code === 160) { out += ' '; continue; }             // non-breaking space
    if (code === 9)   { out += ' '; continue; }             // tab → space
    if (code >= 32 && code <= 126) out += line[i];          // printable ASCII only
  }
  return out.length > 32767 ? out.slice(0, 32767) : out;
}


/* ─── FORMAT DEFINITIONS ────────────────────────────────────────────────────
   Each format has:
     label   : Short display name shown in UI
     color   : Accent color for this format's tab/badge
     headers : Exact column header names (matches VBA Cells(1,n).Value)
     panCol  : 0-based column index of PAN field (-1 if no PAN masking)
     parse() : Function for absolute-position formats (Format 1 & 4)
     widths[]: Array of column widths for dynamic-position formats (2,3,5,6)
─────────────────────────────────────────────────────────────────────────── */
const FORMATS = {

  /* ── FORMAT 1: IFO BIN ─────────────────────────────────────────
     File pattern : filename starts with "ifo" AND contains "bin"
     Columns      : 21
     Method       : Absolute character positions (Mid() in VBA)
     PAN masking  : None (no PAN column in this format)
  ────────────────────────────────────────────────────────────── */
  FixedWidth_Format1_IFO_BIN: {
    label : 'IFO BIN',
    color : '#00E5FF',
    panCol: -1,
    headers: [
      'Issuer BIN', 'Issuer Name', 'Card Level', 'Issuing Region',
      'Card Product', 'PCT Business Type', 'Billing Currency2',
      'Billing Currency3', 'Prepaid Card Real', 'VCC Product code',
      'Reserved', 'BIN Length', 'BIN', 'PAN Length', 'Card Type',
      'Single/Dual Message', 'Billing Currency1',
      'Transaction Type Support', 'Transaction Channel Support',
      'Network Open', 'End Tage'
    ],
    // [start_1based, length] — converted to slice(start-1, start-1+length)
    parse(line) {
      if (line.length < 19) return null;
      const positions = [
        [1,11], [12,60], [72,1],  [73,4],  [77,2],
        [79,16],[95,3],  [98,3],  [101,1], [102,2],
        [104,8],[112,2], [114,12],[126,2], [128,1],
        [129,1],[130,3], [133,13],[146,12],[158,1],[159,2]
      ];
      return positions.map(([s, l]) => line.slice(s - 1, s - 1 + l).trim());
    }
  },

  /* ── FORMAT 2: IFD ICOM ────────────────────────────────────────
     File pattern : starts "ifd", ends "com"
     Columns      : 37
     Method       : Widths array + 1-space separator
     PAN masking  : Column index 4 (5th column)
  ────────────────────────────────────────────────────────────── */
  FixedWidth_Format2_IFD_ICOM: {
    label : 'IFD ICOM',
    color : '#69FF47',
    panCol: 4,
    headers: [
      'ACQ IIN Code', 'Forward IIN Code', 'Trace',
      'Transmit date and Time', 'PAN', 'Amount Tran',
      'Message Type', 'Processing Code', 'Merchant Type',
      'Card Acceptor Terminal ID', 'Card Acceptor ID Code',
      'Card Acceptor Name/Location', 'RRN',
      'Point of Service condition code',
      'Authorization identification respond',
      'Receiving institution code', 'Trace original tran',
      'Respond Code', 'Currency Code', 'Point of service entry mode',
      'Currency code,Settlement', 'Amount,Settlement',
      'Conversion Rate, Settlement', 'Settlement Date',
      'Exchange Date', 'Cardholder Billing currency',
      'Cardholder Billing amount', 'Cardholder Billing exchange Rate',
      'Fee receivable (settlement currency',
      'Fee payable(settlement currency)',
      'Additional installment Payment commission fee',
      'Service Fee currency', 'Service Fee exchange Rate',
      'Transaction Fee', 'RF Billing Currency',
      'Exchange Rate from RF billing currency', 'Reserved for use'
    ],
    widths: [11,11,6,10,19,12,4,6,4,8,15,40,12,2,6,11,6,2,3,3,3,12,8,4,4,3,12,8,12,12,12,3,8,12,3,8,30]
  },

  /* ── FORMAT 3: IFD COMN ────────────────────────────────────────
     File pattern : starts "ifd", ends "omn"
     Columns      : 56 (Format 2 headers + 19 extended fields)
     Method       : Widths array + 1-space separator
     PAN masking  : Column index 4 (5th column)
  ────────────────────────────────────────────────────────────── */
  FixedWidth_Format3_IFD_COMN: {
    label : 'IFD COMN',
    color : '#FF6B35',
    panCol: 4,
    headers: [
      // First 37 cols same as Format 2
      'ACQ IIN Code', 'Forward IIN Code', 'Trace',
      'Transmit date and Time', 'PAN', 'Amount Tran',
      'Message Type', 'Processing Code', 'Merchant Type',
      'Card Acceptor Terminal ID', 'Card Acceptor ID Code',
      'Card Acceptor Name/Location', 'RRN',
      'Point of Service condition code',
      'Authorization identification respond',
      'Receiving institution code', 'Trace original tran',
      'Respond Code', 'Currency Code', 'Point of service entry mode',
      'Currency code,Settlement', 'Amount,Settlement',
      'Conversion Rate, Settlement', 'Settlement Date',
      'Exchange Date', 'Cardholder Billing currency',
      'Cardholder Billing amount', 'Cardholder Billing exchange Rate',
      'Fee receivable (settlement currency',
      'Fee payable(settlement currency)',
      'Additional installment Payment commission fee',
      'Service Fee currency', 'Service Fee exchange Rate',
      'Transaction Fee', 'RF Billing Currency',
      'Exchange Rate from RF billing currency', 'Reserved for use',
      // Extended cols 38–56
      'Reserved', 'Reserved', 'Reserved', 'Reserved', 'Reserved',
      'Card Product', 'Account Attribute', 'Token',
      'UPI Standard/Non-Standard Card Indicator',
      'B2B Business Type', 'B2B Payment medium', 'Wallet ID',
      'Reserved', 'Special pricing indicator',
      'Transaction Scenario Indicator',
      'Reserved', 'Reserved', 'Reserved', 'Reserved'
    ],
    widths: [11,11,6,10,19,12,4,6,4,8,15,40,12,2,6,11,6,2,3,3,3,12,8,4,4,3,12,8,12,12,12,3,8,12,3,8,30,40,4,1,16,60,2,2,19,1,2,1,8,8,2,3,2,30,12,68]
  },

  /* ── FORMAT 4: IFD FDTL ────────────────────────────────────────
     File pattern : starts "ifd", ends "dtl"
     Columns      : 35
     Method       : Absolute character positions (Mid() in VBA)
     PAN masking  : Column index 4 (5th column)
  ────────────────────────────────────────────────────────────── */
  FixedWidth_Format4_IFD_FDTL: {
    label : 'IFD FDTL',
    color : '#FFD700',
    panCol: 4,
    headers: [
      'ACQ Institution ID Code', 'Forwarding Institution ID Code',
      'Trace', 'Transmition Date/Time', 'PAN',
      'Card Acceptor ID Code', 'Authorization ID Code',
      'Reversal Identification', 'Transaction Type Identification',
      'Receiving Institution Identification Code',
      'ISS Institution Identification Code',
      'Currency Code, Settlement', 'Total fee ID',
      'Total Fee Debit/Credit Identification', 'Total Fee Amount',
      'Total reimbursement fee ID',
      'Total reimbursement fee debit/credit identification',
      'Total reimbursement fee amount', 'Total service fee ID',
      'Toal service fee debit/credit', 'Total service fee amount',
      'Reserved field', 'Number of detailed fee field',
      'Detailed fee 1 ID',
      'Revers fee idenfication 0 original,1 reverse fee',
      'Detailed fee 1 debit/credit', 'Detailed fee 1 amount',
      'Detailed fee 2 ID', 'Detailed fee 2 reverse fee identification',
      'Detailed fee 2 debit/credit', 'Detailed fee 2 amount',
      'Detailed fee n ID', 'Detailed fee n reverse fee identification',
      'Detailed fee n debit/credit', 'Detailed fee n amount'
    ],
    parse(line) {
      if (line.length < 19) return null;
      const positions = [
        [1,11], [12,11], [23,6],  [29,10], [39,19],
        [58,15],[73,6],  [79,1],  [80,1],  [81,11],
        [92,11],[103,3], [106,4], [110,1], [111,16],
        [127,4],[131,1], [132,16],[148,4], [152,1],
        [153,16],[169,50],[219,3],[222,4], [226,1],
        [227,1],[228,16],[244,4], [248,1], [249,1],
        [250,16],[266,4],[270,1], [271,1], [272,16]
      ];
      return positions.map(([s, l], i) => {
        const val = line.slice(s - 1, s - 1 + l).trim();
        return i === 4 ? maskPan(val) : val;   // column 5 = PAN
      });
    }
  },

  /* ── FORMAT 5: IFD ERR ─────────────────────────────────────────
     File pattern : starts "ifd", ends "err"
     Columns      : 35
     Method       : Widths array + 1-space separator
     PAN masking  : Column index 4 (5th column)
  ────────────────────────────────────────────────────────────── */
  FixedWidth_Format5_IFD_ERR: {
    label : 'IFD ERR',
    color : '#FF4757',
    panCol: 4,
    headers: [
      'ACQ Institution ID Code', 'Forwarding Institution ID Code',
      'Trace', 'Transmition Date/Time', 'PAN', 'Tran Amount',
      'Message Type', 'Processing code', 'Merchant Type',
      'Card Acceptor Terminal ID', 'ISS Institution Identification Code',
      'Card Acceptor Location', 'RRN',
      'Point of Service condition code', 'Auth ID respond',
      'Receiving Institution id code',
      'System trace audit of original', 'Respond Code',
      'Currency Code txn', 'Point of service entry mode',
      'currency code settlment', 'Amount Settlement',
      'Converstion Rate Settlement', 'Settlment Date', 'Exchange date',
      'Cardholder billing currency', 'Cardholder billing amount',
      'Cardholder billing exchange rate', 'Fee receivable',
      'Fee Payable',
      'Additional installment payment comfission fee',
      'Transaction Fee', 'Original transaction date/time',
      'Original transaction processing code', 'Reserved for use'
    ],
    widths: [11,11,6,10,19,12,4,6,4,8,15,40,12,2,6,11,6,2,3,3,3,12,8,4,4,3,12,8,12,12,12,12,10,6,30]
  },

  /* ── FORMAT 6: IFD ERRN ────────────────────────────────────────
     File pattern : starts "ifd", ends "rrn"
     Columns      : 35 (identical structure to Format 5 / IFD ERR)
     Method       : Widths array + 1-space separator
     PAN masking  : Column index 4 (5th column)
  ────────────────────────────────────────────────────────────── */
  FixedWidth_Format6_IFD_ERRN: {
    label : 'IFD ERRN',
    color : '#A855F7',
    panCol: 4,
    headers: [
      'ACQ Institution ID Code', 'Forwarding Institution ID Code',
      'Trace', 'Transmition Date/Time', 'PAN', 'Tran Amount',
      'Message Type', 'Processing code', 'Merchant Type',
      'Card Acceptor Terminal ID', 'ISS Institution Identification Code',
      'Card Acceptor Location', 'RRN',
      'Point of Service condition code', 'Auth ID respond',
      'Receiving Institution id code',
      'System trace audit of original', 'Respond Code',
      'Currency Code txn', 'Point of service entry mode',
      'currency code settlment', 'Amount Settlement',
      'Converstion Rate Settlement', 'Settlment Date', 'Exchange date',
      'Cardholder billing currency', 'Cardholder billing amount',
      'Cardholder billing exchange rate', 'Fee receivable',
      'Fee Payable',
      'Additional installment payment comfission fee',
      'Transaction Fee', 'Original transaction date/time',
      'Original transaction processing code', 'Reserved for use'
    ],
    widths: [11,11,6,10,19,12,4,6,4,8,15,40,12,2,6,11,6,2,3,3,3,12,8,4,4,3,12,8,12,12,12,12,10,6,30]
  },

  /* ── FALLBACK: Raw Text ────────────────────────────────────────
     Used for IFR* files and any unrecognized filename.
     No column splitting — returns full cleaned line as single column.
  ────────────────────────────────────────────────────────────── */
  RawText: {
    label : 'Raw Text',
    color : '#94A3B8',
    panCol: -1,
    headers: ['Raw Text']
  }

};


/* ─── MAIN PARSER DISPATCHER ────────────────────────────────────────────────
   Called once per file after it has been read as text.
   Routes to correct parsing strategy based on format method.

   @param {string} text   - Full file contents as plain text string
   @param {string} method - Format key from getParsingMethod()
   @returns {{ headers, rows, label, color, panCol }}
─────────────────────────────────────────────────────────────────────────── */
function parseFileContent(text, method) {
  const cfg   = FORMATS[method] || FORMATS.RawText;
  // Split on CR+LF, LF only, or CR only — handles all line ending styles
  const lines = text.split(/\r\n|\r|\n/);
  const rows  = [];

  // ── RawText: clean and return each line as single-column row ──────────────
  if (method === 'RawText') {
    for (const line of lines) {
      const clean = cleanRawText(line);
      if (clean.trim()) rows.push([clean]);
    }
    return { headers: cfg.headers, rows, label: cfg.label, color: cfg.color, panCol: -1 };
  }

  // ── Fixed-width with custom parse() function (Format 1 & 4) ──────────────
  if (cfg.parse) {
    for (const line of lines) {
      const trimmed = line.replace(/[\r\n]/g, '');
      if (!trimmed.trim()) continue;
      const parsed = cfg.parse(trimmed);
      if (parsed) {
        rows.push(parsed);
      } else {
        // Line too short — fill headers with empty, mark first col
        const partial = cfg.headers.map(() => '');
        partial[0] = `[Line too short: ${trimmed.length} chars]`;
        rows.push(partial);
      }
    }
    return { headers: cfg.headers, rows, label: cfg.label, color: cfg.color, panCol: cfg.panCol };
  }

  // ── Fixed-width with widths array (Format 2, 3, 5, 6) ────────────────────
  if (cfg.widths) {
    const starts = buildStartPositions(cfg.widths);
    const minLen = starts[starts.length - 1] + cfg.widths[cfg.widths.length - 1];

    // Log useful debug info to browser console (press F12 to see)
    console.log(`[IFD Parser] Format: ${method} | Min line length needed: ${minLen}`);

    for (const line of lines) {
      const trimmed = line.replace(/[\r\n]/g, '');  // strip stray CR/LF
      if (!trimmed.trim()) continue;

      if (trimmed.length < minLen) {
        // Line shorter than expected — parse what we can, empty the rest
        const partial = cfg.widths.map((w, i) => {
          const start = starts[i];
          if (start >= trimmed.length) return '';
          const val = trimmed.slice(start, start + w).trim();
          return i === cfg.panCol ? maskPan(val) : val;
        });
        if (!partial[0]) partial[0] = `[Short: ${trimmed.length}/${minLen}]`;
        rows.push(partial);
      } else {
        // Normal full-length line
        const row = cfg.widths.map((w, i) => {
          const val = trimmed.slice(starts[i], starts[i] + w).trim();
          return i === cfg.panCol ? maskPan(val) : val;
        });
        rows.push(row);
      }
    }
    return { headers: cfg.headers, rows, label: cfg.label, color: cfg.color, panCol: cfg.panCol };
  }

  // Fallback
  return { headers: cfg.headers, rows: [], label: cfg.label, color: cfg.color, panCol: -1 };
}

