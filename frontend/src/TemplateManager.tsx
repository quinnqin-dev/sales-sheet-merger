import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Upload,
  Settings2,
  Table2,
} from "lucide-react";
import { useI18n, msg, LocalizedError, type Message } from "./i18n";
import { TemplateEditor } from "./TemplateEditor";
import {
  chooseTemplateFile,
  templateDocument,
  writeTemplateFile,
  TemplateFileError,
  type SavedTemplate,
  type TemplateDocument,
} from "./template-files";
import { SALES_TEMPLATE_EXAMPLE, type Template } from "./template-state";

type Props = {
  templates: SavedTemplate[];
  busy: boolean;
  initialEdit: string | null;
  returnToBatch: boolean;
  onReturn: () => void;
  perform: (label: Message, work: () => Promise<void>) => Promise<void>;
  validate: (document: unknown) => Promise<TemplateDocument>;
  register: (document: SavedTemplate, replace: boolean) => Promise<void>;
  onRegistered: (id: string) => void;
  onReset: () => Promise<boolean>;
};

export function TemplateManager(props: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(
    () => props.initialEdit ?? (props.templates.length ? null : ""),
  );
  const [pending, setPending] = useState<{
    record: SavedTemplate;
    replace: boolean;
  } | null>(null);
  const [replacement, setReplacement] = useState<SavedTemplate | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const edited = props.templates.find((item) => item.id === editing);

  async function register(record: SavedTemplate, replace: boolean) {
    await props.register(record, replace);
    setPending(null);
    setEditing(null);
    props.onRegistered(record.id);
  }
  async function save(template: Template, asNew: boolean) {
    await props.perform(msg("templates.saving"), async () => {
      let handle;
      try {
        // The picker must run during the click, before network requests.
        handle = await chooseTemplateFile(
          template,
          asNew ? "" : edited?.file_name,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (error instanceof LocalizedError) throw error;
        if (error instanceof TemplateFileError)
          throw new LocalizedError(error.message);
        throw new LocalizedError("templates.writeFailed");
      }
      const document = await props.validate(
        templateDocument(template, asNew ? undefined : edited?.id),
      );
      try {
        await writeTemplateFile(handle, document);
      } catch {
        throw new LocalizedError("templates.writeFailed");
      }
      const record = { ...document, file_name: handle.name };
      const replace = !asNew && !!edited;
      setPending({ record, replace });
      try {
        await register(record, replace);
      } catch {
        throw new LocalizedError("templates.registrationFailed");
      }
    });
  }
  async function importFile(file: File) {
    await props.perform(msg("templates.importing"), async () => {
      if (file.size > 2 * 1024 * 1024) throw new LocalizedError("library_size");
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new LocalizedError("templates.invalidFile");
      }
      const document = await props.validate(data);
      const existing = props.templates.find((item) => item.id === document.id);
      if (
        existing &&
        JSON.stringify(existing.template) === JSON.stringify(document.template)
      ) {
        props.onRegistered(existing.id);
      } else if (existing) {
        setReplacement({ ...document, file_name: file.name });
      } else {
        await register({ ...document, file_name: file.name }, false);
      }
    });
  }

  if (pending)
    return (
      <div className="panel section-panel template-pending" role="status">
        <h2>{t("templates.fileSaved")}</h2>
        <p>{t("templates.registrationFailed")}</p>
        <div className="button-group">
          <button
            className="btn primary"
            disabled={props.busy}
            onClick={() =>
              void props.perform(msg("templates.saving"), () =>
                register(pending.record, pending.replace),
              )
            }
          >
            {t("templates.retry")}
          </button>
          <button
            className="btn secondary"
            disabled={props.busy}
            onClick={() => {
              setPending(null);
              setEditing(null);
            }}
          >
            {t("templates.back")}
          </button>
        </div>
      </div>
    );

  return (
    <>
      {props.returnToBatch && (
        <button
          className="btn subtle template-batch-return"
          disabled={props.busy}
          onClick={props.onReturn}
        >
          <ArrowLeft size={16} />
          {t("templates.backToConfirmation")}
        </button>
      )}
      {editing !== null ? (
        <TemplateEditor
          key={editing}
          template={edited?.template ?? SALES_TEMPLATE_EXAMPLE}
          configured={!!edited}
          returnToBatch
          onReturn={() => setEditing(null)}
          busy={props.busy}
          onReset={props.onReset}
          onSave={(template) => save(template, false)}
          onSaveAs={(template) => save(template, true)}
        />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{t("ui.standardTemplate")}</div>
              <h1>{t("templates.library")}</h1>
              <p>{t("templates.libraryDescription")}</p>
            </div>
            <div className="button-group">
              <button
                className="btn secondary"
                disabled={props.busy}
                onClick={() => importRef.current?.click()}
              >
                <Upload size={16} />
                {t("templates.import")}
              </button>
              <button
                className="btn primary"
                disabled={props.busy}
                onClick={() => setEditing("")}
              >
                <Plus size={16} />
                {t("templates.new")}
              </button>
            </div>
          </div>
          <div className="template-library-list">
            {props.templates.length ? (
              props.templates.map((record) => (
                <article
                  className="panel template-library-card"
                  key={record.id}
                >
                  <span className="file-icon">
                    <Table2 size={22} />
                  </span>
                  <div>
                    <h2>{record.template.name}</h2>
                    <p>
                      {t("ui.outputColumns", {
                        count: record.template.columns.length,
                      })}
                      {record.file_name && ` · ${record.file_name}`}
                    </p>
                    <small>
                      {record.template.columns
                        .map((column) => column.name)
                        .join(" · ")}
                    </small>
                  </div>
                  <button
                    className="btn secondary"
                    disabled={props.busy}
                    onClick={() => setEditing(record.id)}
                  >
                    <Settings2 size={15} />
                    {t("templates.edit")}
                  </button>
                </article>
              ))
            ) : (
              <div className="panel large-empty">
                <Table2 size={30} />
                <h2>{t("templates.empty")}</h2>
                <p>{t("templates.emptyDescription")}</p>
              </div>
            )}
          </div>
          <p className="template-library-note">{t("templates.fileNote")}</p>
        </>
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json"
        hidden
        aria-label={t("templates.import")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {replacement && (
        <ReplaceTemplateDialog
          busy={props.busy}
          name={replacement.template.name}
          onCancel={() => setReplacement(null)}
          onConfirm={() =>
            void props.perform(msg("templates.importing"), async () => {
              await register(replacement, true);
              setReplacement(null);
            })
          }
        />
      )}
    </>
  );
}

function ReplaceTemplateDialog({
  busy,
  name,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="template-required-dialog"
      aria-labelledby="replace-template-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="replace-template-title">{t("templates.replaceTitle")}</h2>
      <p>{t("templates.replaceDescription", { name })}</p>
      <div className="button-group">
        <button className="btn secondary" disabled={busy} onClick={onCancel}>
          {t("ui.cancel")}
        </button>
        <button className="btn primary" disabled={busy} onClick={onConfirm}>
          {t("templates.replace")}
        </button>
      </div>
    </dialog>
  );
}

export function TemplateSelector({
  templates,
  selectedId,
  busy,
  onSelect,
  onManage,
  onBack,
  onConfirm,
}: {
  templates: SavedTemplate[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onManage: (id: string | null) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const selected = templates.find((item) => item.id === selectedId);
  return (
    <>
      <div className="panel section-panel">
        <div className="section-heading">
          <div>
            <h2>{t("templates.confirmTitle")}</h2>
            <p>{t("templates.confirmDescription")}</p>
          </div>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => onManage("")}
          >
            <Plus size={16} />
            {t("templates.new")}
          </button>
        </div>
        <label className="batch-template-picker">
          {t("templates.choose")}
          <select
            value={selectedId ?? ""}
            disabled={busy}
            onChange={(event) => onSelect(event.target.value || null)}
          >
            <option value="">{t("templates.choosePlaceholder")}</option>
            {templates.map((item) => (
              <option value={item.id} key={item.id}>
                {item.template.name}
                {item.file_name ? ` · ${item.file_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <div className="template-confirm-preview">
            <div className="section-heading">
              <div>
                <h3>{selected.template.name}</h3>
                <p>
                  {t("ui.outputColumns", {
                    count: selected.template.columns.length,
                  })}
                </p>
              </div>
              <button
                className="btn subtle"
                disabled={busy}
                onClick={() => onManage(selected.id)}
              >
                <Settings2 size={15} />
                {t("templates.edit")}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t("ui.order")}</th>
                  <th>{t("ui.targetColumnName")}</th>
                  <th>{t("ui.dataType")}</th>
                  <th>{t("ui.required")}</th>
                </tr>
              </thead>
              <tbody>
                {selected.template.columns.map((column, index) => (
                  <tr key={column.id}>
                    <td>{String(index + 1).padStart(2, "0")}</td>
                    <td>{column.name}</td>
                    <td>{t(`ui.${column.type}`)}</td>
                    <td>{column.required ? t("templates.yes") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-results">
            <Table2 size={28} />
            <p>
              {t(
                templates.length
                  ? "templates.selectHint"
                  : "templates.emptyDescription",
              )}
            </p>
            <button
              className="btn subtle"
              disabled={busy}
              onClick={() => onManage(null)}
            >
              {t("templates.manage")}
            </button>
          </div>
        )}
      </div>
      <div className="wizard-footer">
        <button className="btn subtle" disabled={busy} onClick={onBack}>
          <ArrowLeft size={16} />
          {t("ui.backToImport")}
        </button>
        <button
          className="btn primary"
          disabled={busy || !selected}
          onClick={onConfirm}
        >
          {t("templates.confirmNext")}
          <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
