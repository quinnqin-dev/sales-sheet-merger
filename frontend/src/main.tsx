import {
  I18nProvider,
  useI18n,
  translate as t,
  getLocale,
  msg,
  renderMessage,
  errorMessage,
  messageFromError,
  LocalizedError,
  type Message,
} from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  FolderOpen,
  HelpCircle,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./style.css";
import { UserGuide } from "./UserGuide";
import { TemplateManager, TemplateSelector } from "./TemplateManager";
import type { SavedTemplate } from "./template-files";
import type { Template } from "./template-state";

function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <label className="language-switch">
      <span aria-hidden="true">EN / 中</span>
      <select
        aria-label="Language / 语言"
        value={locale}
        onChange={(e) => setLocale(e.target.value as "en" | "zh-CN")}
      >
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </label>
  );
}
type Mapping = {
  target_id: string;
  mode: "source" | "fixed" | "empty";
  source_index: number | null;
  fixed: string;
  trim: boolean;
  fill: string;
  replacements: {
    before: string;
    after: string;
  }[];
  date_format: string;
  number_style: string;
};
type Rule = {
  id: string;
  name: string;
  headers: string[];
  mappings: Mapping[];
};
type Library = {
  version: 1;
  template: Template;
  template_configured: boolean;
  rules: Rule[];
  templates: SavedTemplate[];
};
type Sheet = {
  name: string;
  header_row: number;
  headers: string[];
  sample: {
    row: number;
    values: unknown[];
  }[];
  row_count: number;
  blank_count: number;
  error?: string;
  error_code?: string;
  error_params?: Record<string, unknown>;
};
type SourceFile = {
  id: string;
  name: string;
  size: number;
  encoding: string;
  header_rows: Record<string, number>;
  error?: string;
  error_code?: string;
  error_params?: Record<string, unknown>;
  sheets: Sheet[];
};
type Assignment = {
  enabled: boolean;
  rule: Rule | null;
  confirmed: boolean;
};
type ResultRow = {
  file: string;
  sheet: string;
  row: number;
  values: unknown[];
  raw: unknown[];
  reasons: {
    column: string;
    reason: string;
    code?: string;
    params?: Record<string, unknown>;
  }[];
  duplicate_group?: string;
};
type Summary = {
  read: number;
  valid: number;
  issues: number;
  blank: number;
  duplicate_rows: number;
  duplicate_extra: number;
  duplicate_groups: number;
  totals: Record<string, string>;
  sources: {
    file: string;
    sheet: string;
    read: number;
    valid: number;
    issues: number;
    blank: number;
  }[];
};
type Job = {
  id: string;
  status: string;
  phase: string;
  phase_code: string;
  locale: "en" | "zh-CN";
  processed: number;
  total: number;
  summary: Summary | null;
  error?: string;
  error_code?: string;
  error_params?: Record<string, unknown>;
  template: Template;
};
const keyFor = (f: SourceFile, s: Sheet) => `${f.id}:${s.name}`;
const fmt = (n: number) => n.toLocaleString(getLocale());
const normal = (s: string) => s.normalize("NFKC").trim().toLowerCase();
const signature = (h: string[]) => JSON.stringify(h.map(normal).sort());
const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      "Accept-Language": getLocale(),
      ...(body !== undefined && !isForm
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let problem: Message = msg("ui.requestFailed", { p0: res.status });
    try {
      const result = await res.json();
      problem = msg(result.code || "invalid_config", result.params);
    } catch {
      /* Keep the HTTP status if the response is not JSON. */
    }
    throw new LocalizedError(problem.code, problem.params);
  }
  return res.json();
}
const aliases: Record<string, string[]> = {
  date: [
    "日期",
    "销售日期",
    "交易日期",
    "下单日期",
    "date",
    "sale_date",
    "sale date",
    "sales date",
  ],
  order_id: [
    "订单号",
    "订单编号",
    "order_id",
    "order no",
    "order number",
    "order id",
  ],
  sku: ["商品编码", "商品编号", "sku", "货号"],
  product: ["商品名称", "产品名称", "品名", "product", "product name"],
  quantity: ["数量", "销量", "销售数量", "quantity", "qty"],
  price: ["单价", "销售单价", "price", "unit price"],
  amount: [
    "销售额",
    "销售金额",
    "实付金额",
    "金额",
    "amount",
    "sales amount",
    "revenue",
  ],
  channel: ["渠道", "销售渠道", "平台", "channel", "sales channel", "platform"],
};
function newRule(
  headers: string[],
  template: Template,
  name = t("ui.newSourceRule"),
): Rule {
  return {
    id: crypto.randomUUID(),
    name,
    headers,
    mappings: template.columns.map((c) => {
      const index = headers.findIndex(
        (h) =>
          normal(h) === normal(c.name) ||
          (aliases[c.id] || []).some((a) => normal(a) === normal(h)),
      );
      return {
        target_id: c.id,
        mode: index >= 0 ? "source" : "empty",
        source_index: index >= 0 ? index : null,
        fixed: "",
        trim: true,
        fill: "",
        replacements: [],
        date_format: "%Y-%m-%d",
        number_style: "comma",
      };
    }),
  };
}
function reconcileRule(rule: Rule, template: Template) {
  const base = newRule(rule.headers, template, rule.name);
  return {
    ...rule,
    mappings: base.mappings.map(
      (m) => rule.mappings.find((old) => old.target_id === m.target_id) || m,
    ),
  };
}
function App() {
  const { t } = useI18n();
  const [library, setLibrary] = useState<Library | null>(null);
  const [view, setView] = useState("merge");
  const [templatePrompt, setTemplatePrompt] = useState(false);
  const [returnFromTemplate, setReturnFromTemplate] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateEditId, setTemplateEditId] = useState<string | null>(null);
  const [batch, setBatch] = useState("");
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>(
    {},
  );
  const [busy, setBusy] = useState<Message | null>(null);
  const [error, setError] = useState<Message | null>(null);
  const [notice, setNotice] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState("");
  const [editor, setEditor] = useState<{
    rule: Rule;
    key?: string;
  } | null>(null);
  const [preview, setPreview] = useState<ResultRow[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [kind, setKind] = useState("valid");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<{
    rows: ResultRow[];
    total: number;
  }>({
    rows: [],
    total: 0,
  });
  const [loadingRows, setLoadingRows] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const running = job?.status === "running";
  const template = library?.template;
  const savedTemplates = library?.templates ?? [];
  const selectedTemplate = savedTemplates.find(
    (item) => item.id === selectedTemplateId,
  );
  const selections = files.flatMap((f) =>
    f.sheets
      .filter((s) => assignments[keyFor(f, s)]?.enabled)
      .map((s) => ({
        file: f,
        sheet: s,
        assignment: assignments[keyFor(f, s)],
        key: keyFor(f, s),
      })),
  );
  const rowCount = selections.reduce((n, s) => n + (s.sheet.row_count || 0), 0);
  const confirmed = selections.filter((s) => s.assignment.confirmed).length;
  const blockers =
    files.some((f) => !!f.error) ||
    selections.some((s) => !!s.sheet.error) ||
    rowCount > 100000 ||
    !selections.length;
  useEffect(() => {
    api<Library>("/config")
      .then((lib) => setLibrary({ ...lib, templates: lib.templates ?? [] }))
      .catch((e) => setError(messageFromError(e)));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!job || job.status !== "running") return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await api<Job>(`/jobs/${job.id}`);
        if (!stopped) {
          setJob(next);
          if (next.status === "failed")
            setError(
              msg(next.error_code || "processing_failed", next.error_params),
            );
        }
      } catch (e) {
        if (!stopped) setError(messageFromError(e));
      }
    };
    const timer = setInterval(poll, 700);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (job?.status !== "done") return;
    let stopped = false;
    setLoadingRows(true);
    api<{
      rows: ResultRow[];
      total: number;
    }>(
      `/jobs/${job.id}/rows?kind=${kind}&page=${page}&duplicates_only=${duplicatesOnly}`,
    )
      .then((r) => {
        if (!stopped) setResults(r);
      })
      .catch((e) => setError(messageFromError(e)))
      .finally(() => {
        if (!stopped) setLoadingRows(false);
      });
    return () => {
      stopped = true;
    };
  }, [job?.id, job?.status, kind, page, duplicatesOnly]);
  async function action(label: Message, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(messageFromError(e));
    } finally {
      setBusy(null);
    }
  }
  function initializeAssignments(next: SourceFile[]) {
    setAssignments((old) => {
      const updated = { ...old };
      for (const f of next)
        for (const s of f.sheets) {
          const k = keyFor(f, s);
          if (updated[k]) continue;
          const matches =
            library?.rules.filter(
              (r) => !s.error && signature(r.headers) === signature(s.headers),
            ) || [];
          updated[k] = {
            enabled: f.sheets.find((x) => !x.error)?.name === s.name,
            rule: matches.length === 1 ? matches[0] : null,
            confirmed: false,
          };
        }
      return updated;
    });
  }
  async function upload(list: FileList | File[] | null) {
    if (!list?.length || busy || running) return;
    if (files.length + list.length > 30) {
      setError(msg("ui.aBatchCanContainUpTo30"));
      return;
    }
    await action(msg("ui.readingFiles"), async () => {
      let id = batch;
      if (!id) {
        id = (
          await api<{
            id: string;
          }>("/batches", "POST")
        ).id;
        setBatch(id);
      }
      const form = new FormData();
      Array.from(list).forEach((f) => form.append("files", f));
      const next = await api<SourceFile[]>(
        `/batches/${id}/files`,
        "POST",
        form,
      );
      setFiles(next);
      initializeAssignments(next);
      setExpanded(
        next.find((f) => f.error || f.sheets.some((s) => s.error))?.id || "",
      );
    });
    if (uploadRef.current) uploadRef.current.value = "";
  }
  async function removeFile(f: SourceFile) {
    await action(msg("ui.removingFile"), async () => {
      await api(`/batches/${batch}/files/${f.id}`, "DELETE");
      setFiles((old) => old.filter((x) => x.id !== f.id));
    });
  }
  async function inspect(
    f: SourceFile,
    encoding: string,
    headerRows: Record<string, number>,
  ) {
    await action(msg("ui.inspectingFileAgain"), async () => {
      const next = await api<SourceFile>(
        `/batches/${batch}/files/${f.id}/inspect`,
        "POST",
        { encoding, header_rows: headerRows },
      );
      setFiles((old) => old.map((x) => (x.id === f.id ? next : x)));
      setAssignments((old) => {
        const update = { ...old };
        for (const s of next.sheets) delete update[keyFor(next, s)];
        return update;
      });
      // Initialize on the next render through the same explicit suggestions.
      setAssignments((old) => {
        const update = { ...old };
        for (const s of next.sheets) {
          const matches = library!.rules.filter(
            (r) => !s.error && signature(r.headers) === signature(s.headers),
          );
          update[keyFor(next, s)] = {
            enabled: next.sheets.find((x) => !x.error)?.name === s.name,
            rule: matches.length === 1 ? matches[0] : null,
            confirmed: false,
          };
        }
        return update;
      });
    });
  }
  function payload() {
    return {
      template,
      selections: selections.map((s) => ({
        file_id: s.file.id,
        sheet: s.sheet.name,
        header_row: s.sheet.header_row,
        rule: s.assignment.rule,
      })),
    };
  }
  async function loadPreview() {
    await action(msg("ui.generatingPreview"), async () => {
      const data = await api<{
        rows: ResultRow[];
      }>(`/batches/${batch}/preview`, "POST", payload());
      setPreview(data.rows);
      setStep(4);
    });
  }
  async function start() {
    await action(msg("ui.startingMerge"), async () => {
      setKind("valid");
      setPage(1);
      setDuplicatesOnly(false);
      setResults({ rows: [], total: 0 });
      const next = await api<Job>(`/batches/${batch}/jobs`, "POST", payload());
      setJob(next);
      setStep(5);
    });
  }
  async function saveEditor(rule: Rule, saveToLibrary: boolean) {
    await action(msg("ui.savingRule"), async () => {
      if (saveToLibrary) {
        const lib = await api<Library>("/rules", "POST", rule);
        setLibrary(lib);
      }
      if (editor?.key)
        setAssignments((old) => ({
          ...old,
          [editor.key!]: { ...old[editor.key!], rule, confirmed: true },
        }));
      setEditor(null);
      setNotice(
        saveToLibrary
          ? msg("ui.ruleSavedForTheNextImport")
          : msg("ui.mappingConfirmedForThisBatch"),
      );
    });
  }
  function reset() {
    setStep(1);
    setFiles([]);
    setAssignments({});
    setBatch("");
    setPreview([]);
    setJob(null);
    setError(null);
    setTemplatePrompt(false);
    setReturnFromTemplate(false);
    setSelectedTemplateId(null);
  }
  function invalidateTemplate() {
    setAssignments((old) =>
      Object.fromEntries(
        Object.entries(old).map(([key, value]) => [
          key,
          { ...value, confirmed: false },
        ]),
      ),
    );
    setPreview([]);
    setJob(null);
    setResults({ rows: [], total: 0 });
  }
  function goStep(next: number) {
    if (next >= 3 && !selectedTemplate) {
      setStep(2);
      return;
    }
    setStep(next);
  }
  function manageTemplates(id: string | null) {
    setTemplateEditId(id);
    setReturnFromTemplate(true);
    setView("template");
    setError(null);
  }
  async function confirmTemplate() {
    if (!selectedTemplate) {
      setTemplatePrompt(true);
      return;
    }
    await action(msg("templates.applying"), async () => {
      const next = await api<Library>(
        "/template",
        "PUT",
        selectedTemplate.template,
      );
      setLibrary(next);
      setStep(3);
    });
  }
  async function registerTemplate(record: SavedTemplate, replace: boolean) {
    const next = await api<Library>(
      replace ? `/templates/${encodeURIComponent(record.id)}` : "/templates",
      replace ? "PUT" : "POST",
      record,
    );
    setLibrary(next);
    if (record.id === selectedTemplateId) {
      invalidateTemplate();
      setStep(files.length ? 2 : 1);
    }
  }
  async function resetTemplate() {
    let success = false;
    await action(msg("ui.resettingOutputTemplate"), async () => {
      setLibrary(await api<Library>("/template/reset", "POST"));
      setSelectedTemplateId(null);
      invalidateTemplate();
      setStep(files.length ? 2 : 1);
      setNotice(msg("ui.outputTemplateReset"));
      success = true;
    });
    return success;
  }
  async function deleteTemplate(id: string) {
    const next = await api<Library>(
      `/templates/${encodeURIComponent(id)}`,
      "DELETE",
    );
    setLibrary(next);
    if (id === selectedTemplateId) {
      setSelectedTemplateId(null);
      invalidateTemplate();
      setStep(files.length ? 2 : 1);
    }
    setNotice(msg("templates.deleted"));
  }
  if (!library)
    return (
      <div className="boot">
        <Layers3 size={38} />
        <h2>{t("ui.sheetMerger")}</h2>
        <LanguageSwitcher />
        <p>{renderMessage(error) || t("ui.openingYourLocalWorkspace")}</p>
        {error && (
          <button onClick={() => location.reload()}>{t("ui.reconnect")}</button>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar" inert={!!editor}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("merge");
            setReturnFromTemplate(false);
          }}
        >
          <span className="brand-icon">
            <Layers3 size={24} />
          </span>
          <span className="brand-name">
            {t("ui.sheetMerger")}
            <small>{t("ui.brandSubtitle")}</small>
          </span>
        </a>
        <div className="nav-label">{t("ui.workspace")}</div>
        <nav>
          {[
            { id: "merge", label: t("ui.batchMerge"), icon: FolderOpen },
            { id: "rules", label: t("ui.sourceRules"), icon: Settings2 },
            { id: "template", label: t("ui.standardTemplate"), icon: Table2 },
          ].map((item) => (
            <button
              className={view === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              disabled={!!busy || running}
              onClick={() => {
                setView(item.id);
                setTemplateEditId(null);
                setReturnFromTemplate(false);
                setError(null);
              }}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "rules" && (
                <span className="nav-count">{library.rules.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={21} />
          <strong>{t("ui.yourDataStaysOnYourComputer")}</strong>
          <p>{t("ui.filesAreProcessedLocallyRulesAreSaved")}</p>
          <span className="small-tag">
            <span className="status-dot" />
            {t("ui.runningLocally")}
          </span>
        </div>
        <button
          className={`nav-item help ${view === "help" ? "active" : ""}`}
          disabled={!!busy || running}
          onClick={() => {
            setView("help");
            setReturnFromTemplate(false);
          }}
        >
          <HelpCircle size={18} />
          {t("ui.userGuide")}
          <ChevronRight size={14} />
        </button>
        <div className="sidebar-version">
          {t("ui.sheetMergerV10")}
          <span>{t("ui.lessTimeSpentOnRepetitiveCleanup")}</span>
        </div>
      </aside>
      <div className="workspace" inert={!!editor}>
        <header className="topbar">
          <div>
            {t("ui.workspace")}
            <ChevronRight size={13} />{" "}
            <span>
              {
                {
                  merge: t("ui.batchMerge"),
                  rules: t("ui.sourceRules"),
                  template: t("ui.standardTemplate"),
                  help: t("ui.userGuide"),
                }[view]
              }
            </span>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher />
            <span className="local-indicator">
              <LockKeyhole size={13} />
              {t("ui.localProcessingNoCloudUpload")}
            </span>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="alert error">
              <CircleAlert size={18} />
              <span>{renderMessage(error)}</span>
              <button
                aria-label={t("ui.dismissNotification")}
                onClick={() => setError(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              <CheckCheck size={18} />
              {renderMessage(notice)}
            </div>
          )}
          {view === "merge" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {t("ui.oneStandardForEverySource")}
                  </div>
                  <h1>{t("ui.mergeSpreadsheets")}</h1>
                  <p>{t("ui.turnRecordsFromDifferentSourcesInto")}</p>
                </div>
                {files.length > 0 && !running && (
                  <button
                    className="btn subtle"
                    disabled={!!busy}
                    onClick={reset}
                  >
                    <Plus size={16} />
                    {t("ui.newBatch")}
                  </button>
                )}
              </div>
              <div className="steps">
                {[
                  t("ui.importFiles"),
                  t("templates.confirmStep"),
                  t("ui.configureRules"),
                  t("ui.previewCheck"),
                  t("ui.mergeExport"),
                ].map((label, i) => (
                  <React.Fragment key={label}>
                    <button
                      disabled={!!busy || running || i + 1 > step}
                      onClick={() => goStep(i + 1)}
                      className={`step ${step === i + 1 ? "current" : ""} ${step > i + 1 ? "complete" : ""}`}
                    >
                      <span>
                        {step > i + 1 ? (
                          <Check size={15} />
                        ) : (
                          String(i + 1).padStart(2, "0")
                        )}
                      </span>
                      {label}
                    </button>
                    {i < 4 && (
                      <div
                        className={`step-line ${step > i + 1 ? "filled" : ""}`}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
              {step === 1 && (
                <div className="import-layout">
                  <section>
                    <div
                      className={`dropzone ${dragging ? "dragging" : ""} ${busy ? "is-busy" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        void upload(e.dataTransfer.files);
                      }}
                    >
                      <span className="upload-symbol">
                        {busy ? (
                          <LoaderCircle size={30} className="spin" />
                        ) : (
                          <Upload size={30} />
                        )}
                      </span>
                      <h2>
                        {renderMessage(busy) || t("ui.dropYourFilesHere")}
                      </h2>
                      <p>{t("ui.selectMultipleExcelAndCsvFilesFrom")}</p>
                      <button
                        className="btn primary"
                        disabled={!!busy}
                        onClick={() => uploadRef.current?.click()}
                      >
                        <Plus size={17} />
                        {t("ui.chooseFiles")}
                      </button>
                      <div className="upload-limits">
                        .xlsx / .xls / .csv <span>·</span>
                        {t("ui.upTo30Files")} <span>·</span>
                        {t("ui.100000RowsTotal")}
                      </div>
                      <input
                        ref={uploadRef}
                        aria-label={t("ui.uploadFiles")}
                        type="file"
                        multiple
                        accept=".xlsx,.xls,.csv"
                        hidden
                        onChange={(e) => void upload(e.target.files)}
                      />
                    </div>
                    <div className="section-heading">
                      <h2>
                        {t("ui.importedFiles")}{" "}
                        <span className="count-pill">{files.length}</span>
                      </h2>
                      {files.length > 0 && (
                        <span>{t("ui.selectTheWorksheetsToMerge")}</span>
                      )}
                    </div>
                    {!files.length ? (
                      <div className="empty-files">
                        <FileSpreadsheet size={24} />
                        <div>
                          {t("ui.noFilesImportedYet")}
                          <small>
                            {t("ui.startWithSpreadsheetsFromAnySource")}
                          </small>
                        </div>
                      </div>
                    ) : (
                      <div className="file-list">
                        {files.map((f) => (
                          <div
                            className={`file-card ${f.error ? "has-error" : ""}`}
                            key={f.id}
                          >
                            <div className="file-title">
                              <span className="file-icon">
                                <FileSpreadsheet size={22} />
                              </span>
                              <div className="file-name">
                                <strong title={f.name}>{f.name}</strong>
                                <small>
                                  {(f.size / 1024).toFixed(1)} KB <span>·</span>{" "}
                                  {f.error
                                    ? t("ui.readFailed")
                                    : t("ui.worksheets", {
                                        p0: f.sheets.length,
                                      })}
                                </small>
                              </div>
                              <span
                                className={`badge ${f.error ? "red" : "green"}`}
                              >
                                {f.error
                                  ? t("ui.needsAttention")
                                  : t("ui.ready")}
                              </span>
                              <button
                                className="icon-btn"
                                aria-label={t("ui.expand", { p0: f.name })}
                                onClick={() =>
                                  setExpanded(expanded === f.id ? "" : f.id)
                                }
                              >
                                <ChevronDown
                                  className={expanded === f.id ? "rotated" : ""}
                                  size={17}
                                />
                              </button>
                              <button
                                className="icon-btn"
                                disabled={!!busy}
                                aria-label={t("ui.remove", { p0: f.name })}
                                onClick={() => void removeFile(f)}
                              >
                                <X size={17} />
                              </button>
                            </div>
                            {f.error && (
                              <p className="inline-error">{errorMessage(f)}</p>
                            )}
                            {f.sheets.map((s) => (
                              <label className="sheet-check" key={s.name}>
                                <input
                                  type="checkbox"
                                  disabled={!!busy || !!s.error}
                                  checked={
                                    assignments[keyFor(f, s)]?.enabled || false
                                  }
                                  onChange={(e) =>
                                    setAssignments((old) => ({
                                      ...old,
                                      [keyFor(f, s)]: {
                                        ...old[keyFor(f, s)],
                                        enabled: e.target.checked,
                                      },
                                    }))
                                  }
                                />
                                <Table2 size={14} />
                                <span>{s.name}</span>
                                {s.error ? (
                                  <small className="danger-text">
                                    {errorMessage(s)}
                                  </small>
                                ) : (
                                  <small>
                                    {t("ui.sheetDimensions", {
                                      rows: fmt(s.row_count),
                                      columns: s.headers.length,
                                    })}
                                  </small>
                                )}
                              </label>
                            ))}
                            {expanded === f.id && (
                              <div className="file-options">
                                {f.name.toLowerCase().endsWith(".csv") && (
                                  <label>
                                    {t("ui.characterEncoding")}
                                    <select
                                      disabled={!!busy}
                                      value={f.encoding}
                                      onChange={(e) =>
                                        void inspect(
                                          f,
                                          e.target.value,
                                          f.header_rows,
                                        )
                                      }
                                    >
                                      <option value="utf-8-sig">UTF-8</option>
                                      <option value="gb18030">
                                        {t("ui.gb18030LegacyChineseSystems")}
                                      </option>
                                    </select>
                                  </label>
                                )}
                                {f.sheets.map((s) => (
                                  <div className="source-preview" key={s.name}>
                                    <div className="source-preview-heading">
                                      <strong>{s.name}</strong>
                                      <label>
                                        {t("ui.headerRow")}
                                        <input
                                          aria-label={t("ui.headerRow57", {
                                            p0: s.name,
                                          })}
                                          type="number"
                                          min="1"
                                          max="1000"
                                          defaultValue={s.header_row}
                                          key={`${s.name}-${s.header_row}`}
                                          onBlur={(e) => {
                                            if (
                                              Number(e.target.value) !==
                                              s.header_row
                                            )
                                              void inspect(f, f.encoding, {
                                                ...f.header_rows,
                                                [s.name]: Number(
                                                  e.target.value,
                                                ),
                                              });
                                          }}
                                          disabled={!!busy}
                                        />
                                      </label>
                                    </div>
                                    {!s.error && (
                                      <div className="table-scroll">
                                        <table>
                                          <thead>
                                            <tr>
                                              {s.headers.map((h, i) => (
                                                <th key={i}>{h}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {s.sample.slice(0, 5).map((r) => (
                                              <tr key={r.row}>
                                                {s.headers.map((_, i) => (
                                                  <td key={i}>
                                                    {show(r.values[i])}
                                                  </td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <aside className="batch-sidebar">
                    <div className="panel overview">
                      <div className="panel-title">
                        <ClipboardList size={18} />
                        <h3>{t("ui.batchOverview")}</h3>
                      </div>
                      <div className="big-stat">
                        {fmt(rowCount)}
                        <span>{t("ui.rowsToMerge")}</span>
                      </div>
                      <div className="overview-row">
                        <span>{t("ui.importedFiles")}</span>
                        <strong>{files.length} / 30</strong>
                      </div>
                      <div className="overview-row">
                        <span>{t("ui.selectedWorksheets")}</span>
                        <strong>{selections.length}</strong>
                      </div>
                      <div className="overview-row">
                        <span>{t("ui.outputFormat")}</span>
                        <strong>
                          {selectedTemplate
                            ? t("ui.outputColumns", {
                                count: selectedTemplate.template.columns.length,
                              })
                            : t("templates.notSelected")}
                        </strong>
                      </div>
                      <div className="template-label">
                        <Table2 size={15} />
                        {selectedTemplate
                          ? selectedTemplate.template.name
                          : t("templates.notSelected")}
                      </div>
                      {rowCount > 100000 && (
                        <p className="inline-error">
                          {t("ui.moreThan100000RowsSelectLess")}
                        </p>
                      )}
                      <button
                        className="btn primary full"
                        disabled={blockers || !!busy}
                        onClick={() => {
                          setError(null);
                          goStep(2);
                        }}
                      >
                        {t("templates.nextConfirm")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="tip-card">
                      <Sparkles size={19} />
                      <h3>{t("ui.configureOnceReuseNextTime")}</h3>
                      <p>{t("ui.saveAMappingForEachSourceMatching")}</p>
                    </div>
                    <div className="quiet-note">
                      <LockKeyhole size={14} />
                      <span>
                        {t("ui.yourOriginalFilesStayUnchanged")}
                        <br />
                        {t("ui.theMergedResultIsSavedAsA")}
                      </span>
                    </div>
                  </aside>
                </div>
              )}
              {step === 2 && (
                <TemplateSelector
                  templates={savedTemplates}
                  selectedId={selectedTemplateId}
                  busy={!!busy}
                  onSelect={(id) => {
                    if (id !== selectedTemplateId) {
                      setSelectedTemplateId(id);
                      invalidateTemplate();
                    }
                  }}
                  onManage={manageTemplates}
                  onBack={() => setStep(1)}
                  onConfirm={() => void confirmTemplate()}
                />
              )}
              {step === 3 && (
                <>
                  <div className="panel section-panel">
                    <div className="section-heading">
                      <div>
                        <h2>{t("ui.confirmTheMappingForEachSource")}</h2>
                        <p>{t("ui.rulesAreSuggestedByHeaderNamesReview")}</p>
                      </div>
                      <span className="badge green">
                        {t("ui.confirmedCount", {
                          confirmed,
                          total: selections.length,
                        })}
                      </span>
                    </div>
                    {selections.map((s) => (
                      <div className="rule-assignment" key={s.key}>
                        <span className="file-icon">
                          <FileSpreadsheet size={21} />
                        </span>
                        <div className="rule-source">
                          <strong>{s.file.name}</strong>
                          <small>
                            {t("ui.sheetRowCount", {
                              sheet: s.sheet.name,
                              rows: fmt(s.sheet.row_count),
                            })}
                          </small>
                        </div>
                        <div className="rule-picker">
                          <select
                            aria-label={t("ui.sourceRule", { p0: s.file.name })}
                            value={s.assignment.rule?.id || ""}
                            onChange={(e) => {
                              const rule = library.rules.find(
                                (r) => r.id === e.target.value,
                              );
                              setAssignments((old) => ({
                                ...old,
                                [s.key]: {
                                  ...old[s.key],
                                  rule: rule
                                    ? reconcileRule(rule, library.template)
                                    : null,
                                  confirmed: false,
                                },
                              }));
                            }}
                          >
                            <option value="">
                              {t("ui.selectARuleOrCreateAMapping")}
                            </option>
                            {s.assignment.rule &&
                              !library.rules.some(
                                (r) => r.id === s.assignment.rule?.id,
                              ) && (
                                <option value={s.assignment.rule.id}>
                                  {s.assignment.rule.name}
                                  {t("ui.thisBatchOnly")}
                                </option>
                              )}
                            {library.rules
                              .filter(
                                (r) =>
                                  signature(r.headers) ===
                                  signature(s.sheet.headers),
                              )
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                          </select>
                          <small>
                            {s.assignment.confirmed ? (
                              <span className="success-text">
                                {t("ui.mappingConfirmed")}
                              </span>
                            ) : s.assignment.rule ? (
                              t("ui.suggestedMatchOpenItToReviewAnd")
                            ) : (
                              t("ui.noUniqueMatchConfigureAMapping")
                            )}
                          </small>
                        </div>
                        <button
                          className={`btn ${s.assignment.confirmed ? "subtle" : "secondary"}`}
                          onClick={() =>
                            setEditor({
                              key: s.key,
                              rule: reconcileRule(
                                s.assignment.rule ||
                                  newRule(
                                    s.sheet.headers,
                                    library.template,
                                    s.file.name.replace(/\.[^.]+$/, "") +
                                      t("ui.rule"),
                                  ),
                                library.template,
                              ),
                            })
                          }
                        >
                          {s.assignment.confirmed ? (
                            <Check size={15} />
                          ) : (
                            <Settings2 size={15} />
                          )}{" "}
                          {s.assignment.confirmed
                            ? t("ui.viewMapping")
                            : t("ui.configureConfirm")}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="wizard-footer">
                    <button className="btn subtle" onClick={() => goStep(2)}>
                      <ArrowLeft size={16} />
                      {t("templates.backToConfirmation")}
                    </button>
                    <button
                      className="btn primary"
                      disabled={
                        confirmed !== selections.length || blockers || !!busy
                      }
                      onClick={() => void loadPreview()}
                    >
                      {renderMessage(busy) || t("ui.previewConvertedData")}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {step === 4 && (
                <>
                  <div className="panel section-panel">
                    <div className="section-heading">
                      <div>
                        <h2>{t("ui.checkTheConversionBeforeMerging")}</h2>
                        <p>{t("ui.previewCount", { count: fmt(rowCount) })}</p>
                      </div>
                      <span className="badge neutral">{t("ui.preview")}</span>
                    </div>
                    <ResultTable rows={preview} template={library.template} />
                    <div className="preview-note">
                      <CircleAlert size={16} />
                      {t("ui.problemRowsAreIsolatedValidRowsCan")}
                    </div>
                  </div>
                  <div className="wizard-footer">
                    <button className="btn subtle" onClick={() => setStep(3)}>
                      <ArrowLeft size={16} />
                      {t("ui.backToRules")}
                    </button>
                    <button
                      className="btn primary"
                      disabled={!!busy}
                      onClick={() => void start()}
                    >
                      <Layers3 size={17} />
                      {renderMessage(busy) || t("ui.startMerge")}
                    </button>
                  </div>
                </>
              )}
              {step === 5 && job && (
                <>
                  {running ? (
                    <div className="panel processing">
                      <LoaderCircle size={40} className="spin" />
                      <h2>{t(job.phase_code)}</h2>
                      <p>
                        {t("ui.processedCount", {
                          processed: fmt(job.processed),
                          total: fmt(job.total),
                        })}
                      </p>
                      <div className="progress-track">
                        <div
                          style={{
                            width: `${Math.min(100, job.total ? (job.processed / job.total) * 100 : 100)}%`,
                          }}
                        />
                      </div>
                      <span>{t("ui.keepTheToolRunningDownloadTheResult")}</span>
                    </div>
                  ) : job.status === "failed" ? (
                    <div className="panel processing">
                      <CircleAlert size={36} />
                      <h2>{t("ui.thisMergeCouldNotBeCompleted")}</h2>
                      <p>{errorMessage(job)}</p>
                      <button
                        className="btn secondary"
                        onClick={() => setStep(3)}
                      >
                        {t("ui.backToCheckRules")}
                      </button>
                    </div>
                  ) : (
                    job.summary && (
                      <>
                        <div className="result-banner">
                          <span className="result-check">
                            <CheckCheck size={26} />
                          </span>
                          <div>
                            <h2>{t("ui.mergeCompleteYourResultIsReady")}</h2>
                            <p>
                              {t("ui.resultSources", {
                                files: files.length,
                                sheets: selections.length,
                              })}
                            </p>
                          </div>
                          <a
                            className="btn primary"
                            href={`/api/jobs/${job.id}/export`}
                          >
                            <Download size={17} />
                            {t("ui.downloadMergedExcel")}
                          </a>
                        </div>
                        <div className="result-stats">
                          {[
                            { label: t("ui.rowsRead"), n: job.summary.read },
                            { label: t("ui.validRows"), n: job.summary.valid },
                            {
                              label: t("ui.problemRowsIsolated"),
                              n: job.summary.issues,
                            },
                            {
                              label: t("ui.duplicateGroupRowsRetained"),
                              n: job.summary.duplicate_rows,
                            },
                          ].map((s, i) => (
                            <div
                              className={`panel result-stat stat-${i}`}
                              key={s.label}
                            >
                              <span>{s.label}</span>
                              <strong>{fmt(s.n)}</strong>
                            </div>
                          ))}
                        </div>
                        <div className="panel section-panel">
                          <div className="result-tabs">
                            <button
                              className={
                                kind === "valid" && !duplicatesOnly
                                  ? "selected"
                                  : ""
                              }
                              onClick={() => {
                                setKind("valid");
                                setDuplicatesOnly(false);
                                setPage(1);
                              }}
                            >
                              {t("ui.validRows")}
                              <span>{fmt(job.summary.valid)}</span>
                            </button>
                            <button
                              className={kind === "issues" ? "selected" : ""}
                              onClick={() => {
                                setKind("issues");
                                setDuplicatesOnly(false);
                                setPage(1);
                              }}
                            >
                              {t("ui.problemRows")}
                              <span>{fmt(job.summary.issues)}</span>
                            </button>
                            <button
                              className={duplicatesOnly ? "selected" : ""}
                              onClick={() => {
                                setKind("valid");
                                setDuplicatesOnly(true);
                                setPage(1);
                              }}
                            >
                              {t("ui.duplicateWarnings")}{" "}
                              <span>{fmt(job.summary.duplicate_rows)}</span>
                            </button>
                          </div>
                          {loadingRows ? (
                            <div className="loading-table">
                              <LoaderCircle size={20} className="spin" />
                              {t("ui.loadingResults")}
                            </div>
                          ) : (
                            <ResultTable
                              rows={results.rows}
                              template={job.template}
                              issues={kind === "issues"}
                            />
                          )}
                          <div className="pagination">
                            <span>
                              {t("ui.paginationSummary", {
                                count: fmt(results.total),
                              })}
                            </span>
                            <div>
                              <button
                                className="icon-btn"
                                disabled={page <= 1 || loadingRows}
                                aria-label={t("ui.previousPage")}
                                onClick={() => setPage((p) => p - 1)}
                              >
                                <ArrowLeft size={16} />
                              </button>
                              <span>
                                {page} /{" "}
                                {Math.max(1, Math.ceil(results.total / 50))}
                              </span>
                              <button
                                className="icon-btn"
                                disabled={
                                  page >= Math.ceil(results.total / 50) ||
                                  loadingRows
                                }
                                aria-label={t("ui.nextPage")}
                                onClick={() => setPage((p) => p + 1)}
                              >
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="export-explanation">
                          <FileSpreadsheet size={19} />
                          <span>{t("ui.exportExplanation")}</span>
                        </div>
                      </>
                    )
                  )}
                </>
              )}
            </>
          )}
          {view === "rules" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {t("ui.keepYourCleanupKnowHow")}
                  </div>
                  <h1>{t("ui.sourceRules")}</h1>
                  <p>{t("ui.manageFieldMappingsAndCleanupSettingsFor")}</p>
                </div>
                <div className="button-group">
                  <button
                    className="btn secondary"
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={16} />
                    {t("ui.importRuleLibrary")}
                  </button>
                  <a className="btn secondary" href="/api/config/export">
                    <Download size={16} />
                    {t("ui.exportRuleLibrary")}
                  </a>
                </div>
                <input
                  type="file"
                  accept=".json"
                  ref={importRef}
                  hidden
                  aria-label={t("ui.importRuleLibrary")}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (
                      !confirm(
                        t("ui.importingWillReplaceTheCurrentTemplateAnd"),
                      )
                    ) {
                      e.target.value = "";
                      return;
                    }
                    await action(msg("ui.importingRuleLibrary"), async () => {
                      if (file.size > 2 * 1024 * 1024)
                        throw new LocalizedError("ui.theRuleFileExceeds2Mb");
                      const data = JSON.parse(await file.text());
                      setLibrary(
                        await api<Library>("/config/import", "POST", data),
                      );
                      setAssignments((old) =>
                        Object.fromEntries(
                          Object.entries(old).map(([k, a]) => [
                            k,
                            { ...a, rule: null, confirmed: false },
                          ]),
                        ),
                      );
                      setStep(1);
                      setSelectedTemplateId(null);
                      setPreview([]);
                      setJob(null);
                      setNotice(
                        msg("ui.ruleLibraryImportedConfirmTheMappingsFor"),
                      );
                    });
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="panel section-panel">
                {!library.rules.length ? (
                  <div className="large-empty">
                    <Settings2 size={34} />
                    <h2>{t("ui.noSourceRulesSavedYet")}</h2>
                    <p>{t("ui.importASpreadsheetAndSaveIts")}</p>
                    <button
                      className="btn primary"
                      onClick={() => {
                        setView("merge");
                        setStep(1);
                      }}
                    >
                      {t("ui.importFiles122")}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <table className="rules-table">
                    <thead>
                      <tr>
                        <th>{t("ui.ruleName")}</th>
                        <th>{t("ui.sourceHeaders")}</th>
                        <th>{t("ui.targetMapping")}</th>
                        <th>{t("ui.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {library.rules.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.name}</strong>
                            <small>
                              {t("ui.matchedByHeadersOnTheNextImport")}
                            </small>
                          </td>
                          <td>
                            <span className="header-tags">
                              {r.headers.slice(0, 3).map((h) => (
                                <span key={h}>{h}</span>
                              ))}
                              {r.headers.length > 3 && (
                                <span>+{r.headers.length - 3}</span>
                              )}
                            </span>
                          </td>
                          <td>
                            {t("ui.mappingColumns", {
                              count: r.mappings.length,
                            })}
                          </td>
                          <td>
                            <div className="button-group">
                              <button
                                className="btn subtle small"
                                onClick={() =>
                                  setEditor({
                                    rule: reconcileRule(r, library.template),
                                  })
                                }
                              >
                                {t("ui.edit")}
                              </button>
                              <button
                                className="icon-btn"
                                aria-label={t("ui.copy", { p0: r.name })}
                                onClick={() =>
                                  setEditor({
                                    rule: {
                                      ...reconcileRule(r, library.template),
                                      id: crypto.randomUUID(),
                                      name: r.name + t("ui.copy130"),
                                    },
                                  })
                                }
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                disabled={!!busy}
                                aria-label={t("ui.delete", { p0: r.name })}
                                onClick={() => {
                                  if (
                                    confirm(t("ui.delete132", { p0: r.name }))
                                  )
                                    void action(
                                      msg("ui.deletingRule"),
                                      async () => {
                                        setLibrary(
                                          await api<Library>(
                                            `/rules/${r.id}`,
                                            "DELETE",
                                          ),
                                        );
                                      },
                                    );
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
          {view === "template" && (
            <TemplateManager
              templates={savedTemplates}
              busy={!!busy}
              initialEdit={templateEditId}
              returnToBatch={returnFromTemplate}
              onReturn={() => {
                setReturnFromTemplate(false);
                setView("merge");
                goStep(2);
              }}
              perform={action}
              validate={(document) =>
                api("/templates/validate", "POST", document)
              }
              register={registerTemplate}
              remove={deleteTemplate}
              onReset={resetTemplate}
              onRegistered={(id) => {
                setNotice(msg("templates.saved"));
                if (returnFromTemplate) {
                  setSelectedTemplateId(id);
                  invalidateTemplate();
                  setReturnFromTemplate(false);
                  setView("merge");
                  setStep(2);
                  setTemplatePrompt(false);
                }
              }}
            />
          )}
          {view === "help" && (
            <UserGuide
              onReturn={() => {
                setView("merge");
              }}
            />
          )}
          <footer className="page-footer">
            <span>{t("ui.sheetMergerEverySourceOneConsistent")}</span>
            <span>
              <ShieldCheck size={13} />
              {t("ui.localProcessingReusableRules")}
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <RuleEditor
          rule={editor.rule}
          template={library.template}
          busy={!!busy}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
          source={
            editor.key
              ? selections.find((s) => s.key === editor.key)?.sheet
              : undefined
          }
          error={error}
        />
      )}
      {templatePrompt && (
        <TemplateRequiredDialog
          onClose={() => {
            setTemplatePrompt(false);
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLSelectElement>(
                  ".batch-template-picker select",
                )
                ?.focus(),
            );
          }}
          onCreate={() => {
            setTemplatePrompt(false);
            manageTemplates("");
          }}
        />
      )}
    </div>
  );
}
function ResultTable({
  rows,
  template,
  issues = false,
}: {
  rows: ResultRow[];
  template: Template;
  issues?: boolean;
}) {
  const { t } = useI18n();
  if (!rows.length)
    return (
      <div className="empty-results">
        <CheckCheck size={25} />
        <p>{issues ? t("ui.noProblemRows") : t("ui.noRecordsToShow")}</p>
      </div>
    );
  return (
    <div className="table-scroll result-table">
      <table>
        <thead>
          <tr>
            <th>{t("ui.sourceRow")}</th>
            {template.columns.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
            <th>{t("ui.checkResult")}</th>
            {issues && <th>{t("ui.originalValues")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, index) => (
            <tr key={index} className={r.reasons.length ? "row-warning" : ""}>
              <td className="provenance" title={`${r.file} / ${r.sheet}`}>
                <strong>{r.file}</strong>
                <small>
                  {t("ui.provenance", { sheet: r.sheet, row: r.row })}
                </small>
              </td>
              {template.columns.map((c, i) => (
                <td key={c.id} className={c.type === "number" ? "number" : ""}>
                  {show(r.values[i])}
                </td>
              ))}
              <td className="reason-cell">
                {r.reasons.length ? (
                  r.reasons.map((e, i) => (
                    <span className="reason" key={i}>
                      {e.column}: {e.code ? t(e.code, e.params) : e.reason}
                    </span>
                  ))
                ) : r.duplicate_group ? (
                  <span
                    className="badge amber"
                    title={t("ui.duplicateGroup", { p0: r.duplicate_group })}
                  >
                    {t("ui.duplicateRetained")}
                  </span>
                ) : (
                  <span className="success-text">
                    <Check size={13} />
                    {t("ui.passed")}
                  </span>
                )}
              </td>
              {issues && (
                <td className="raw-values" title={JSON.stringify(r.raw)}>
                  {JSON.stringify(r.raw)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function RuleEditor({
  rule,
  template,
  busy,
  onClose,
  onSave,
  source,
  error,
}: {
  rule: Rule;
  template: Template;
  busy: boolean;
  onClose: () => void;
  onSave: (r: Rule, s: boolean) => Promise<void>;
  source?: Sheet;
  error: Message | null;
}) {
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rule>(() => structuredClone(rule));
  const [saveLibrary, setSaveLibrary] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const invalid =
    !draft.name.trim() ||
    draft.mappings.some((m) => m.mode === "source" && m.source_index === null);
  function patch(id: string, change: Partial<Mapping>) {
    setDraft((old) => ({
      ...old,
      mappings: old.mappings.map((m) =>
        m.target_id === id ? { ...m, ...change } : m,
      ),
    }));
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const fields = Array.from(
          modalRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), summary",
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = fields[0],
          last = fields[fields.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
    };
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop">
      <div
        className="rule-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-editor-title"
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">{t("ui.sourceRules")}</div>
            <h2 id="rule-editor-title">{t("ui.configureFieldMapping")}</h2>
            <p>{t("ui.matchSourceColumnsToTargetColumnsOpen")}</p>
          </div>
          <button
            className="icon-btn"
            disabled={busy}
            aria-label={t("ui.closeMappingEditor")}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <div className="modal-body">
          {error && (
            <div className="alert error" role="alert">
              <CircleAlert size={17} />
              <span>{renderMessage(error)}</span>
            </div>
          )}
          <label className="rule-name-label">
            {t("ui.ruleName")}
            <input
              value={draft.name}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t("ui.eGSourceExport")}
            />
          </label>
          <div className="mapping-head">
            <span>{t("ui.standardTargetColumn")}</span>
            <span>{t("ui.sourceFillValue")}</span>
            <span>{t("ui.cleanupSettings")}</span>
          </div>
          {template.columns.map((col) => {
            const m = draft.mappings.find((x) => x.target_id === col.id)!;
            return (
              <div className="mapping-block" key={col.id}>
                <div className="mapping-row">
                  <div className="target-column">
                    <strong>
                      {col.name}
                      {col.required && <i>*</i>}
                    </strong>
                    <small>
                      {
                        {
                          text: t("ui.text"),
                          number: t("ui.number"),
                          date: t("ui.date"),
                        }[col.type]
                      }
                    </small>
                  </div>
                  <div className="mapping-source">
                    <ArrowLeft size={15} />
                    <select
                      aria-label={t("ui.sourceColumn", { p0: col.name })}
                      value={
                        m.mode === "source" ? `col:${m.source_index}` : m.mode
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        patch(
                          col.id,
                          v.startsWith("col:")
                            ? {
                                mode: "source",
                                source_index: Number(v.slice(4)),
                              }
                            : {
                                mode: v as "fixed" | "empty",
                                source_index: null,
                              },
                        );
                      }}
                    >
                      <option value="empty">
                        {t("ui.leaveEmptyUseEmptyValueFill")}
                      </option>
                      <option value="fixed">{t("ui.fixedValue")}</option>
                      {draft.headers.map((h, i) => (
                        <option key={i} value={`col:${i}`}>
                          {h}
                        </option>
                      ))}
                    </select>
                    {m.mode === "fixed" && (
                      <input
                        aria-label={t("ui.fixedValue175", { p0: col.name })}
                        value={m.fixed}
                        onChange={(e) =>
                          patch(col.id, { fixed: e.target.value })
                        }
                        placeholder={t("ui.enterAFixedValue")}
                      />
                    )}
                  </div>
                  <button
                    className={`btn subtle small ${expanded === col.id ? "success-text" : ""}`}
                    onClick={() =>
                      setExpanded(expanded === col.id ? null : col.id)
                    }
                  >
                    <Settings2 size={14} />
                    {m.replacements.length || m.fill
                      ? t("ui.configured")
                      : t("ui.settings")}
                    <ChevronDown size={13} />
                  </button>
                </div>
                {expanded === col.id && (
                  <div className="mapping-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={m.trim}
                        onChange={(e) =>
                          patch(col.id, { trim: e.target.checked })
                        }
                      />
                      {t("ui.trimLeadingAndTrailingWhitespace")}
                    </label>
                    <label>
                      {t("ui.fillEmptyValues")}
                      <input
                        value={m.fill}
                        onChange={(e) =>
                          patch(col.id, { fill: e.target.value })
                        }
                        placeholder={t("ui.leaveBlankForNoFill")}
                      />
                    </label>
                    {col.type === "date" && (
                      <label>
                        {t("ui.sourceDateFormat")}
                        <select
                          value={m.date_format}
                          onChange={(e) =>
                            patch(col.id, { date_format: e.target.value })
                          }
                        >
                          {[
                            ["%Y-%m-%d", "2026-10-27"],
                            ["%Y/%m/%d", "2026/10/27"],
                            ["%Y%m%d", "20261027"],
                            ["%d/%m/%Y", t("ui.27102026DayMonthYear")],
                            ["%m/%d/%Y", t("ui.10272026MonthDayYear")],
                            ["%Y-%m-%d %H:%M:%S", "2026-10-27 12:30:00"],
                          ].map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {col.type === "number" && (
                      <label>
                        {t("ui.sourceNumberFormat")}
                        <select
                          value={m.number_style}
                          onChange={(e) =>
                            patch(col.id, { number_style: e.target.value })
                          }
                        >
                          <option value="comma">1,234.56 / 1234.56</option>
                          <option value="plain">
                            {t("ui.123456NoThousandsSeparator")}
                          </option>
                          <option value="european">1.234,56 / 1234,56</option>
                        </select>
                      </label>
                    )}
                    <div className="replacements">
                      <span>
                        {t("ui.replaceExactValues")}{" "}
                        <small>{t("ui.matchesTheEntireCellStopsAtThe")}</small>
                      </span>
                      {m.replacements.map((r, i) => (
                        <div className="replacement-row" key={i}>
                          <input
                            aria-label={t("ui.originalValue", {
                              p0: col.name,
                              p1: i + 1,
                            })}
                            placeholder={t("ui.originalValue190")}
                            value={r.before}
                            onChange={(e) =>
                              patch(col.id, {
                                replacements: m.replacements.map((x, j) =>
                                  j === i
                                    ? { ...x, before: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                          <ArrowRight size={14} />
                          <input
                            aria-label={t("ui.replacementValue", {
                              p0: col.name,
                              p1: i + 1,
                            })}
                            placeholder={t("ui.replaceWith")}
                            value={r.after}
                            onChange={(e) =>
                              patch(col.id, {
                                replacements: m.replacements.map((x, j) =>
                                  j === i ? { ...x, after: e.target.value } : x,
                                ),
                              })
                            }
                          />
                          <button
                            className="icon-btn"
                            aria-label={t("ui.removeReplacement")}
                            onClick={() =>
                              patch(col.id, {
                                replacements: m.replacements.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="btn subtle small"
                        onClick={() =>
                          patch(col.id, {
                            replacements: [
                              ...m.replacements,
                              { before: "", after: "" },
                            ],
                          })
                        }
                      >
                        <Plus size={14} />
                        {t("ui.addReplacement")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {source && (
            <details className="editor-source">
              <summary>{t("ui.viewSourceSampleFirst5Rows")}</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {source.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {source.sample.slice(0, 5).map((r) => (
                      <tr key={r.row}>
                        {source.headers.map((_, i) => (
                          <td key={i}>{show(r.values[i])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="mapping-notice">
            <CircleAlert size={15} />
            {t("ui.targetsMarkedAreRequiredRowsWithAn")}
          </div>
        </div>
        <div className="modal-footer">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={saveLibrary}
              onChange={(e) => setSaveLibrary(e.target.checked)}
            />
            {t("ui.saveToTheRuleLibraryForNext")}
          </label>
          <div className="button-group">
            <button className="btn secondary" disabled={busy} onClick={onClose}>
              {t("ui.cancel")}
            </button>
            <button
              className="btn primary"
              disabled={busy || invalid}
              onClick={() =>
                void onSave({ ...draft, name: draft.name.trim() }, saveLibrary)
              }
            >
              <Check size={16} />
              {busy ? t("ui.saving") : t("ui.confirmMapping")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
function TemplateRequiredDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: () => void;
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
      aria-labelledby="template-required-title"
      aria-describedby="template-required-description"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="template-required-heading">
        <span className="file-icon">
          <Table2 size={25} />
        </span>
      </div>
      <h2 id="template-required-title">{t("ui.outputTemplateRequired")}</h2>
      <p id="template-required-description">
        {t("ui.outputTemplateRequiredDescription")}
      </p>
      <div className="button-group">
        <button className="btn secondary" onClick={onClose}>
          {t("templates.select")}
        </button>
        <button className="btn primary" autoFocus onClick={onCreate}>
          {t("templates.new")}
          <ArrowRight size={16} />
        </button>
      </div>
    </dialog>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
