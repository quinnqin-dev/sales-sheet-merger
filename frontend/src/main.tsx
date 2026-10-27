import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
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
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./style.css";

type Column = {
  id: string;
  name: string;
  type: "text" | "number" | "date";
  required: boolean;
};
type Template = { name: string; columns: Column[] };
type Mapping = {
  target_id: string;
  mode: "source" | "fixed" | "empty";
  source_index: number | null;
  fixed: string;
  trim: boolean;
  fill: string;
  replacements: { before: string; after: string }[];
  date_format: string;
  number_style: string;
};
type Rule = {
  id: string;
  name: string;
  headers: string[];
  mappings: Mapping[];
};
type Library = { version: 1; template: Template; rules: Rule[] };
type Sheet = {
  name: string;
  header_row: number;
  headers: string[];
  sample: { row: number; values: unknown[] }[];
  row_count: number;
  blank_count: number;
  error?: string;
};
type SourceFile = {
  id: string;
  name: string;
  size: number;
  encoding: string;
  header_rows: Record<string, number>;
  error?: string;
  sheets: Sheet[];
};
type Assignment = { enabled: boolean; rule: Rule | null; confirmed: boolean };
type ResultRow = {
  file: string;
  sheet: string;
  row: number;
  values: unknown[];
  raw: unknown[];
  reasons: { column: string; reason: string }[];
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
  processed: number;
  total: number;
  summary: Summary | null;
  error?: string;
  template: Template;
};
const keyFor = (f: SourceFile, s: Sheet) => `${f.id}:${s.name}`;
const fmt = (n: number) => n.toLocaleString("zh-CN");
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
    headers:
      body !== undefined && !isForm
        ? { "Content-Type": "application/json" }
        : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const result = await res.json();
      message =
        typeof result.detail === "string"
          ? result.detail
          : "配置格式不正确，请检查输入";
    } catch {
      /* keep status */
    }
    throw new Error(message);
  }
  return res.json();
}

const aliases: Record<string, string[]> = {
  date: ["日期", "销售日期", "交易日期", "下单日期", "date", "sale_date"],
  order_id: ["订单号", "订单编号", "order_id", "order no"],
  sku: ["商品编码", "商品编号", "sku", "货号"],
  product: ["商品名称", "产品名称", "品名", "product"],
  quantity: ["数量", "销量", "销售数量", "quantity", "qty"],
  price: ["单价", "销售单价", "price"],
  amount: ["销售额", "销售金额", "实付金额", "金额", "amount"],
  channel: ["渠道", "销售渠道", "平台", "channel"],
};
function newRule(
  headers: string[],
  template: Template,
  name = "新来源规则",
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
  const [library, setLibrary] = useState<Library | null>(null);
  const [view, setView] = useState("merge");
  const [step, setStep] = useState(1);
  const [batch, setBatch] = useState("");
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>(
    {},
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState("");
  const [editor, setEditor] = useState<{ rule: Rule; key?: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<ResultRow[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [kind, setKind] = useState("valid");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<{ rows: ResultRow[]; total: number }>({
    rows: [],
    total: 0,
  });
  const [loadingRows, setLoadingRows] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const running = job?.status === "running";
  const template = library?.template;
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
      .then(setLibrary)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
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
          if (next.status === "failed") setError(next.error || "处理失败");
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
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
    api<{ rows: ResultRow[]; total: number }>(
      `/jobs/${job.id}/rows?kind=${kind}&page=${page}&duplicates_only=${duplicatesOnly}`,
    )
      .then((r) => {
        if (!stopped) setResults(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!stopped) setLoadingRows(false);
      });
    return () => {
      stopped = true;
    };
  }, [job?.id, job?.status, kind, page, duplicatesOnly]);

  async function action(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
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
            rule:
              matches.length === 1
                ? reconcileRule(matches[0], library!.template)
                : null,
            confirmed: false,
          };
        }
      return updated;
    });
  }
  async function upload(list: FileList | File[] | null) {
    if (!list?.length || busy || running) return;
    if (files.length + list.length > 30) {
      setError("每批最多 30 个文件");
      return;
    }
    await action("正在读取文件…", async () => {
      let id = batch;
      if (!id) {
        id = (await api<{ id: string }>("/batches", "POST")).id;
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
    await action("移除文件…", async () => {
      await api(`/batches/${batch}/files/${f.id}`, "DELETE");
      setFiles((old) => old.filter((x) => x.id !== f.id));
    });
  }
  async function inspect(
    f: SourceFile,
    encoding: string,
    headerRows: Record<string, number>,
  ) {
    await action("重新检查文件…", async () => {
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
            rule:
              matches.length === 1
                ? reconcileRule(matches[0], library!.template)
                : null,
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
    await action("正在生成预览…", async () => {
      const data = await api<{ rows: ResultRow[] }>(
        `/batches/${batch}/preview`,
        "POST",
        payload(),
      );
      setPreview(data.rows);
      setStep(3);
    });
  }
  async function start() {
    await action("启动合并…", async () => {
      setKind("valid");
      setPage(1);
      setDuplicatesOnly(false);
      setResults({ rows: [], total: 0 });
      const next = await api<Job>(`/batches/${batch}/jobs`, "POST", payload());
      setJob(next);
      setStep(4);
    });
  }
  async function saveEditor(rule: Rule, saveToLibrary: boolean) {
    await action("保存规则…", async () => {
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
        saveToLibrary ? "规则已保存，下次导入时可复用" : "本次映射已确认",
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
    setError("");
  }
  if (!library)
    return (
      <div className="boot">
        <Layers3 size={38} />
        <h2>归表</h2>
        <p>{error || "正在打开本机工作台…"}</p>
        {error && <button onClick={() => location.reload()}>重新连接</button>}
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
          }}
        >
          <span className="brand-icon">
            <Layers3 size={24} />
          </span>
          <span>
            归表<small>SALES WORKSPACE</small>
          </span>
        </a>
        <div className="nav-label">工作空间</div>
        <nav>
          {[
            { id: "merge", label: "批量合并", icon: FolderOpen },
            { id: "rules", label: "来源规则", icon: Settings2 },
            { id: "template", label: "标准模板", icon: Table2 },
          ].map((item) => (
            <button
              className={view === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              disabled={!!busy || running}
              onClick={() => {
                setView(item.id);
                setError("");
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
          <strong>数据留在你的电脑</strong>
          <p>文件在本机完成处理。规则会保留，临时数据在退出后清理。</p>
          <span className="small-tag">
            <span className="status-dot" />
            本机运行
          </span>
        </div>
        <button
          className={`nav-item help ${view === "help" ? "active" : ""}`}
          disabled={!!busy || running}
          onClick={() => setView("help")}
        >
          <HelpCircle size={18} />
          使用指南
          <ChevronRight size={14} />
        </button>
        <div className="sidebar-version">
          归表 v1.0 <span>为重复的整理工作减负</span>
        </div>
      </aside>
      <div className="workspace" inert={!!editor}>
        <header className="topbar">
          <div>
            工作空间 <ChevronRight size={13} />{" "}
            <span>
              {
                {
                  merge: "批量合并",
                  rules: "来源规则",
                  template: "标准模板",
                  help: "使用指南",
                }[view]
              }
            </span>
          </div>
          <span className="local-indicator">
            <LockKeyhole size={13} />
            本机处理 · 无需上传云端
          </span>
        </header>
        <main>
          {error && (
            <div role="alert" className="alert error">
              <CircleAlert size={18} />
              <span>{error}</span>
              <button aria-label="关闭提示" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              <CheckCheck size={18} />
              {notice}
            </div>
          )}
          {view === "merge" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">一份标准，连接每个销售来源</div>
                  <h1>销售表批量合并</h1>
                  <p>把不同格式的销售明细，整理成一张清晰的标准表。</p>
                </div>
                {files.length > 0 && !running && (
                  <button
                    className="btn subtle"
                    disabled={!!busy}
                    onClick={reset}
                  >
                    <Plus size={16} />
                    新建批次
                  </button>
                )}
              </div>
              <div className="steps">
                {["导入文件", "配置规则", "预览检查", "合并导出"].map(
                  (label, i) => (
                    <React.Fragment key={label}>
                      <button
                        disabled={!!busy || running || i + 1 > step}
                        onClick={() => setStep(i + 1)}
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
                      {i < 3 && (
                        <div
                          className={`step-line ${step > i + 1 ? "filled" : ""}`}
                        />
                      )}
                    </React.Fragment>
                  ),
                )}
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
                      <h2>{busy || "把销售文件拖到这里"}</h2>
                      <p>支持不同来源的 Excel 和 CSV，一次选择多个文件</p>
                      <button
                        className="btn primary"
                        disabled={!!busy}
                        onClick={() => uploadRef.current?.click()}
                      >
                        <Plus size={17} />
                        选择文件
                      </button>
                      <div className="upload-limits">
                        .xlsx / .csv <span>·</span> 最多 30 个文件{" "}
                        <span>·</span> 合计 10 万行
                      </div>
                      <input
                        ref={uploadRef}
                        aria-label="上传销售文件"
                        type="file"
                        multiple
                        accept=".xlsx,.csv"
                        hidden
                        onChange={(e) => void upload(e.target.files)}
                      />
                    </div>
                    <div className="section-heading">
                      <h2>
                        已导入文件{" "}
                        <span className="count-pill">{files.length}</span>
                      </h2>
                      {files.length > 0 && <span>选择需要合并的工作表</span>}
                    </div>
                    {!files.length ? (
                      <div className="empty-files">
                        <FileSpreadsheet size={24} />
                        <div>
                          还没有导入文件
                          <small>
                            从电商平台、门店或销售系统导出的明细都可以从这里开始。
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
                                    ? "读取失败"
                                    : `${f.sheets.length} 个工作表`}
                                </small>
                              </div>
                              <span
                                className={`badge ${f.error ? "red" : "green"}`}
                              >
                                {f.error ? "需处理" : "已读取"}
                              </span>
                              <button
                                className="icon-btn"
                                aria-label={`展开 ${f.name}`}
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
                                aria-label={`移除 ${f.name}`}
                                onClick={() => void removeFile(f)}
                              >
                                <X size={17} />
                              </button>
                            </div>
                            {f.error && (
                              <p className="inline-error">{f.error}</p>
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
                                    {s.error}
                                  </small>
                                ) : (
                                  <small>
                                    {fmt(s.row_count)} 行 · {s.headers.length}{" "}
                                    列
                                  </small>
                                )}
                              </label>
                            ))}
                            {expanded === f.id && (
                              <div className="file-options">
                                {f.name.toLowerCase().endsWith(".csv") && (
                                  <label>
                                    字符编码
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
                                        GB18030（中文旧系统）
                                      </option>
                                    </select>
                                  </label>
                                )}
                                {f.sheets.map((s) => (
                                  <div className="source-preview" key={s.name}>
                                    <div className="source-preview-heading">
                                      <strong>{s.name}</strong>
                                      <label>
                                        表头行
                                        <input
                                          aria-label={`${s.name} 表头行`}
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
                        <h3>本批概览</h3>
                      </div>
                      <div className="big-stat">
                        {fmt(rowCount)}
                        <span>待合并明细</span>
                      </div>
                      <div className="overview-row">
                        <span>已导入文件</span>
                        <strong>{files.length} / 30</strong>
                      </div>
                      <div className="overview-row">
                        <span>已选工作表</span>
                        <strong>{selections.length}</strong>
                      </div>
                      <div className="overview-row">
                        <span>输出格式</span>
                        <strong>
                          Excel · {library.template.columns.length} 列
                        </strong>
                      </div>
                      <div className="template-label">
                        <Table2 size={15} />
                        {library.template.name}
                      </div>
                      {rowCount > 100000 && (
                        <p className="inline-error">超过 10 万行，请减少选择</p>
                      )}
                      <button
                        className="btn primary full"
                        disabled={blockers || !!busy}
                        onClick={() => {
                          setStep(2);
                          setError("");
                        }}
                      >
                        下一步：配置规则
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="tip-card">
                      <Sparkles size={19} />
                      <h3>整理一次，下次复用</h3>
                      <p>
                        为不同来源保存映射规则，下次导入相同表头时会自动建议匹配。
                      </p>
                    </div>
                    <div className="quiet-note">
                      <LockKeyhole size={14} />
                      <span>
                        原始文件保持不变
                        <br />
                        合并结果将另存为新文件
                      </span>
                    </div>
                  </aside>
                </div>
              )}
              {step === 2 && (
                <>
                  <div className="panel section-panel">
                    <div className="section-heading">
                      <div>
                        <h2>确认每个来源的映射规则</h2>
                        <p>
                          按表头建议规则，确认后再处理。不同列顺序会自动按列名对应。
                        </p>
                      </div>
                      <span className="badge green">
                        {confirmed} / {selections.length} 已确认
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
                            {s.sheet.name} · {fmt(s.sheet.row_count)} 行
                          </small>
                        </div>
                        <div className="rule-picker">
                          <select
                            aria-label={`${s.file.name} 来源规则`}
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
                            <option value="">选择规则或新建映射</option>
                            {s.assignment.rule &&
                              !library.rules.some(
                                (r) => r.id === s.assignment.rule?.id,
                              ) && (
                                <option value={s.assignment.rule.id}>
                                  {s.assignment.rule.name}（仅本次）
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
                              <span className="success-text">映射已确认</span>
                            ) : s.assignment.rule ? (
                              "已建议匹配，请打开检查并确认"
                            ) : (
                              "未找到唯一匹配，请配置映射"
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
                                      "规则",
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
                          {s.assignment.confirmed ? "查看映射" : "配置并确认"}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="wizard-footer">
                    <button className="btn subtle" onClick={() => setStep(1)}>
                      <ArrowLeft size={16} />
                      返回导入
                    </button>
                    <button
                      className="btn primary"
                      disabled={
                        confirmed !== selections.length || blockers || !!busy
                      }
                      onClick={() => void loadPreview()}
                    >
                      {busy || "预览转换结果"}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <div className="panel section-panel">
                    <div className="section-heading">
                      <div>
                        <h2>合并前，检查转换效果</h2>
                        <p>
                          显示选中数据的前 20 行。正式合并时会检查全部{" "}
                          {fmt(rowCount)} 行。
                        </p>
                      </div>
                      <span className="badge neutral">预览</span>
                    </div>
                    <ResultTable rows={preview} template={library.template} />
                    <div className="preview-note">
                      <CircleAlert size={16} />
                      问题行会单独隔离；有效行正常导出。完全重复的有效记录会保留并提示。
                    </div>
                  </div>
                  <div className="wizard-footer">
                    <button className="btn subtle" onClick={() => setStep(2)}>
                      <ArrowLeft size={16} />
                      返回调整规则
                    </button>
                    <button
                      className="btn primary"
                      disabled={!!busy}
                      onClick={() => void start()}
                    >
                      <Layers3 size={17} />
                      {busy || "开始合并"}
                    </button>
                  </div>
                </>
              )}
              {step === 4 && job && (
                <>
                  {running ? (
                    <div className="panel processing">
                      <LoaderCircle size={40} className="spin" />
                      <h2>{job.phase}</h2>
                      <p>
                        已处理 {fmt(job.processed)} / {fmt(job.total)} 行
                      </p>
                      <div className="progress-track">
                        <div
                          style={{
                            width: `${Math.min(100, job.total ? (job.processed / job.total) * 100 : 100)}%`,
                          }}
                        />
                      </div>
                      <span>请保持工具运行，完成后即可下载结果。</span>
                    </div>
                  ) : job.status === "failed" ? (
                    <div className="panel processing">
                      <CircleAlert size={36} />
                      <h2>本次处理未完成</h2>
                      <p>{job.error}</p>
                      <button
                        className="btn secondary"
                        onClick={() => setStep(2)}
                      >
                        返回检查规则
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
                            <h2>合并完成，结果已准备好</h2>
                            <p>
                              {files.length} 个文件 · {selections.length}{" "}
                              个工作表 · 问题行与处理记录已一并整理
                            </p>
                          </div>
                          <a
                            className="btn primary"
                            href={`/api/jobs/${job.id}/export`}
                          >
                            <Download size={17} />
                            下载合并结果
                          </a>
                        </div>
                        <div className="result-stats">
                          {[
                            { label: "读取明细", n: job.summary.read },
                            { label: "有效明细", n: job.summary.valid },
                            { label: "问题行 · 已隔离", n: job.summary.issues },
                            {
                              label: "重复组内行 · 已保留",
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
                              有效明细 <span>{fmt(job.summary.valid)}</span>
                            </button>
                            <button
                              className={kind === "issues" ? "selected" : ""}
                              onClick={() => {
                                setKind("issues");
                                setDuplicatesOnly(false);
                                setPage(1);
                              }}
                            >
                              问题行 <span>{fmt(job.summary.issues)}</span>
                            </button>
                            <button
                              className={duplicatesOnly ? "selected" : ""}
                              onClick={() => {
                                setKind("valid");
                                setDuplicatesOnly(true);
                                setPage(1);
                              }}
                            >
                              重复提示{" "}
                              <span>{fmt(job.summary.duplicate_rows)}</span>
                            </button>
                          </div>
                          {loadingRows ? (
                            <div className="loading-table">
                              <LoaderCircle size={20} className="spin" />
                              正在读取结果…
                            </div>
                          ) : (
                            <ResultTable
                              rows={results.rows}
                              template={job.template}
                              issues={kind === "issues"}
                            />
                          )}
                          <div className="pagination">
                            <span>共 {fmt(results.total)} 行 · 每页 50 行</span>
                            <div>
                              <button
                                className="icon-btn"
                                disabled={page <= 1 || loadingRows}
                                aria-label="上一页"
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
                                aria-label="下一页"
                                onClick={() => setPage((p) => p + 1)}
                              >
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="export-explanation">
                          <FileSpreadsheet size={19} />
                          <span>
                            导出包含 <strong>销售明细、问题行、处理汇总</strong>{" "}
                            三个工作表；处理汇总包含精确数值合计及每行来源。
                          </span>
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
                  <div className="eyebrow">把整理经验保存下来</div>
                  <h1>来源规则</h1>
                  <p>管理不同销售来源的字段映射与清洗方式。</p>
                </div>
                <div className="button-group">
                  <button
                    className="btn secondary"
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={16} />
                    导入规则库
                  </button>
                  <a className="btn secondary" href="/api/config/export">
                    <Download size={16} />
                    导出规则库
                  </a>
                </div>
                <input
                  type="file"
                  accept=".json"
                  ref={importRef}
                  hidden
                  aria-label="导入规则库"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (
                      !confirm(
                        "导入将替换当前模板和全部规则。建议先导出备份，是否继续？",
                      )
                    ) {
                      e.target.value = "";
                      return;
                    }
                    await action("导入规则库…", async () => {
                      if (file.size > 2 * 1024 * 1024)
                        throw new Error("规则文件超过 2 MB");
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
                      setNotice("规则库已导入，请重新确认本批映射");
                    });
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="panel section-panel">
                {!library.rules.length ? (
                  <div className="large-empty">
                    <Settings2 size={34} />
                    <h2>还没有保存的来源规则</h2>
                    <p>导入一份销售表，在“配置规则”中保存第一次映射。</p>
                    <button
                      className="btn primary"
                      onClick={() => {
                        setView("merge");
                        setStep(1);
                      }}
                    >
                      去导入文件
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <table className="rules-table">
                    <thead>
                      <tr>
                        <th>规则名称</th>
                        <th>来源表头</th>
                        <th>目标映射</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {library.rules.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.name}</strong>
                            <small>下次导入时按表头匹配</small>
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
                          <td>{r.mappings.length} 列</td>
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
                                编辑
                              </button>
                              <button
                                className="icon-btn"
                                aria-label={`复制 ${r.name}`}
                                onClick={() =>
                                  setEditor({
                                    rule: {
                                      ...reconcileRule(r, library.template),
                                      id: crypto.randomUUID(),
                                      name: r.name + "（副本）",
                                    },
                                  })
                                }
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                disabled={!!busy}
                                aria-label={`删除 ${r.name}`}
                                onClick={() => {
                                  if (confirm(`确定删除“${r.name}”？`))
                                    void action("删除规则…", async () => {
                                      setLibrary(
                                        await api<Library>(
                                          `/rules/${r.id}`,
                                          "DELETE",
                                        ),
                                      );
                                    });
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
            <TemplateEditor
              template={library.template}
              busy={!!busy}
              onSave={async (t) => {
                await action("保存模板…", async () => {
                  setLibrary(await api<Library>("/template", "PUT", t));
                  setAssignments((old) =>
                    Object.fromEntries(
                      Object.entries(old).map(([k, a]) => [
                        k,
                        { ...a, confirmed: false },
                      ]),
                    ),
                  );
                  setStep(1);
                  setNotice("标准模板已保存，本批规则需重新确认");
                });
              }}
            />
          )}
          {view === "help" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">开始之前</div>
                  <h1>让下一次整理更轻松</h1>
                  <p>先用一小批文件确认规则，再处理完整批次。</p>
                </div>
              </div>
              <div className="help-grid">
                {[
                  {
                    n: "01",
                    title: "导入与选择",
                    text: "支持 .xlsx 和 .csv。默认选择每个文件的第一个可用工作表，可自行多选。展开文件查看原始预览、调整表头行；中文 CSV 乱码时选择 GB18030。",
                  },
                  {
                    n: "02",
                    title: "映射与清洗",
                    text: "为每个目标列选择源列、固定值或留空。清洗顺序是：去首尾空格 → 空值填充 → 精确值替换 → 类型转换。日期格式和数字分隔符需要明确选择。",
                  },
                  {
                    n: "03",
                    title: "检查与导出",
                    text: "先检查前 20 行，再执行全量合并。必填为空或转换失败的记录进入问题行。重复按全部目标字段判断，默认保留。每个导出明细行都能在处理汇总找到来源。",
                  },
                  {
                    n: "04",
                    title: "保存与复用",
                    text: "规则保存在本机，重启工具后仍然可用。下次相同表头会建议匹配，需要人工确认。规则库可导出 JSON 备份，也可导入到另一台电脑。",
                  },
                ].map((item) => (
                  <div className="panel help-card" key={item.n}>
                    <span>{item.n}</span>
                    <h2>{item.title}</h2>
                    <p>{item.text}</p>
                  </div>
                ))}
              </div>
              <div className="panel help-limits">
                <h3>首版处理边界</h3>
                <p>
                  单批最多 30 个文件、合计 10 万数据行；单文件最多 50
                  MB。不支持旧版
                  .xls、跨表关联、汇总统计或复杂合并单元格布局。公式仅读取已保存的计算缓存，缺少缓存时请先在
                  Excel 重新计算并保存。
                </p>
                <p>
                  订单号、商品编码建议在源文件中设为文本。工具会保留已有文本前导零和简单的补零显示格式；源文件已经丢失的位数无法恢复。金额不会自动计算、换币或调整单位。
                </p>
                <p>
                  临时数据在退出或下次启动时清理。规则库保存在本机应用数据目录；导出结果请保存到你选择的位置。
                </p>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>归表 · 让每份销售数据各归其位</span>
            <span>
              <ShieldCheck size={13} /> 本机处理，规则可复用
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
  if (!rows.length)
    return (
      <div className="empty-results">
        <CheckCheck size={25} />
        <p>{issues ? "没有问题行" : "这里暂无记录"}</p>
      </div>
    );
  return (
    <div className="table-scroll result-table">
      <table>
        <thead>
          <tr>
            <th>来源 / 行号</th>
            {template.columns.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
            <th>检查结果</th>
            {issues && <th>原始值</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, index) => (
            <tr key={index} className={r.reasons.length ? "row-warning" : ""}>
              <td className="provenance" title={`${r.file} / ${r.sheet}`}>
                <strong>{r.file}</strong>
                <small>
                  {r.sheet} · 第 {r.row} 行
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
                      {e.column}：{e.reason}
                    </span>
                  ))
                ) : r.duplicate_group ? (
                  <span
                    className="badge amber"
                    title={`重复组 ${r.duplicate_group}`}
                  >
                    重复 · 已保留
                  </span>
                ) : (
                  <span className="success-text">
                    <Check size={13} />
                    通过
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
  error: string;
}) {
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
            <div className="eyebrow">来源规则</div>
            <h2 id="rule-editor-title">配置字段映射</h2>
            <p>把来源列对应到标准列，展开设置可添加清洗规则。</p>
          </div>
          <button
            className="icon-btn"
            disabled={busy}
            aria-label="关闭规则配置"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <div className="modal-body">
          {error && (
            <div className="alert error" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
            </div>
          )}
          <label className="rule-name-label">
            规则名称
            <input
              value={draft.name}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="例如：淘宝店铺销售明细"
            />
          </label>
          <div className="mapping-head">
            <span>标准目标列</span>
            <span>来源 / 填充值</span>
            <span>清洗设置</span>
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
                      {{ text: "文本", number: "数字", date: "日期" }[col.type]}
                    </small>
                  </div>
                  <div className="mapping-source">
                    <ArrowLeft size={15} />
                    <select
                      aria-label={`${col.name} 源列`}
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
                      <option value="empty">— 留空 / 使用空值填充 —</option>
                      <option value="fixed">固定值</option>
                      {draft.headers.map((h, i) => (
                        <option key={i} value={`col:${i}`}>
                          {h}
                        </option>
                      ))}
                    </select>
                    {m.mode === "fixed" && (
                      <input
                        aria-label={`${col.name} 固定值`}
                        value={m.fixed}
                        onChange={(e) =>
                          patch(col.id, { fixed: e.target.value })
                        }
                        placeholder="输入固定值"
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
                    {m.replacements.length || m.fill ? "已配置" : "设置"}
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
                      去除首尾空格
                    </label>
                    <label>
                      空值填充
                      <input
                        value={m.fill}
                        onChange={(e) =>
                          patch(col.id, { fill: e.target.value })
                        }
                        placeholder="留空表示不填充"
                      />
                    </label>
                    {col.type === "date" && (
                      <label>
                        来源日期格式
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
                            ["%d/%m/%Y", "27/10/2026（日/月/年）"],
                            ["%m/%d/%Y", "10/27/2026（月/日/年）"],
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
                        来源数字格式
                        <select
                          value={m.number_style}
                          onChange={(e) =>
                            patch(col.id, { number_style: e.target.value })
                          }
                        >
                          <option value="comma">1,234.56 / 1234.56</option>
                          <option value="plain">1234.56（无千分位）</option>
                          <option value="european">1.234,56 / 1234,56</option>
                        </select>
                      </label>
                    )}
                    <div className="replacements">
                      <span>
                        精确值替换{" "}
                        <small>只替换整格相同的值，命中第一条即停止</small>
                      </span>
                      {m.replacements.map((r, i) => (
                        <div className="replacement-row" key={i}>
                          <input
                            aria-label={`${col.name} 原值 ${i + 1}`}
                            placeholder="原值"
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
                            aria-label={`${col.name} 新值 ${i + 1}`}
                            placeholder="替换为"
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
                            aria-label="移除替换项"
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
                        添加替换
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {source && (
            <details className="editor-source">
              <summary>查看来源示例（前 5 行）</summary>
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
            标记 * 的目标列为必填。留空且未设置填充值时，对应数据行会被隔离。
          </div>
        </div>
        <div className="modal-footer">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={saveLibrary}
              onChange={(e) => setSaveLibrary(e.target.checked)}
            />
            保存到来源规则库，下次复用
          </label>
          <div className="button-group">
            <button className="btn secondary" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy || invalid}
              onClick={() =>
                void onSave({ ...draft, name: draft.name.trim() }, saveLibrary)
              }
            >
              <Check size={16} />
              {busy ? "正在保存…" : "确认映射"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateEditor({
  template,
  busy,
  onSave,
}: {
  template: Template;
  busy: boolean;
  onSave: (t: Template) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(template));
  const dirty = JSON.stringify(draft) !== JSON.stringify(template);
  const valid =
    draft.name.trim() &&
    draft.columns.length > 0 &&
    draft.columns.every((c) => c.name.trim()) &&
    new Set(draft.columns.map((c) => c.name.trim())).size ===
      draft.columns.length;
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
          <div className="eyebrow">先定义好表格的共同语言</div>
          <h1>标准模板</h1>
          <p>所有来源都会按这里的列顺序和字段类型导出。</p>
        </div>
        <button
          className="btn primary"
          disabled={busy || !dirty || !valid}
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
          保存模板
        </button>
      </div>
      <div className="panel section-panel template-panel">
        <label className="template-name-label">
          模板名称
          <input
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <table>
          <thead>
            <tr>
              <th className="col-order">顺序</th>
              <th>目标列名称</th>
              <th>数据类型</th>
              <th>必填</th>
              <th>调整</th>
            </tr>
          </thead>
          <tbody>
            {draft.columns.map((c, i) => (
              <tr key={c.id}>
                <td className="order-index">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td>
                  <input
                    aria-label={`第 ${i + 1} 列名称`}
                    value={c.name}
                    maxLength={80}
                    onChange={(e) => patch(c.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`${c.name} 数据类型`}
                    value={c.type}
                    onChange={(e) =>
                      patch(c.id, { type: e.target.value as Column["type"] })
                    }
                  >
                    <option value="text">文本（保留前导零）</option>
                    <option value="number">数字</option>
                    <option value="date">日期</option>
                  </select>
                </td>
                <td>
                  <label className="checkbox-label">
                    <input
                      aria-label={`${c.name} 必填`}
                      type="checkbox"
                      checked={c.required}
                      onChange={(e) =>
                        patch(c.id, { required: e.target.checked })
                      }
                    />
                    必填
                  </label>
                </td>
                <td>
                  <div className="button-group">
                    <button
                      className="icon-btn"
                      disabled={i === 0}
                      aria-label={`上移 ${c.name}`}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      disabled={i === draft.columns.length - 1}
                      aria-label={`下移 ${c.name}`}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      disabled={draft.columns.length === 1}
                      aria-label={`删除列 ${c.name}`}
                      onClick={() => {
                        if (confirm(`从模板中删除“${c.name}”？保存后生效。`))
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
                  name: "新字段" + (draft.columns.length + 1),
                  type: "text",
                  required: false,
                },
              ],
            })
          }
        >
          <Plus size={16} />
          添加目标列
        </button>
        {!valid && (
          <p className="inline-error">模板和列名称不能为空，列名称不能重复。</p>
        )}
      </div>
      <div className="template-footnote">
        <CircleAlert size={16} />
        <p>
          保存模板后，当前批次需要重新确认规则。金额不会自动通过数量与单价计算；订单号和商品编码建议使用文本类型。
        </p>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
