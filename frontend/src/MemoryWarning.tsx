import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";
export function MemoryWarning({
  bytes,
  onCancel,
  onContinue,
}: {
  bytes: number;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const { t } = useI18n(),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="template-required-dialog"
      aria-labelledby="memory-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="memory-title">{t("memory.title")}</h2>
      <p>{t("memory.body")}</p>
      <p>{t("memory.estimate", { size: Math.ceil(bytes / 1048576) })}</p>
      <div className="button-group">
        <button autoFocus className="btn secondary" onClick={onCancel}>
          {t("memory.back")}
        </button>
        <button className="btn primary" onClick={onContinue}>
          {t("memory.continue")}
        </button>
      </div>
    </dialog>
  );
}
