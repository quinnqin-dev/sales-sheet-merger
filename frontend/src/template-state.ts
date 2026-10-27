export type Column = {
  id: string;
  name: string;
  type: "text" | "number" | "date";
  required: boolean;
};
export type Template = { name: string; columns: Column[] };

// Display-only examples. New drafts never copy these values into input fields.
export const OUTPUT_TEMPLATE_EXAMPLE: Template = {
  name: "Output Template",
  columns: [
    { id: "record_id", name: "Record ID", type: "text", required: false },
    { id: "name", name: "Name", type: "text", required: false },
    { id: "date", name: "Date", type: "date", required: false },
    { id: "value", name: "Value", type: "number", required: false },
  ],
};

export function initialTemplateDraft(
  template: Template,
  configured: boolean,
): Template {
  return configured
    ? structuredClone(template)
    : {
        name: "",
        columns: [
          { id: crypto.randomUUID(), name: "", type: "text", required: false },
        ],
      };
}

export function validTemplateDraft(draft: Template): boolean {
  const names = draft.columns.map((c) => c.name.trim());
  return (
    !!draft.name.trim() &&
    names.length > 0 &&
    names.every(Boolean) &&
    new Set(names).size === names.length
  );
}
