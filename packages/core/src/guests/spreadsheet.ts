import { XMLParser } from 'fast-xml-parser';
import { Inflate, zipSync } from 'fflate';
import { DomainError } from '../shared/errors';

/**
 * Reading and writing spreadsheets without trusting them. Uploads are identified by their
 * bytes, not their name; only the first sheet's cell values are read (formulas are never
 * evaluated, only the value Excel last saved); macros, legacy .xls and encrypted files are
 * refused; decompression is counted byte by byte so a small file can't expand without limit.
 */

export const IMPORT_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 50,
  maxCellChars: 2000,
  /** Total bytes the parts we read may inflate to. */
  maxInflatedBytes: 60 * 1024 * 1024,
  maxZipEntries: 2000,
} as const;

export type SpreadsheetKind = 'xlsx' | 'csv';

export interface Sheet {
  kind: SpreadsheetKind;
  /** Rows as text cells, first row first. Blank rows are kept so row numbers match the file. */
  rows: string[][];
}

/* ------------------------------------------------------------------------------------------ */
/* Sniffing                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export function sniff(bytes: Uint8Array): 'zip' | 'ole' | 'text' | 'binary' {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  // UTF-16 text starts with a byte order mark and contains NULs; allow it.
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return 'text';
  const probe = bytes.subarray(0, 8192);
  return probe.includes(0) ? 'binary' : 'text';
}

/** Reads an uploaded .xlsx or .csv. Throws a DomainError naming what is wrong with the file. */
export function readSpreadsheet(bytes: Uint8Array): Sheet {
  if (bytes.length === 0) throw new DomainError('file_empty');
  if (bytes.length > IMPORT_LIMITS.maxFileBytes) throw new DomainError('file_too_large');
  switch (sniff(bytes)) {
    case 'zip':
      return { kind: 'xlsx', rows: readXlsx(bytes) };
    case 'ole':
      // Legacy .xls, .xlsm saved as binary, or an encrypted workbook: all the same container.
      throw new DomainError('file_legacy_xls');
    case 'text':
      return { kind: 'csv', rows: readCsv(decodeText(bytes)) };
    default:
      throw new DomainError('file_unsupported');
  }
}

/* ------------------------------------------------------------------------------------------ */
/* ZIP (only what .xlsx needs: stored and deflated entries, no zip64, no encryption)           */
/* ------------------------------------------------------------------------------------------ */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  dataStart: number;
}

function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const unreadable = () => new DomainError('file_unreadable');
  // End of central directory: the last 22 bytes plus up to 64 KB of comment.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable();
  const total = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total > IMPORT_LIMITS.maxZipEntries || cdOffset === 0xffffffff) throw unreadable();

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || view.getUint32(p, true) !== 0x02014b50) throw unreadable();
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new DomainError('file_legacy_xls'); // encrypted
    if (localOffset + 30 > b.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw unreadable();
    }
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > b.length) throw unreadable();
    entries.set(name, { name, method, compressedSize, dataStart });
  }
  return entries;
}

/** Inflates one entry, counting output against the shared budget. */
function extract(b: Uint8Array, entry: ZipEntry, budget: { left: number }): Uint8Array {
  const data = b.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.method === 0) {
    budget.left -= data.length;
    if (budget.left < 0) throw new DomainError('file_too_large');
    return data;
  }
  if (entry.method !== 8) throw new DomainError('file_unreadable');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const inflate = new Inflate((chunk) => {
    size += chunk.length;
    budget.left -= chunk.length;
    if (budget.left < 0) throw new DomainError('file_too_large');
    chunks.push(chunk);
  });
  // Small input steps keep each burst of output bounded (deflate expands at most ~1000:1).
  const STEP = 4096;
  try {
    for (let i = 0; i < data.length; i += STEP) {
      inflate.push(data.subarray(i, i + STEP), i + STEP >= data.length);
    }
    if (data.length === 0) inflate.push(new Uint8Array(0), true);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('file_unreadable');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* XLSX                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'Override'].includes(name),
});

function parseXml(bytes: Uint8Array): Record<string, unknown> {
  const text = new TextDecoder().decode(bytes);
  // No document type definitions: they are how entity-expansion attacks work, and xlsx has none.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new DomainError('file_unreadable');
  try {
    return xml.parse(text) as Record<string, unknown>;
  } catch {
    throw new DomainError('file_unreadable');
  }
}

type Node = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Text of a <t> element, which the parser gives as a string or {#text, @space}. */
function textOf(t: unknown): string {
  if (t === undefined || t === null) return '';
  if (typeof t === 'string' || typeof t === 'number') return String(t);
  if (Array.isArray(t)) return t.map(textOf).join('');
  const v = (t as Node)['#text'];
  return v === undefined ? '' : String(v);
}

/** A shared or inline string: plain <t>, or rich-text runs <r><t>; phonetic hints are skipped. */
function stringItem(si: Node | undefined): string {
  if (!si) return '';
  if (si.t !== undefined) return textOf(si.t);
  return asArray(si.r as Node[] | undefined)
    .map((r) => textOf(r.t))
    .join('');
}

function resolveTarget(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function columnIndex(ref: string | undefined): number | null {
  const m = /^([A-Z]{1,3})[0-9]+$/.exec(ref ?? '');
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(b: Uint8Array): string[][] {
  const entries = zipEntries(b);
  const names = [...entries.keys()];
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) throw new DomainError('file_macro');
  const budget = { left: IMPORT_LIMITS.maxInflatedBytes };
  const read = (name: string) => {
    const e = entries.get(name);
    return e ? extract(b, e, budget) : null;
  };

  const types = read('[Content_Types].xml');
  const workbookBytes = read('xl/workbook.xml');
  if (!types || !workbookBytes) {
    // A zip that isn't a workbook (.docx, .xlsb, an archive of files).
    throw new DomainError('file_unsupported');
  }
  if (/macroEnabled/i.test(new TextDecoder().decode(types))) throw new DomainError('file_macro');

  const workbook = parseXml(workbookBytes).workbook as Node | undefined;
  const firstSheet = asArray(
    (workbook?.sheets as Node | undefined)?.sheet as Node[] | undefined,
  )[0];
  const relId = firstSheet?.['@id'] as string | undefined;
  const relsBytes = read('xl/_rels/workbook.xml.rels');
  if (!relId || !relsBytes) throw new DomainError('file_unreadable');
  const rels = asArray(
    (parseXml(relsBytes).Relationships as Node | undefined)?.Relationship as Node[] | undefined,
  );
  const sheetRel = rels.find((r) => r['@Id'] === relId);
  const sstRel = rels.find((r) => String(r['@Type'] ?? '').endsWith('/sharedStrings'));
  const sheetBytes = sheetRel ? read(resolveTarget(String(sheetRel['@Target']))) : null;
  if (!sheetBytes) throw new DomainError('file_unreadable');

  const sstBytes = read(sstRel ? resolveTarget(String(sstRel['@Target'])) : 'xl/sharedStrings.xml');
  const shared = sstBytes
    ? asArray((parseXml(sstBytes).sst as Node | undefined)?.si as Node[] | undefined).map(
        stringItem,
      )
    : [];

  const sheetData = ((parseXml(sheetBytes).worksheet as Node | undefined)?.sheetData ?? {}) as Node;
  const out: string[][] = [];
  let nextRow = 1;
  for (const row of asArray(sheetData.row as Node[] | undefined)) {
    const r = Number(row['@r']);
    const rowNumber = Number.isInteger(r) && r >= nextRow ? r : nextRow;
    // Header plus data rows; one extra lets the caller report "too many rows".
    if (rowNumber > IMPORT_LIMITS.maxRows + 2) break;
    while (out.length < rowNumber - 1) out.push([]);
    const cells: string[] = [];
    let nextCol = 0;
    for (const c of asArray(row.c as Node[] | undefined)) {
      const col = columnIndex(c['@r'] as string | undefined) ?? nextCol;
      nextCol = col + 1;
      if (col >= IMPORT_LIMITS.maxColumns) continue;
      cells[col] = cellValue(c, shared).slice(0, IMPORT_LIMITS.maxCellChars);
    }
    out.push(Array.from(cells, (v) => v ?? ''));
    nextRow = rowNumber + 1;
  }
  return out;
}

/** The value Excel saved for a cell. Formulas (<f>) are ignored; only the cached <v> is read. */
function cellValue(c: Node, shared: string[]): string {
  const type = (c['@t'] as string | undefined) ?? 'n';
  if (type === 'inlineStr') return stringItem(c.is as Node | undefined);
  const v = textOf(c.v);
  switch (type) {
    case 's':
      return shared[Number(v)] ?? '';
    case 'b':
      return v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
    case 'e':
      return ''; // #N/A, #REF! …: no value
    case 'n':
      return numberText(v);
    default:
      return v; // str (formula text result), d (ISO date)
  }
}

/** Excel stores 966551234567 as-is but may write 9.66551234567E+11; expand that exactly. */
function numberText(v: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(v.trim());
  if (!m) return v.trim();
  const [, sign, int, frac = '', exp] = m;
  const e = Number(exp);
  if (e > 20 || frac.length > e) return v.trim();
  return `${sign}${int}${frac.padEnd(e, '0')}`.replace(/^(-?)0+(?=\d)/, '$1');
}

/* ------------------------------------------------------------------------------------------ */
/* CSV                                                                                         */
/* ------------------------------------------------------------------------------------------ */

/** UTF-8 (with or without BOM), UTF-16 with BOM, or Windows Arabic (what older Excel saves). */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    try {
      return new TextDecoder('windows-1256', { fatal: true }).decode(bytes);
    } catch {
      throw new DomainError('file_unreadable');
    }
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [',', ';', '\t', '،'].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ',';
}

/** RFC 4180 CSV: quoted fields may hold delimiters, quotes ("") and line breaks. */
export function readCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    if (row.length < IMPORT_LIMITS.maxColumns) row.push(field.slice(0, IMPORT_LIMITS.maxCellChars));
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row.every((c) => c === '') ? [] : row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === '\n' || ch === '\r') {
      endRow();
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (rows.length > IMPORT_LIMITS.maxRows + 1) return rows;
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
/* Writing (template and error report)                                                        */
/* ------------------------------------------------------------------------------------------ */

/**
 * Makes a cell safe to open in a spreadsheet: text starting with = + - @ (or a tab or carriage
 * return) could run as a formula, so it gets a leading apostrophe. Plain phone numbers such as
 * +966551234567 are left as they are; they can't do anything.
 */
export function escapeFormula(value: string): string {
  if (/^\+?[0-9][0-9\s]*$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
function xmlText(value: string): string {
  return value
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"]/g, (c) => XML_ESCAPES[c]!);
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

export interface SheetColumn {
  header: string;
  width: number;
  /** Stored as text so Excel keeps leading zeros (phone numbers). */
  text?: boolean;
}

/**
 * A one-sheet .xlsx: right-to-left, bold frozen header, every cell an inline string (so
 * nothing is ever interpreted as a formula), with formula-like text escaped as well.
 */
export function writeXlsx(sheetName: string, columns: SheetColumn[], rows: string[][]): Uint8Array {
  const enc = new TextEncoder();
  const cols = columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.text ? ' style="2"' : ''}/>`,
    )
    .join('');
  const cell = (value: string, ref: string, style: number) =>
    value === ''
      ? ''
      : `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlText(escapeFormula(value))}</t></is></c>`;
  const header = `<row r="1">${columns.map((c, i) => cell(c.header, `${columnName(i)}1`, 1)).join('')}</row>`;
  const body = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 2}">${r
          .map((v, ci) => cell(v, `${columnName(ci)}${ri + 2}`, columns[ci]?.text ? 2 : 0))
          .join('')}</row>`,
    )
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': enc.encode(sheet),
  };
  return zipSync(files, { level: 6 });
}
