import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  CircleAlert,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useI18n } from "./i18n";
import {
  initialTemplateDraft,
  OUTPUT_TEMPLATE_EXAMPLE,
  validTemplateDraft,
  type Template,
  type Column,
} from "./template-state";

function TemplateResetDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
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
      aria-labelledby="template-reset-title"
      aria-describedby="template-reset-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="template-required-heading">
        <span className="file-icon">
          <RefreshCw size={23} />
        </span>
      </div>
      <h2 id="template-reset-title">{t("ui.resetTemplateTitle")}</h2>
      <p id="template-reset-description">
        {t("ui.confirmOutputTemplateReset")}
      </p>
      <div className="button-group">
        <button className="btn secondary" disabled={busy} onClick={onCancel}>
          {t("ui.cancel")}
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void onConfirm()}
        >
          {t(busy ? "ui.resettingOutputTemplate" : "ui.confirmResetTemplate")}
        </button>
      </div>
    </dialog>
  );
}

export function TemplateEditor({
  template,
  configured,
  returnToBatch,
  onReturn,
  busy,
  onReset,
  onSave,
  onSaveAs,
}: {
  template: Template;
  configured: boolean;
  returnToBatch: boolean;
  onReturn: () => void;
  busy: boolean;
  onReset: () => Promise<boolean>;
  onSave: (t: Template) => Promise<void>;
  onSaveAs: (t: Template) => Promise<void>;
}) {
  const { t } = useI18n();
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, setDraft] = useState(() =>
    initialTemplateDraft(template, configured),
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(template);
  const valid = validTemplateDraft(draft);
  const [showExample, setShowExample] = useState(!configured);
  const patch = (id: string, p: Partial<Column>) =>
    setDraft((old) => ({
      ...old,
      columns: old.columns.map((c) => (c.id === id ? { ...c, ...p } : c)),
    }));
  function move(i: number, delta: number) {
    const next = [...draft.columns];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setDraft({ ...draft, columns: next });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {t("ui.defineACommonStructureForYourData")}
          </div>
          <h1>{t("ui.standardTemplate")}</h1>
          <p>{t("ui.everySourceIsExportedUsingTheseColumns")}</p>
        </div>
        <div className="button-group">
          {returnToBatch && (
            <button className="btn subtle" disabled={busy} onClick={onReturn}>
              <ArrowLeft size={16} />
              {t("templates.back")}
            </button>
          )}
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
          >
            <RefreshCw size={16} />
            {t("ui.resetOutputTemplate")}
          </button>
          {configured && (
            <button
              className="btn secondary"
              disabled={busy || !valid}
              onClick={() =>
                void onSaveAs({
                  ...draft,
                  name: draft.name.trim(),
                  columns: draft.columns.map((c) => ({
                    ...c,
                    name: c.name.trim(),
                  })),
                })
              }
            >
              {t("templates.saveAs")}
            </button>
          )}
          <button
            className="btn primary"
            disabled={busy || (configured && !dirty) || !valid}
            onClick={() =>
              void onSave({
                ...draft,
                name: draft.name.trim(),
                columns: draft.columns.map((c) => ({
                  ...c,
                  name: c.name.trim(),
                })),
              })
            }
          >
            <Save size={16} />
            {t("templates.save")}
          </button>
        </div>
      </div>
      {showExample && (
        <div className="panel template-example">
          <div className="section-heading">
            <div>
              <h2>{t("ui.outputTemplateExample")}</h2>
              <p>{t("ui.templateExampleExplanation")}</p>
            </div>
          </div>
          <strong>
            {t("ui.exampleValue", { value: OUTPUT_TEMPLATE_EXAMPLE.name })}
          </strong>
          <div className="example-columns">
            {OUTPUT_TEMPLATE_EXAMPLE.columns.map((c) => (
              <span key={c.id}>{t("ui.exampleValue", { value: c.name })}</span>
            ))}
          </div>
        </div>
      )}
      <div className="panel section-panel template-panel">
        <label className="template-name-label">
          {t("ui.templateName")}
          <input
            value={draft.name}
            placeholder={t("ui.exampleValue", {
              value: OUTPUT_TEMPLATE_EXAMPLE.name,
            })}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <table>
          <thead>
            <tr>
              <th className="col-order">{t("ui.order")}</th>
              <th>{t("ui.targetColumnName")}</th>
              <th>{t("ui.dataType")}</th>
              <th>{t("ui.required")}</th>
              <th>{t("ui.reorder")}</th>
            </tr>
          </thead>
          <tbody>
            {draft.columns.map((c, i) => (
              <tr key={c.id}>
                <td className="order-index" data-label={t("ui.order")}>
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td data-label={t("ui.targetColumnName")}>
                  <input
                    aria-label={t("ui.columnName", { p0: i + 1 })}
                    value={c.name}
                    placeholder={t("ui.exampleValue", {
                      value:
                        OUTPUT_TEMPLATE_EXAMPLE.columns[i]?.name ||
                        t("ui.targetColumnName"),
                    })}
                    maxLength={80}
                    onChange={(e) => patch(c.id, { name: e.target.value })}
                  />
                </td>
                <td data-label={t("ui.dataType")}>
                  <select
                    aria-label={t("ui.dataType211", { p0: c.name })}
                    value={c.type}
                    onChange={(e) =>
                      patch(c.id, { type: e.target.value as Column["type"] })
                    }
                  >
                    <option value="text">
                      {t("ui.textPreserveLeadingZeros")}
                    </option>
                    <option value="number">{t("ui.number")}</option>
                    <option value="date">{t("ui.date")}</option>
                  </select>
                </td>
                <td data-label={t("ui.required")}>
                  <label className="checkbox-label">
                    <input
                      aria-label={t("ui.required213", { p0: c.name })}
                      type="checkbox"
                      checked={c.required}
                      onChange={(e) =>
                        patch(c.id, { required: e.target.checked })
                      }
                    />
                    {t("ui.required")}
                  </label>
                </td>
                <td data-label={t("ui.reorder")}>
                  <div className="button-group template-column-actions">
                    <button
                      className="icon-btn"
                      disabled={i === 0}
                      aria-label={t("ui.moveUp", { p0: c.name })}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      disabled={i === draft.columns.length - 1}
                      aria-label={t("ui.moveDown", { p0: c.name })}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      disabled={draft.columns.length === 1}
                      aria-label={t("ui.deleteColumn", { p0: c.name })}
                      onClick={() => {
                        if (
                          confirm(
                            t("ui.removeFromTheTemplateThisTakesEffect", {
                              p0: c.name,
                            }),
                          )
                        )
                          setDraft({
                            ...draft,
                            columns: draft.columns.filter((x) => x.id !== c.id),
                          });
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="btn secondary add-column"
          disabled={draft.columns.length >= 100}
          onClick={() =>
            setDraft({
              ...draft,
              columns: [
                ...draft.columns,
                {
                  id: crypto.randomUUID(),
                  name: "",
                  type: "text",
                  required: false,
                },
              ],
            })
          }
        >
          <Plus size={16} />
          {t("ui.addTargetColumn")}
        </button>
        {!valid &&
          (draft.name !== "" || draft.columns.some((c) => c.name !== "")) && (
            <p className="inline-error">
              {t("ui.templateAndColumnNamesCannotBeEmpty")}
            </p>
          )}
      </div>
      <div className="template-footnote">
        <CircleAlert size={16} />
        <p>{t("ui.afterSavingTheTemplateConfirmThisBatch")}</p>
      </div>
      {confirmReset && (
        <TemplateResetDialog
          busy={busy}
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            if (await onReset()) {
              setDraft(initialTemplateDraft(OUTPUT_TEMPLATE_EXAMPLE, false));
              setShowExample(true);
            }
            setConfirmReset(false);
          }}
        />
      )}
    </>
  );
}
