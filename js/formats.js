/* ═══════════════════════════════════════════════════════════════════
   CHANN THIV SETTLEMENT — FILE FORMAT DEFINITIONS & PARSER
   js/formats.js  |  v2.1

   JavaScript port of VBA macro logic.
   Depends on: nothing (loads first)

   Public API:
     FORMATS                         — format config registry
     getParsingMethod(filename)      → format key string
     parseFileContent(text, method)  → { headers, rows, label, color, panCol }
═══════════════════════════════════════════════════════════════════ */


/* ── PAN masking ────────────────────────────────────────────────────
   VBA: MaskPan(panValue As String)
   - Trim whitespace
   - If length >= 10: first 6 + "*" × (length-10) + last 4
   - Else: all "*"
─────────────────────────────────────────────────────────────────── */
function maskPan(pan) {
  const s = String(pan).trim();
  const n = s.length;
  if (n >= 10) return s.slice(0, 6) + '*'.repeat(n - 10) + s.slice(-4);
  return '*'.repeat(n);
}


/* ── Format detection ───────────────────────────────────────────────
   VBA: GetParsingMethod(fileName As String)
   Rules (case-insensitive, first 3 + last 3 characters):
     ifo + contains "bin" → FixedWidth_Format1_IFO_BIN
     ifd + ends "com"     → FixedWidth_Format2_IFD_ICOM
     ifd + ends "omn"     → FixedWidth_Format3_IFD_COMN
     ifd + ends "dtl"     → FixedWidth_Format4_IFD_FDTL
     ifd + ends "err"     → FixedWidth_Format5_IFD_ERR
     ifd + ends "rrn"     → FixedWidth_Format6_IFD_ERRN
     anything else        → RawText
─────────────────────────────────────────────────────────────────── */
function getParsingMethod(fileName) {
  const low = fileName.toLowerCase();
  if (low.length < 7) return 'RawText';

  const f3 = low.slice(0, 3);
  const l3 = low.slice(-3);

  if (f3 === 'ifo' && low.includes('bin')) return 'FixedWidth_Format1_IFO_BIN';
  if (f3 === 'ifd' && l3 === 'com')        return 'FixedWidth_Format2_IFD_ICOM';
  if (f3 === 'ifd' && l3 === 'omn')        return 'FixedWidth_Format3_IFD_COMN';
  if (f3 === 'ifd' && l3 === 'dtl')        return 'FixedWidth_Format4_IFD_FDTL';
  if (f3 === 'ifd' && l3 === 'err')        return 'FixedWidth_Format5_IFD_ERR';
  if (f3 === 'ifd' && l3 === 'rrn')        return 'FixedWidth_Format6_IFD_ERRN';
  return 'RawText';
}


/* ── Start-position builder ─────────────────────────────────────────
   VBA rule: startPos[0]=0, startPos[i] = startPos[i-1] + widths[i-1] + 1
   The "+1" accounts for a single space separator between fields.
─────────────────────────────────────────────────────────────────── */
function _buildStarts(widths) {
  const starts = [0];
  for (let i = 1; i < widths.length; i++) {
    starts.push(starts[i - 1] + widths[i - 1] + 1);
  }
  return starts;
}


/* ── Raw text cleaner ───────────────────────────────────────────────
   VBA: RawText cleaning inside ImportAndParseFile()
   - Remove: Chr(0), Chr(10), Chr(13), Chr(160)
   - Convert Chr(9) tab → space
   - Keep ASCII 32–126 only
   - Truncate to 32767 chars (Excel cell limit)
─────────────────────────────────────────────────────────────────── */
function _cleanRaw(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 0 || c === 10 || c === 13) continue;
    if (c === 160) { out += ' '; continue; }
    if (c === 9)   { out += ' '; continue; }
    if (c >= 32 && c <= 126) out += line[i];
  }
  return out.length > 32767 ? out.slice(0, 32767) : out;
}


/* ── Format definitions ─────────────────────────────────────────────
   Each entry:
     label  : short display name
     color  : hex accent color for UI
     headers: exact column names (match VBA Cells(1,n).Value)
     panCol : 0-based index of PAN column (-1 = none)
     parse(): function for absolute-position formats (1 & 4)
     widths : column widths for separator-based formats (2,3,5,6)
─────────────────────────────────────────────────────────────────── */
const FORMATS = {

  /* ── FORMAT 1: IFO BIN ──────────────────────────────────────────
     21 columns · absolute character positions · no PAN masking
  ─────────────────────────────────────────────────────────────── */
  FixedWidth_Format1_IFO_BIN: {
    label : 'IFO BIN',
    color : '#00D4F5',
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
    // [1-based start, length]
    _positions: [
      [1,11],[12,60],[72,1],[73,4],[77,2],
      [79,16],[95,3],[98,3],[101,1],[102,2],
      [104,8],[112,2],[114,12],[126,2],[128,1],
      [129,1],[130,3],[133,13],[146,12],[158,1],[159,2]
    ],
    parse(line) {
      if (line.length < 19) return null;
      return this._positions.map(([s, l]) => line.slice(s - 1, s - 1 + l).trim());
    }
  },

  /* ── FORMAT 2: IFD ICOM ─────────────────────────────────────────
     37 columns · widths array · PAN col 4 (index)
  ─────────────────────────────────────────────────────────────── */
  FixedWidth_Format2_IFD_ICOM: {
    label : 'IFD ICOM',
    color : '#22C55E',
    panCol: 4,
    headers: [
      'ACQ IIN Code', 'Forward IIN Code', 'Trace', 'Transmit date and Time',
      'PAN', 'Amount Tran', 'Message Type', 'Processing Code', 'Merchant Type',
      'Card Acceptor Terminal ID', 'Card Acceptor ID Code',
      'Card Acceptor Name/Location', 'RRN',
      'Point of Service condition code',
      'Authorization identification respond',
      'Receiving institution code', 'Trace original tran', 'Respond Code',
      'Currency Code', 'Point of service entry mode',
      'Currency code,Settlement', 'Amount,Settlement',
      'Conversion Rate, Settlement', 'Settlement Date', 'Exchange Date',
      'Cardholder Billing currency', 'Cardholder Billing amount',
      'Cardholder Billing exchange Rate',
      'Fee receivable (settlement currency',
      'Fee payable(settlement currency)',
      'Additional installment Payment commission fee',
      'Service Fee currency', 'Service Fee exchange Rate',
      'Transaction Fee', 'RF Billing Currency',
      'Exchange Rate from RF billing currency', 'Reserved for use'
    ],
    widths: [11,11,6,10,19,12,4,6,4,8,15,40,12,2,6,11,6,2,3,3,3,12,8,4,4,3,12,8,12,12,12,3,8,12,3,8,30]
  },

  /* ── FORMAT 3: IFD COMN ─────────────────────────────────────────
     56 columns (Format 2 + 19 extended) · widths array · PAN col 4
  ─────────────────────────────────────────────────────────────── */
  FixedWidth_Format3_IFD_COMN: {
    label : 'IFD COMN',
    color : '#F97316',
    panCol: 4,
    headers: [
      // First 37 cols identical to Format 2
      'ACQ IIN Code', 'Forward IIN Code', 'Trace', 'Transmit date and Time',
      'PAN', 'Amount Tran', 'Message Type', 'Processing Code', 'Merchant Type',
      'Card Acceptor Terminal ID', 'Card Acceptor ID Code',
      'Card Acceptor Name/Location', 'RRN',
      'Point of Service condition code',
      'Authorization identification respond',
      'Receiving institution code', 'Trace original tran', 'Respond Code',
      'Currency Code', 'Point of service entry mode',
      'Currency code,Settlement', 'Amount,Settlement',
      'Conversion Rate, Settlement', 'Settlement Date', 'Exchange Date',
      'Cardholder Billing currency', 'Cardholder Billing amount',
      'Cardholder Billing exchange Rate',
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

  /* ── FORMAT 4: IFD FDTL ─────────────────────────────────────────
     35 columns · absolute character positions · PAN col 4
  ─────────────────────────────────────────────────────────────── */
  FixedWidth_Format4_IFD_FDTL: {
    label : 'IFD FDTL',
    color : '#EAB308',
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
    _positions: [
      [1,11],[12,11],[23,6],[29,10],[39,19],
      [58,15],[73,6],[79,1],[80,1],[81,11],
      [92,11],[103,3],[106,4],[110,1],[111,16],
      [127,4],[131,1],[132,16],[148,4],[152,1],
      [153,16],[169,50],[219,3],[222,4],[226,1],
      [227,1],[228,16],[244,4],[248,1],[249,1],
      [250,16],[266,4],[270,1],[271,1],[272,16]
    ],
    parse(line) {
      if (line.length < 19) return null;
      return this._positions.map(([s, l], i) => {
        const val = line.slice(s - 1, s - 1 + l).trim();
        return i === 4 ? maskPan(val) : val;
      });
    }
  },

  /* ── FORMAT 5: IFD ERR ──────────────────────────────────────────
     35 columns · widths array · PAN col 4
  ─────────────────────────────────────────────────────────────── */
  FixedWidth_Format5_IFD_ERR: {
    label : 'IFD ERR',
    color : '#EF4444',
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

  /* ── FORMAT 6: IFD ERRN ─────────────────────────────────────────
     35 columns · same widths as Format 5 · PAN col 4
  ─────────────────────────────────────────────────────────────── */
  FixedWidth_Format6_IFD_ERRN: {
    label : 'IFD ERRN',
    color : '#A78BFA',
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

  /* ── FALLBACK: Raw Text ─────────────────────────────────────────
     Any unrecognized filename — full cleaned line as single column
  ─────────────────────────────────────────────────────────────── */
  RawText: {
    label : 'Raw Text',
    color : '#94A3B8',
    panCol: -1,
    headers: ['Raw Text']
  }
};


/* ── Main parser dispatcher ─────────────────────────────────────────
   Routes to correct parsing strategy based on the detected format.

   @param {string} text   — full file contents as plain text
   @param {string} method — format key from getParsingMethod()
   @returns { headers, rows, label, color, panCol }
─────────────────────────────────────────────────────────────────── */
function parseFileContent(text, method) {
  const cfg   = FORMATS[method] || FORMATS.RawText;
  const lines = text.split(/\r\n|\r|\n/);
  const rows  = [];

  // ── RawText: clean and return each line as a single-column row ──
  if (method === 'RawText') {
    for (const line of lines) {
      const clean = _cleanRaw(line);
      if (clean.trim()) rows.push([clean]);
    }
    return { headers: cfg.headers, rows, label: cfg.label, color: cfg.color, panCol: -1 };
  }

  // ── Absolute-position format (Format 1 & 4 have a parse() fn) ───
  if (typeof cfg.parse === 'function') {
    for (const line of lines) {
      const t = line.replace(/[\r\n]/g, '');
      if (!t.trim()) continue;
      const parsed = cfg.parse(t);
      if (parsed) {
        rows.push(parsed);
      } else {
        const partial = cfg.headers.map(() => '');
        partial[0] = `[Line too short: ${t.length} chars]`;
        rows.push(partial);
      }
    }
    return { headers: cfg.headers, rows, label: cfg.label, color: cfg.color, panCol: cfg.panCol };
  }

  // ── Width-array format (Formats 2, 3, 5, 6) ─────────────────────
  if (cfg.widths) {
    const starts = _buildStarts(cfg.widths);
    const minLen = starts[starts.length - 1] + cfg.widths[cfg.widths.length - 1];

    console.log(`[Parser] ${method} — min line length: ${minLen}`);

    for (const line of lines) {
      const t = line.replace(/[\r\n]/g, '');
      if (!t.trim()) continue;

      const row = cfg.widths.map((w, i) => {
        const start = starts[i];
        if (start >= t.length) return '';
        const val = t.slice(start, start + w).trim();
        return i === cfg.panCol ? maskPan(val) : val;
      });

      // Tag first cell if line was shorter than expected
      if (t.length < minLen && !row[0]) {
        row[0] = `[Short: ${t.length}/${minLen}]`;
      }

      rows.push(row);
    }
    return { headers: cfg.headers, rows, label: cfg.label, color: cfg.color, panCol: cfg.panCol };
  }

  // Fallback — unknown format
  return { headers: cfg.headers, rows: [], label: cfg.label, color: cfg.color, panCol: -1 };
}
