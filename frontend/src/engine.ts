import { Decimal } from "decimal.js";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Template } from "./template-state.ts";
import type { Rule, Sheet, SourceFile, ResultRow } from "./domain.ts";
import { LocalizedError, translate, type Locale } from "./i18n-core.ts";
import { normal, signature } from "./casefold.ts";

Decimal.set({ precision: 50 });
const illegalXML = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
export type CellValue = string | number | boolean | Date | null;
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
export const wire = (v: unknown): unknown =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v;
export function problem(error: unknown, fallback = "file_unreadable") {
  const code = error instanceof LocalizedError ? error.code : fallback;
  return {
    error: code,
    error_code: code,
    error_params: error instanceof LocalizedError ? error.params : {},
  };
}
export const loadReader=()=>import('./reader.ts');
export async function readBook(file:File,encoding='utf-8-sig'):Promise<InputBook>{return (await loadReader()).readBook(file,encoding);}
export async function inspectFile(...args:Parameters<typeof import('./reader.ts')['inspectFile']>){return (await loadReader()).inspectFile(...args);}
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
