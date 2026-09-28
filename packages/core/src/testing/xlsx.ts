import { strToU8, zipSync } from 'fflate';

/**
 * Builds .xlsx files the way Excel writes them (shared strings, numeric cells, formulas with
 * cached values) so the reader is tested against more than our own writer's output.
 */
export function excelLikeXlsx(
  rows: (string | number | { f: string; v: string } | null)[][],
  opts: { macro?: boolean; extra?: Record<string, Uint8Array>; secondSheet?: string[][] } = {},
): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = (s: string) => {
    const i = shared.indexOf(s);
    if (i >= 0) return i;
    shared.push(s);
    return shared.length - 1;
  };
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sheet = (data: typeof rows) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => {
              const ref = `${col(ci)}${ri + 1}`;
              if (v === null) return '';
              if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
              if (typeof v === 'object')
                return `<c r="${ref}" t="str"><f>${esc(v.f)}</f><v>${esc(v.v)}</v></c>`;
              return `<c r="${ref}" t="s"><v>${sharedIndex(v)}</v></c>`;
            })
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  const sheet1 = sheet(rows);
  const sheet2 = opts.secondSheet ? sheet(opts.secondSheet) : null;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
    .join('')}</sst>`;
  const mainType = opts.macro
    ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Guests" sheetId="1" r:id="rId3"/>${sheet2 ? '<sheet name="Other" sheetId="2" r:id="rId4"/>' : ''}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${sheet2 ? '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>' : ''}<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
    ...(sheet2 ? { 'xl/worksheets/sheet2.xml': strToU8(sheet2) } : {}),
    'xl/sharedStrings.xml': strToU8(sst),
    ...(opts.macro ? { 'xl/vbaProject.bin': new Uint8Array([1, 2, 3]) } : {}),
    ...opts.extra,
  });
}

export const TEMPLATE_ROW = [
  'الاسم',
  'رقم الجوال',
  'البريد الإلكتروني',
  'المجموعة',
  'عدد المرافقين المسموح',
  'ملاحظات',
];

/** `n` distinct valid guests: Saudi mobiles 0550000000 + i. */
export function guestRows(n: number, start = 0): string[][] {
  return Array.from({ length: n }, (_, i) => [
    `ضيف رقم ${start + i + 1}`,
    `05${String(50_000_000 + start + i).padStart(8, '0')}`,
    '',
    i % 3 === 0 ? 'العائلة' : i % 3 === 1 ? 'الأصدقاء' : '',
    String(i % 3),
    '',
  ]);
}
