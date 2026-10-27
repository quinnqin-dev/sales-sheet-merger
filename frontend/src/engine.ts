import * as XLSX from "xlsx";
// SheetJS bundles legacy Excel codepages locally; no CDN requests at runtime.
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import Papa from "papaparse";
import { Decimal } from "decimal.js";
import { unzipSync } from "fflate";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Template } from "./template-state.ts";
import type { Rule, Sheet, SourceFile, ResultRow } from "./domain.ts";
import { LocalizedError, translate, type Locale } from "./i18n-core.ts";
import { normal, signature } from "./casefold.ts";

XLSX.set_cptable(cptable);
Decimal.set({ precision: 50 });
const MAX_ROWS = 100000;
const illegalXML = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
type CellValue = string | number | boolean | Date | null;
export type InputRow = {
  row: number;
  values: CellValue[];
  raw: CellValue[];
  missing: Set<number>;
};
export type InputBook = {
  names: string[];
  rows: (sheet: string) => Iterable<InputRow>;
};
export const blank = (values: unknown[]) =>
  values.every((v) => v == null || (typeof v === "string" && !v.trim()));
const wire = (v: unknown): unknown =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v;
export function problem(error: unknown, fallback = "file_unreadable") {
  const code = error instanceof LocalizedError ? error.code : fallback;
  return {
    error: code,
    error_code: code,
    error_params: error instanceof LocalizedError ? error.params : {},
  };
}
export async function readBook(
  file: File,
  encoding = "utf-8-sig",
): Promise<InputBook> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (!["xlsx", "xls", "csv"].includes(extension || ""))
    throw new LocalizedError("unsupported_file");
  if (file.size > 50 * 1024 * 1024) throw new LocalizedError("file_size");
  const buffer = await file.arrayBuffer();
  if (extension === "csv") {
    let text;
    try {
      text = new TextDecoder(encoding === "gb18030" ? "gb18030" : "utf-8", {
        fatal: true,
      }).decode(buffer);
    } catch {
      throw new LocalizedError("encoding_error");
    }
    const parsed = Papa.parse<string[]>(text, {
      delimitersToGuess: [",", ";", "\t"],
      skipEmptyLines: false,
    });
    if (parsed.errors.some((e) => e.type === "Quotes"))
      throw new LocalizedError("file_unreadable");
    const data = parsed.data;
    // A final line terminator does not create an extra CSV record.
    if (
      /[\r\n]$/.test(text) &&
      data.at(-1)?.length === 1 &&
      data.at(-1)?.[0] === ""
    )
      data.pop();
    if (data.length > 200000) throw new LocalizedError("physical_row_limit");
    if (data.some((r) => r.length > 1000))
      throw new LocalizedError("column_limit");
    return {
      names: ["CSV"],
      *rows() {
        for (let i = 0; i < data.length; i++)
          yield {
            row: i + 1,
            values: data[i],
            raw: data[i],
            missing: new Set<number>(),
          };
      },
    };
  }
  const magic = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (
    extension === "xls" &&
    !(
      magic[0] === 0xd0 &&
      magic[1] === 0xcf &&
      magic[2] === 0x11 &&
      magic[3] === 0xe0
    ) &&
    !(magic[0] === 0x09 && [0, 2, 4, 8].includes(magic[1]))
  )
    throw new LocalizedError("file_unreadable");
  if (extension === "xlsx") {
    if (magic[0] !== 0x50 || magic[1] !== 0x4b)
      throw new LocalizedError("file_unreadable");
    let bytes = 0;
    unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        bytes += entry.originalSize;
        if (bytes > 256 * 1024 * 1024) throw new LocalizedError("xlsx_size");
        return false;
      },
    });
  }
  const book = XLSX.read(buffer, {
    type: "array",
    cellNF: true,
    cellFormula: true,
    cellText: true,
    sheetStubs: true,
  });
  if (book.SheetNames.length > 100) throw new LocalizedError("too_many_sheets");
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  return {
    names: book.SheetNames,
    *rows(name) {
      const sheet = book.Sheets[name];
      if (!sheet) throw new LocalizedError("sheet_unreadable");
      // Some exporters report !ref=A1 despite populated cells. Read actual cells.
      let maxRow = -1,
        maxCol = -1;
      for (const key of Object.keys(sheet)) {
        if (key.startsWith("!")) continue;
        const pos = XLSX.utils.decode_cell(key);
        maxRow = Math.max(maxRow, pos.r);
        maxCol = Math.max(maxCol, pos.c);
      }
      if (sheet["!ref"]) {
        const range = XLSX.utils.decode_range(sheet["!ref"]);
        maxRow = Math.max(maxRow, range.e.r);
        maxCol = Math.max(maxCol, range.e.c);
      }
      if (maxRow >= 200000) throw new LocalizedError("physical_row_limit");
      if (maxCol >= 1000) throw new LocalizedError("column_limit");
      for (let r = 0; r <= maxRow; r++) {
        const values: CellValue[] = [],
          raw: CellValue[] = [],
          missing = new Set<number>();
        for (let c = 0; c <= maxCol; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })] as
            XLSX.CellObject | undefined;
          let value: CellValue = (cell?.v ?? null) as CellValue;
          if (
            cell?.f &&
            (cell.v == null || cell.t === "z") &&
            extension === "xlsx"
          )
            missing.add(c);
          if (cell?.t === "e") value = cell.w ?? "#ERROR!";
          if (cell?.t === "z") value = null;
          if (typeof value === "number" && typeof cell?.z === "string") {
            if (/^0{2,}$/.test(cell.z) && Number.isInteger(value))
              value = String(value).padStart(cell.z.length, "0");
            else if (XLSX.SSF.is_date(cell.z)) {
              const d = XLSX.SSF.parse_date_code(value, { date1904 });
              if (d) {
                const date = new Date(0);
                date.setUTCFullYear(d.y, d.m - 1, d.d === 0 ? 1 : d.d);
                date.setUTCHours(0, 0, 0, 0);
                if (!date1904 && value >= 60 && value < 61) {
                  date.setUTCFullYear(1900, 1, 28);
                }
                value = date;
              }
            }
          }
          values.push(value);
          raw.push(missing.has(c) ? "=" + cell!.f : value);
        }
        yield { row: r + 1, values, raw, missing };
      }
    },
  };
}
export function inspectSheet(
  book: InputBook,
  name: string,
  headerRow = 1,
): Sheet {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 1000)
    throw new LocalizedError("header_range");
  let headers: string[] = [],
    count = 0,
    blanks = 0;
  const sample: Sheet["sample"] = [];
  for (const row of book.rows(name)) {
    if (row.row === headerRow) {
      headers = row.values.map((v) =>
        v == null ? "" : String(wire(v)).trim(),
      );
      while (headers.length && !headers.at(-1)) headers.pop();
      if (row.missing.size) throw new LocalizedError("header_formula");
    } else if (row.row > headerRow) {
      if (blank(row.raw)) {
        blanks++;
        continue;
      }
      if (++count > MAX_ROWS) throw new LocalizedError("sheet_row_limit");
      if (sample.length < 20)
        sample.push({ row: row.row, values: row.raw.map(wire) });
    }
  }
  if (!headers.length) throw new LocalizedError("header_missing");
  const normalized = headers.map(normal);
  if (
    normalized.some((h) => !h) ||
    new Set(normalized).size !== normalized.length
  )
    throw new LocalizedError("invalid_headers");
  return {
    name,
    header_row: headerRow,
    headers,
    sample,
    row_count: count,
    blank_count: blanks,
  };
}
export async function inspectFile(
  file: File,
  id: string,
  encoding = "utf-8-sig",
  headerRows: Record<string, number> = {},
): Promise<SourceFile> {
  const meta: SourceFile = {
    id,
    name: file.name,
    size: file.size,
    encoding,
    header_rows: headerRows,
    sheets: [],
  };
  try {
    const book = await readBook(file, encoding);
    meta.sheets = book.names.map((name) => {
      const header_row = headerRows[name] ?? 1;
      try {
        return inspectSheet(book, name, header_row);
      } catch (e) {
        return {
          name,
          header_row,
          headers: [],
          sample: [],
          row_count: 0,
          blank_count: 0,
          ...problem(e),
        };
      }
    });
    if (!meta.sheets.length || meta.sheets.every((s) => s.error))
      Object.assign(meta, problem(new LocalizedError("all_sheets_invalid")));
  } catch (e) {
    Object.assign(meta, problem(e));
  }
  return meta;
}
export function validateRule(
  rule: Rule,
  template: Template,
  headers: string[],
) {
  if (signature(rule.headers) !== signature(headers))
    throw new LocalizedError("rule_headers");
  const targets = new Set(rule.mappings.map((m) => m.target_id));
  if (
    targets.size !== template.columns.length ||
    template.columns.some((c) => !targets.has(c.id))
  )
    throw new LocalizedError("template_changed");
  if (
    rule.mappings.some(
      (m) =>
        m.mode === "source" &&
        (m.source_index == null || m.source_index >= rule.headers.length),
    )
  )
    throw new LocalizedError("incomplete_mapping");
}
export function parseNumber(value: unknown, style: string): Decimal {
  if (typeof value === "boolean" || value instanceof Date)
    throw new LocalizedError("invalid_number");
  let text = String(value).trim();
  if (style === "comma" && text.includes(",")) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text))
      throw new LocalizedError("comma_number");
    text = text.replaceAll(",", "");
  } else if (style === "european" && typeof value === "string") {
    if (!/^[+-]?(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/.test(text))
      throw new LocalizedError("european_number");
    text = text.replaceAll(".", "").replace(",", ".");
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text))
    throw new LocalizedError("number_symbols");
  const number = new Decimal(text),
    [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const scale = (mantissa.split(".")[1]?.length ?? 0) - Number(exponent);
  if (!number.isFinite() || number.abs().gt("1e15") || scale > 12)
    throw new LocalizedError("number_range");
  if (number.sd() > 15) throw new LocalizedError("number_precision");
  return number;
}
export function parseDate(value: unknown, format: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const token = /%[YmdHMS]/g;
  const names: string[] = [];
  const expression = format
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(token, (code) => {
      names.push(code);
      return code === "%Y" ? "(\\d{4})" : "(\\d{1,2})";
    });
  const match = new RegExp("^" + expression + "$").exec(String(value));
  if (!match) throw new LocalizedError("invalid_date", { format });
  const parts: Record<string, number> = {};
  names.forEach((key, i) => (parts[key] = Number(match[i + 1])));
  const y = parts["%Y"],
    m = parts["%m"],
    d = parts["%d"];
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  if (
    y < 1 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d ||
    (parts["%H"] ?? 0) > 23 ||
    (parts["%M"] ?? 0) > 59 ||
    (parts["%S"] ?? 0) > 59
  )
    throw new LocalizedError("invalid_date", { format });
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function convertRow(
  row: InputRow,
  rule: Rule,
  template: Template,
  headers: string[],
  locale: Locale = "en",
): Pick<ResultRow, "values" | "raw" | "reasons"> {
  const values: unknown[] = [],
    reasons: ResultRow["reasons"] = [];
  const positions = new Map(headers.map((h, i) => [normal(h), i]));
  for (const col of template.columns) {
    const m = rule.mappings.find((m) => m.target_id === col.id)!;
    try {
      let value: unknown = null;
      if (m.mode === "source") {
        const index = positions.get(normal(rule.headers[m.source_index!]));
        if (index === undefined) throw new LocalizedError("incomplete_mapping");
        if (row.missing.has(index)) throw new LocalizedError("formula_cache");
        value = row.values[index] ?? null;
      } else if (m.mode === "fixed") value = m.fixed;
      if (typeof value === "string" && m.trim) value = value.trim();
      if (value == null || value === "") value = m.fill || null;
      for (const replacement of m.replacements)
        if ((value == null ? "" : String(wire(value))) === replacement.before) {
          value = replacement.after;
          break;
        }
      if (value == null || value === "") {
        if (col.required) throw new LocalizedError("required_empty");
        values.push(null);
        continue;
      }
      if (col.type === "text") {
        value =
          typeof value === "boolean"
            ? value
              ? "True"
              : "False"
            : String(wire(value));
        if ((value as string).length > 32767)
          throw new LocalizedError("text_length");
        if (illegalXML.test(value as string))
          throw new LocalizedError("text_control");
      } else if (col.type === "number")
        value = parseNumber(value, m.number_style).toFixed();
      else value = parseDate(value, m.date_format);
      values.push(value);
    } catch (e) {
      values.push(null);
      const { error_code: code, error_params: params } = problem(
        e,
        "invalid_value",
      );
      reasons.push({
        column: col.name,
        code,
        params,
        reason: translate(code, params, locale),
      });
    }
  }
  return { values, reasons, raw: row.raw.map(wire) };
}
export const duplicateKey = (values: unknown[], template: Template) =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(
          values.map((v, i) =>
            v != null && template.columns[i].type === "number"
              ? new Decimal(String(v)).toString()
              : v,
          ),
        ),
      ),
    ),
  );
