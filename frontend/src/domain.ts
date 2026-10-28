export type DuplicatePolicy = "keep-all" | "keep-first" | "keep-last";
import type { Template } from "./template-state";
import type { SavedTemplate } from "./template-files";
export type Mapping = {
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
export type Rule = {
  id: string;
  name: string;
  headers: string[];
  mappings: Mapping[];
};
export type Library = {
  version: 1;
  template: Template;
  template_configured: boolean;
  rules: Rule[];
  templates: SavedTemplate[];
};
export type Sheet = {
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
export type SourceFile = {
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
export type Assignment = {
  enabled: boolean;
  rule: Rule | null;
  confirmed: boolean;
};
export type ResultRow = {
  dropped?: boolean;
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
export type Summary = {
  duplicate_dropped?: number;
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
export type Job = {
  duplicatePolicy?: DuplicatePolicy;
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

export type RunRequest = {
  duplicatePolicy?: DuplicatePolicy;
  template: Template;
  selections: {
    file_id: string;
    sheet: string;
    header_row: number;
    rule: Rule;
  }[];
};
export type Workspace = {
  duplicatePolicy?: DuplicatePolicy;
  batch: string;
  files: SourceFile[];
  assignments: Record<string, Assignment>;
  step: number;
  selectedTemplateId: string | null;
  preview: ResultRow[];
  job: Job | null;
};
export type StoredFile = {
  id: string;
  batchId: string;
  blob: File;
  meta: SourceFile;
};
export type StoredJob = Job & {
  batchId: string;
  output?: Blob;
  created: string;
};
export type StoredRow = ResultRow & {
  sourceIndex?: number;
  jobId: string;
  index: number;
  kind: "valid" | "issues";
  fingerprint: string;
  duplicate: number;
};
