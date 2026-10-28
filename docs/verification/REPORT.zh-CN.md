# Sheet Merger 验收记录

本次按最后确认的导出契约执行：只生成一张 `Merged Data`，不增加问题行或汇总工作表。验收使用隔离浏览器和虚构数据，未读取或清空日常浏览器内的工作区。

## 1. 任务清单

| 任务 | 状态 | 结果 |
|---|---|---|
| 1 导出契约 | 完成（按最新单表要求） | 删除三表承诺；导出只含保留的有效明细。 |
| 2 对比度 | 完成 | 两个文字变量；正文、占位、示例、禁用态均加深，字体和背景不变。 |
| 3 窄屏 | 完成 | 步骤横向滚动、按钮纵排、模板列卡片、局部表格滚动与首列固定。 |
| 4 离线 | 部分完成 | 三引擎离线合并通过；当前 WebKit 在线导航未取得新 HTML，保留缓存兜底，见已知限制。 |
| 5 导出内存 | 完成 | XLSX XML / ZIP 增量写入，1000 行分页；预检警告与结果页重试。 |
| 6 去重策略 | 完成 | 默认全部保留，可选首条 / 末条；同批次 6 / 4 / 4 行，统计和合计一致。 |
| 7 拆包 | 部分完成 | reader / writer / 共享 runtime 独立，体积和交互目标达标；为首次合并也能离线，首装 SW 缓存含 writer 字节，未满足“启动合并前绝不下载其字节”的严格口径。 |
| 8 备份兜底 | 完成 | ZIP 导出 / 原子导入、重新选原文件并确认映射、按实际数量确认清空。 |

## 2. 关键改动

1. `shared/locales/en.json`、`zh-CN.json`：移除三表承诺；`writer.ts` 固定单表名，问题行留在页面。
2. `style.css`：`--text-muted: #5f6b64`、`--text-placeholder: #68726c`；禁用态不再整体降透明度。实测见 [contrast.md](contrast.md)。
3. `style.css`、`TemplateEditor.tsx`：≤560px 响应式卡片；按钮 / 图标目标最少 44px；五个要求宽度与额外 320px 重排均检查页面溢出。
4. `sw.js`、`offline-build.ts`、`OfflineStatus.tsx`、`manifest.webmanifest`：构建注入本地资源；不缓存跨域；新版本等待用户确认，合并中禁止刷新更新。导航优先使用浏览器原生 Navigation Preload；版本不匹配时保留完整的已安装应用。
5. `writer.ts`、`processing.ts`、`preflight.ts`、`MemoryWarning.tsx`：现有 fflate 真正增量压缩，移除运行包里的 ExcelJS 文档模型；导出失败不丢已完成的行。配额导致失败状态也无法写入时，仍能显示并重新打开结果页。
6. `domain.ts`、`validation.ts`、`processing.ts`、`storage.ts`：新增可选 `duplicatePolicy` / `duplicate_dropped` / `dropped`；旧数据默认 keep-all。指纹、坏行判定、数字精度、日期转换及签名匹配均沿用原规则。
7. `vite.config.ts`、`reader.ts`、`main.tsx`：共享代码与安装消息监听器的入口分离，避免 WebKit 重复处理同一次合并；模板编辑与指南也按需加载。
8. `backup.ts`、`BackupControls.tsx`、`operations.ts`：ZIP 含 rules.json、templates/*.json、batch.json 和可用的 result.xlsx，不含原始 Blob。先验证再用单个事务替换数据。WebKit 无法持久化 Blob 时，已有记录字段改存等价原始字节；旧 Blob 记录仍可读。数据库仍为 sheet-merger v1，四个 store 与索引不变。

## 3. 证据

- [导出文件](export-single-sheet.xlsx)、[unzip / workbook.xml 记录](export-contract.txt)：只存在 `xl/worksheets/sheet1.xml`，表名 `Merged Data`。数值、日期、文字型编号、公式样文本、冻结首行、筛选、排除问题行均有测试。
- [对比度表](contrast.md)。Lighthouse [JSON](lighthouse/report.json) / [HTML](lighthouse/report.html)：Accessibility 100，Best Practices 100。该工具版本没有独立 PWA 分类；SW / manifest / 图标由自动检查及离线流程验证。
- [360px](screenshots/results-360.png) / [412px](screenshots/results-412.png) / [600px](screenshots/results-600.png) / [1024px](screenshots/results-1024.png) / [1440px](screenshots/results-1440.png)。同目录另有各宽度的 template-confirm / template-editor 截图。
- [320px 重排](screenshots/template-editor-320.png)、[320 × 250 映射弹窗](screenshots/zoom-400-rule-editor.png)：相当于 1280 × 1000 视口在 400% 缩放后的 CSS 宽高，确认按钮可滚动到可见区域并点击；未另行操作浏览器菜单缩放。
- [断网结果页](screenshots/offline-result.png)、[WebKit 服务器关闭后的结果页](screenshots/offline-webkit.png)、[合并中收到更新](screenshots/update-during-merge.png)、[导出重试](screenshots/export-retry.png)、[清空数量确认](screenshots/clear-data-confirm.png)。
- [构建体积](bundles.md)、[原始 br 测量](bundle-after.json)、[冷启动交互计时](interactive.json)、[10 万行内存对比](memory.md)。Brotli 统一使用 quality 11，和任务给定基准的压缩设置不同，因此同时保留改造前的同设置测量。
- `npm test`：30 项通过。`npm run build`、`npm run format:check` 通过。浏览器主回归：31 项正常通过、1 项 WebKit 在线新 HTML 的预期失败、25 项按引擎分工跳过。另有 6 项窄屏截图检查和 400% 等效重排检查。最终统计见 [browser-results.json](browser-results.json)。网络测试检查仅访问同源静态资源，没有 API / POST 上传。

## 4. 风险与未解

- **任务 4 的未完成部分**：当前 Playwright WebKit 26 的 Navigation Preload 已启用，但在线探针仍收到缓存 HTML。独立静态站点的[诊断记录](webkit-navigation-probe.json)显示原生预加载返回 `TypeError: Load failed`，随后按设计回退缓存。该严格“在线新 HTML”断言保留为显式预期失败，不把它算作已实现。Chromium / Firefox 网络优先验证通过；WebKit 缓存兜底、服务器关闭后的刷新、重新导入、合并、导出、指南及结果恢复均通过。保留 connect-src 'none'；不以放宽 CSP 规避这个差异。新版本仍通过 SW 的等待 / 用户确认机制更新。
- WebKit 的 `context.setOffline()` 会报引擎内部错误，其离线验收改用停止独立测试服务器，未冒充真机 Safari 测试。
- 为在 SW 自身也使用 connect-src 'none' 的前提下预缓存，构建资源以字节形式注入 SW，增加初次离线安装体积；其中包含 writer 字节，但页面启动前不导入或单独请求 writer chunk。指南插图也可离线查看。
- 系统直接杀死浏览器 / Worker 的 OOM 不能由 JS 捕获；转换与统计已完成并写入时，可重新打开后重试导出；转换中断则需重跑。输入解析及最终压缩文件仍需要内存。备份恢复不含原始文件和问题行数据库，原文件必须另存；ZIP 导入上限 100 MB。
- 本次证据来自本地 build + preview，不代表 Render 上线验收。没有新增运行时依赖，也没有更改远程仓库权限。
