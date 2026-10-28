import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { useI18n } from "./i18n";
export function BackupControls({
  disabled,
  onExport,
  onImport,
}: {
  disabled: boolean;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
}) {
  const { t } = useI18n(),
    input = useRef<HTMLInputElement>(null);
  return (
    <div className="panel section-panel backup-controls">
      <h2>{t("backup.title")}</h2>
      <p>{t("backup.description")}</p>
      <div className="button-group">
        <button
          className="btn secondary"
          disabled={disabled}
          onClick={onExport}
        >
          <Download size={16} />
          {t("backup.export")}
        </button>
        <button
          className="btn secondary"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          {t("backup.import")}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".zip"
        hidden
        aria-label={t("backup.import")}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && confirm(t("backup.replace"))) await onImport(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
