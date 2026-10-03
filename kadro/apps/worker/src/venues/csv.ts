/**
 * Minimal RFC 4180 reader for the venue import (ADR-0067): comma separated, fields optionally in
 * double quotes with `""` as an escaped quote, CRLF or LF line ends, an optional UTF-8 byte order
 * mark. Quoted fields may span lines. Values are returned as text and never evaluated; blank
 * records are dropped.
 */

export interface CsvRecord {
  /** 1-based physical line on which the record starts (the header is line 1). */
  readonly line: number;
  readonly fields: readonly string[];
}

export type CsvParseResult =
  | { readonly ok: true; readonly records: readonly CsvRecord[] }
  | {
      readonly ok: false;
      readonly reason: 'unterminated_quote' | 'invalid_quote' | 'too_many_rows';
      /** Line of the offending record. */
      readonly line: number;
    };

const BOM = '﻿';

function isBlank(fields: readonly string[]): boolean {
  return fields.every((field) => field.trim() === '');
}

/**
 * Splits `text` into records. Parsing stops with `too_many_rows` as soon as more than `maxRecords`
 * non-blank records were read, so an oversized file is refused without reading it to the end.
 */
export function parseCsv(text: string, maxRecords: number): CsvParseResult {
  const input = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  let index = 0;

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRecord = (): boolean => {
    endField();
    if (!isBlank(fields)) {
      records.push({ line: recordLine, fields });
    }
    fields = [];
    return records.length <= maxRecords;
  };

  while (index < input.length) {
    const char = input.charAt(index);
    if (inQuotes) {
      if (char === '"') {
        if (input.charAt(index + 1) === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        const next = input.charAt(index);
        if (next !== ',' && next !== '\n' && next !== '\r' && next !== '') {
          return { ok: false, reason: 'invalid_quote', line };
        }
        continue;
      }
      if (char === '\n') {
        line += 1;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (field !== '') {
        return { ok: false, reason: 'invalid_quote', line };
      }
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      index += char === '\r' && input.charAt(index + 1) === '\n' ? 2 : 1;
      if (!endRecord()) {
        return { ok: false, reason: 'too_many_rows', line };
      }
      line += 1;
      recordLine = line;
      continue;
    }
    field += char;
    index += 1;
  }
  if (inQuotes) {
    return { ok: false, reason: 'unterminated_quote', line: recordLine };
  }
  if (fields.length > 0 || field !== '') {
    if (!endRecord()) {
      return { ok: false, reason: 'too_many_rows', line };
    }
  }
  return { ok: true, records };
}
