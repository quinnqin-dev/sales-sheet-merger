export type Column = {
  id: string;
  name: string;
  type: "text" | "number" | "date";
  required: boolean;
};
export type Template = { name: string; columns: Column[] };

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
