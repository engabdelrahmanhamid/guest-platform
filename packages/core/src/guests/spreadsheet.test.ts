import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { excelLikeXlsx, TEMPLATE_ROW } from '../testing/xlsx';
import { importTemplate, mapHeaders } from './import';
import { escapeFormula, IMPORT_LIMITS, readCsv, readSpreadsheet, writeXlsx } from './spreadsheet';

const code = (c: string) => expect.objectContaining({ code: c });

describe('reading spreadsheets', () => {
  it('reads an Excel-style workbook: shared strings, numbers, formulas by cached value', () => {
    const file = excelLikeXlsx([
      TEMPLATE_ROW,
      ['أحمد', 551234567, null, 'العائلة', 2, 'VIP'],
      [{ f: 'CONCAT("سارة"," علي")', v: 'سارة علي' }, 966501234567, 'a@b.sa', null, 0, null],
    ]);
    const { kind, rows } = readSpreadsheet(file);
    expect(kind).toBe('xlsx');
    expect(rows[0]).toEqual(TEMPLATE_ROW);
    expect(rows[1]).toEqual(['أحمد', '551234567', '', 'العائلة', '2', 'VIP']);
    // The formula is never evaluated: only the value Excel saved is read.
    expect(rows[2]).toEqual(['سارة علي', '966501234567', 'a@b.sa', '', '0']);
  });

  it('reads only the first sheet', () => {
    const file = excelLikeXlsx([['الاسم']], { secondSheet: [['secret']] });
    expect(readSpreadsheet(file).rows).toEqual([['الاسم']]);
  });

  it('expands numbers Excel wrote in scientific notation without losing digits', () => {
    const sheet = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1"><v>9.66551234567E+11</v></c><c r="C1"><v>2</v></c></row></sheetData></worksheet>',
    );
    const rows = readSpreadsheet(
      excelLikeXlsx([], { extra: { 'xl/worksheets/sheet1.xml': sheet } }),
    ).rows;
    expect(rows).toEqual([['966551234567', '', '2']]);
  });

  it('round-trips its own template and writes phone as a text column', () => {
    const rows = readSpreadsheet(importTemplate()).rows;
    expect(rows).toEqual([TEMPLATE_ROW]);
  });

  it('refuses macro workbooks, legacy .xls, random zips and binaries by content', () => {
    expect(() => readSpreadsheet(excelLikeXlsx([['a']], { macro: true }))).toThrow(
      code('file_macro'),
    );
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    expect(() => readSpreadsheet(ole)).toThrow(code('file_legacy_xls'));
    const docx = zipSync({
      'word/document.xml': strToU8('<w/>'),
      '[Content_Types].xml': strToU8('<T/>'),
    });
    expect(() => readSpreadsheet(docx)).toThrow(code('file_unsupported'));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(() => readSpreadsheet(png)).toThrow(code('file_unsupported'));
    expect(() => readSpreadsheet(new Uint8Array())).toThrow(code('file_empty'));
    expect(() => readSpreadsheet(new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1))).toThrow(
      code('file_too_large'),
    );
  });

  it('stops a zip bomb while inflating instead of trusting declared sizes', () => {
    // 200 MB of zeros compress to ~200 KB.
    const withBomb = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': new Uint8Array(200 * 1024 * 1024),
    });
    expect(withBomb.length).toBeLessThan(IMPORT_LIMITS.maxFileBytes);
    expect(() => readSpreadsheet(withBomb)).toThrow(code('file_too_large'));
  });

  it('refuses XML with a document type (entity expansion)', () => {
    const file = excelLikeXlsx([['a']], {
      extra: {
        'xl/sharedStrings.xml': strToU8(
          '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><sst><si><t>&a;</t></si></sst>',
        ),
      },
    });
    expect(() => readSpreadsheet(file)).toThrow(code('file_unreadable'));
  });

  it('reads CSV: UTF-8 with BOM, quotes, semicolons, Windows Arabic', () => {
    const csv = '﻿الاسم,رقم الجوال\n"العتيبي, محمد",0551234567\r\n"قال ""مرحبا""",0501234567\n';
    expect(readSpreadsheet(strToU8(csv))).toEqual({
      kind: 'csv',
      rows: [
        ['الاسم', 'رقم الجوال'],
        ['العتيبي, محمد', '0551234567'],
        ['قال "مرحبا"', '0501234567'],
      ],
    });
    expect(readCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    // "الاسم" in Windows-1256
    const cp1256 = new Uint8Array([0xc7, 0xe1, 0xc7, 0xd3, 0xe3, 0x0a]);
    expect(readSpreadsheet(cp1256).rows[0]).toEqual(['الاسم']);
  });
});

describe('writing spreadsheets', () => {
  it('escapes formula-like cells but leaves phone numbers alone', () => {
    expect(escapeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(escapeFormula('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(escapeFormula('-2+3')).toBe(`'-2+3`);
    expect(escapeFormula('+966551234567')).toBe('+966551234567');
    expect(escapeFormula('أحمد')).toBe('أحمد');
    const file = writeXlsx('x', [{ header: 'h', width: 10 }], [['=1+1'], ['<b>&']]);
    expect(readSpreadsheet(file).rows).toEqual([['h'], [`'=1+1`], ['<b>&']]);
  });
});

describe('header mapping', () => {
  it('maps template headers and common aliases, ignoring letter variants and case', () => {
    expect(mapHeaders(TEMPLATE_ROW)).toEqual({
      columns: { fullName: 0, phone: 1, email: 2, group: 3, companions: 4, notes: 5 },
      missing: [],
      ignored: [],
    });
    expect(mapHeaders(['الإسم', ' Mobile ', 'E-mail', 'رقم الطاولة'])).toEqual({
      columns: { fullName: 0, phone: 1, email: 2 },
      missing: [],
      ignored: ['رقم الطاولة'],
    });
    expect(mapHeaders(['الاسم', 'المدينة']).missing).toEqual(['phone']);
  });
});
