import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import Papa from "papaparse";
import { unzipSync } from "fflate";
import type { Sheet, SourceFile } from "./domain.ts";
import { LocalizedError } from "./i18n-core.ts";
import { normal } from "./casefold.ts";
import {
  blank,
  wire,
  problem,
  type InputBook,
  type InputRow,
  type CellValue,
} from "./engine.ts";
XLSX.set_cptable(cptable);
const MAX_ROWS = 100000;
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
