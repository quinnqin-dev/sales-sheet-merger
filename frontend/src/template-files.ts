import type { Template } from "./template-state";

export type TemplateDocument = {
  format: "sales-sheet-merger.output-template";
  version: 1;
  id: string;
  template: Template;
};
export type SavedTemplate = TemplateDocument & { file_name: string };
export type TemplateFileHandle = {
  name: string;
  createWritable(): Promise<{
    write(value: string): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
};

export class TemplateFileError extends Error {}

export function templateDocument(
  template: Template,
  id: string = crypto.randomUUID(),
): TemplateDocument {
  return {
    format: "sales-sheet-merger.output-template",
    version: 1,
    id,
    template,
  };
}

export function chooseTemplateFile(
  template: Template,
  fileName = "",
): Promise<TemplateFileHandle> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<TemplateFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker) throw new TemplateFileError("templates.browserUnsupported");
  return picker.call(window, {
    id: "sales-output-template",
    suggestedName:
      fileName ||
      `${template.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.sheet-template.json`,
    types: [
      {
        description: "Output template (JSON)",
        accept: { "application/json": [".json"] },
      },
    ],
    excludeAcceptAllOption: true,
  });
}

export async function writeTemplateFile(
  handle: TemplateFileHandle,
  document: TemplateDocument,
) {
  const stream = await handle.createWritable();
  try {
    await stream.write(JSON.stringify(document, null, 2) + "\n");
    await stream.close();
  } catch (error) {
    try {
      await stream.abort?.();
    } catch {
      /* Retain the original error. */
    }
    throw error;
  }
}
