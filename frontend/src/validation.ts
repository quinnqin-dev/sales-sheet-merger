import { z } from "zod";
import { LocalizedError } from "./i18n-core.ts";
import { OUTPUT_TEMPLATE_EXAMPLE } from "./template-state.ts";
import type { Library } from "./domain.ts";
import {
  LEGACY_TEMPLATE_FORMAT,
  TEMPLATE_FORMAT,
  type TemplateDocument,
} from "./template-files.ts";

const label = z
  .string()
  .min(1)
  .max(80)
  .refine((s) => !!s.trim());
export const templateSchema = z
  .object({
    name: label,
    columns: z
      .array(
        z.object({
          id: label,
          name: label,
          type: z.enum(["text", "number", "date"]),
          required: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((t, ctx) => {
    for (const attr of ["id", "name"] as const)
      if (
        new Set(t.columns.map((c) => c[attr].trim())).size !== t.columns.length
      )
        ctx.addIssue({ code: "custom", message: "invalid_columns" });
  });
export const ruleSchema = z
  .object({
    id: label,
    name: z.string().min(1).max(100),
    headers: z.array(z.string()).max(1000),
    mappings: z
      .array(
        z.object({
          target_id: label,
          mode: z.enum(["source", "fixed", "empty"]).default("source"),
          source_index: z
            .number()
            .int()
            .min(0)
            .max(999)
            .nullable()
            .default(null),
          fixed: z.string().max(1000).default(""),
          trim: z.boolean().default(true),
          fill: z.string().max(1000).default(""),
          replacements: z
            .array(
              z.object({
                before: z.string().max(1000),
                after: z.string().max(1000),
              }),
            )
            .max(100)
            .default([]),
          date_format: z
            .enum([
              "%Y-%m-%d",
              "%Y/%m/%d",
              "%Y%m%d",
              "%d/%m/%Y",
              "%m/%d/%Y",
              "%Y-%m-%d %H:%M:%S",
            ])
            .default("%Y-%m-%d"),
          number_style: z.enum(["plain", "comma", "european"]).default("comma"),
        }),
      )
      .max(100),
  })
  .refine(
    (r) =>
      new Set(r.mappings.map((m) => m.target_id)).size === r.mappings.length,
  );
export const documentSchema = z
  .object({
    format: z.union([
      z.literal(TEMPLATE_FORMAT),
      z.literal(LEGACY_TEMPLATE_FORMAT),
    ]),
    version: z.literal(1),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    template: templateSchema,
  })
  .transform((d): TemplateDocument => ({
    ...d,
    format: TEMPLATE_FORMAT,
    template: {
      ...d.template,
      name: d.template.name.trim(),
      columns: d.template.columns.map((c) => ({ ...c, name: c.name.trim() })),
    },
  }));
const savedSchema = documentSchema.and(
  z.object({ file_name: z.string().max(255).default("") }),
);
const librarySchema = z.object({
  version: z.literal(1),
  template: templateSchema,
  template_configured: z.boolean().default(false),
  rules: z.array(ruleSchema).max(500).default([]),
  templates: z.array(savedSchema).max(100).optional(),
});
export const runSchema = z.object({
  duplicatePolicy: z
    .enum(["keep-all", "keep-first", "keep-last"])
    .default("keep-all"),
  template: templateSchema,
  selections: z
    .array(
      z.object({
        file_id: label,
        sheet: z.string(),
        header_row: z.number().int().min(1).max(1000),
        rule: ruleSchema,
      }),
    )
    .min(1)
    .max(300),
});
export function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  code = "invalid_config",
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LocalizedError(code);
  return result.data;
}
export function validateLibrary(value: unknown): Library {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2 * 1024 * 1024)
    throw new LocalizedError("library_size");
  const lib = parse(librarySchema, value, "library_format");
  // Old full backups contained just one configured template. Preserve its IDs.
  const templates =
    lib.templates ??
    (lib.template_configured
      ? [
          {
            format: TEMPLATE_FORMAT,
            version: 1 as const,
            id: "legacy-output-template",
            template: lib.template,
            file_name: "",
          },
        ]
      : []);
  if (new Set(lib.rules.map((r) => r.id)).size !== lib.rules.length)
    throw new LocalizedError("duplicate_rules");
  if (new Set(templates.map((t) => t.id)).size !== templates.length)
    throw new LocalizedError("duplicate_templates");
  return { ...lib, templates };
}
export const emptyLibrary = (): Library => ({
  version: 1,
  template: structuredClone(OUTPUT_TEMPLATE_EXAMPLE),
  template_configured: false,
  rules: [],
  templates: [],
});
