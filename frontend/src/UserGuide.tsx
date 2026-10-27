import {
  ArrowRight,
  RefreshCw,
  Table2,
  Settings2,
  Maximize2,
} from "lucide-react";
import { useI18n } from "./i18n";

export function UserGuide({ onReturn }: { onReturn: () => void }) {
  const { locale, t } = useI18n();
  const steps = ["import", "template", "mapping", "result"] as const;
  const exampleHeaders = {
    id: "学号",
    name: "姓名",
    subject: "科目",
    score: "成绩",
  };
  return (
    <div className="user-guide">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("guide.example")}</div>
          <h1>{t("guide.title")}</h1>
          <p>{t("guide.intro")}</p>
        </div>
        <button className="btn secondary" onClick={onReturn}>
          {t("guide.return")} <ArrowRight size={16} />
        </button>
      </div>

      <div className="guide-concepts">
        <div>
          <Table2 size={20} />
          <p>
            <strong>{t("ui.standardTemplate")}</strong>
            {t("guide.templateMeaning")}
          </p>
        </div>
        <div>
          <Settings2 size={20} />
          <p>
            <strong>{t("ui.sourceRules")}</strong>
            {t("guide.ruleMeaning")}
          </p>
        </div>
      </div>

      <ol className="guide-steps">
        {steps.map((step, index) => (
          <li className="panel guide-step" key={step}>
            <div className="guide-instruction">
              <span className="guide-number">0{index + 1}</span>
              <h2>{t(`guide.${step}.title`)}</h2>
              <p>{t(`guide.${step}.body`)}</p>
              <p className="guide-tip">
                {t(`guide.${step}.tip`, exampleHeaders)}
              </p>
            </div>
            <figure>
              <a
                href={`/guide/${step}-${locale}.webp`}
                target="_blank"
                rel="noreferrer"
                aria-label={t("guide.enlarge", {
                  step: t(`guide.${step}.title`),
                })}
              >
                <img
                  src={`/guide/${step}-${locale}.webp`}
                  alt={t(`guide.${step}.alt`, exampleHeaders)}
                  loading="lazy"
                  decoding="async"
                />
                <span className="guide-enlarge">
                  <Maximize2 size={13} />
                  {t("guide.viewImage")}
                </span>
              </a>
              <figcaption>{t(`guide.${step}.caption`)}</figcaption>
            </figure>
          </li>
        ))}
      </ol>

      <div className="guide-reuse">
        <RefreshCw size={23} />
        <div>
          <h2>{t("guide.reuse.title")}</h2>
          <p>{t("guide.reuse.body")}</p>
        </div>
      </div>
      <section
        className="panel guide-questions"
        aria-labelledby="guide-questions-title"
      >
        <h2 id="guide-questions-title">{t("guide.questions")}</h2>
        {["headers", "backup", "files"].map((question) => (
          <details key={question}>
            <summary>{t(`guide.${question}.question`)}</summary>
            <p>{t(`guide.${question}.answer`)}</p>
          </details>
        ))}
        <p className="guide-limits">{t("guide.limits")}</p>
      </section>
    </div>
  );
}
