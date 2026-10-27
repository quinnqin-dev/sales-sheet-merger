export type Column = {
  id: string;
  name: string;
  type: "text" | "number" | "date";
  required: boolean;
};
export type Template = { name: string; columns: Column[] };

// Display-only examples. New drafts never copy these values into input fields.
export const SALES_TEMPLATE_EXAMPLE: Template = {
  name: "Standard Sales Details",
  columns: [
    { id: "date", name: "Date", type: "date", required: true },
    { id: "order_id", name: "Order ID", type: "text", required: false },
    { id: "sku", name: "SKU", type: "text", required: false },
    { id: "product", name: "Product", type: "text", required: false },
    { id: "quantity", name: "Quantity", type: "number", required: false },
    { id: "price", name: "Unit Price", type: "number", required: false },
    { id: "amount", name: "Sales Amount", type: "number", required: true },
    { id: "channel", name: "Channel", type: "text", required: false },
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
