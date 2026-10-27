# Sales Sheet Merger

[English](README.md) · [简体中文](README.zh-CN.md)

Merge sales records from different Excel and CSV sources into a consistent template. Save field mappings and cleanup rules for the next import. Files are processed on your computer; no accounts or cloud uploads are required.

## Start

On this Mac, dependencies and the production frontend are already installed. Double-click **start.command**, or run:

```sh
cd /Users/a1234/Projects/sales-sheet-merger
./start.command
```

Open <http://127.0.0.1:8765>. Keep the launch terminal open. **Press Control-C in that terminal to stop the service and clear temporary data. Closing the browser does not stop the service.** Saved templates and rules survive restarts. Starting the launcher again opens the existing instance.

On a new computer, install Python 3.11+ and Node.js 20.19+ with npm, then run `./setup.sh`. The launcher runs setup automatically if the virtual environment or frontend build is missing. Dependencies are locked in `requirements.lock` and `frontend/package-lock.json`. Installation needs internet access; normal processing does not. Frontend tests use Node.js 22.18+ for native TypeScript support.

## Language

The interface starts in **English**, regardless of the browser or operating-system language. Use **English / 简体中文** in the top bar to switch; the browser remembers your choice. Dialogs follow the page language and do not include a separate language selector. If local storage is blocked, switching still works for the current session.

System-generated worksheet names, issue descriptions, and summary labels use the language selected **when the merge starts**. Changing the interface while processing or before downloading does not change that job's export language. To export in another language, start a new merge in that language.

The optional sales example has English field names. Existing template names, column names, rules, source headers, filenames, and sales values are customer content: they are never automatically translated or overwritten when switching languages.

## Workflow

1. **Import files:** drag or select `.xlsx` and `.csv` files. The first readable worksheet in each file is selected by default; select more as needed. Expand a file to preview it, adjust the header row, or change CSV encoding between UTF-8 and GB18030.
2. **Configure rules:** on first use, Next prompts you to configure an output template. Go to Output template, fill in a name and at least one target column, then Save and return. Your files and worksheet selections stay in place; click Next again. Once configured, the template is reused without this prompt. Matching headers suggest saved rules, ignoring column order. Review each mapping and choose a source column, fixed value, or empty value for every target. Optionally save it to the source-rule library.
3. **Preview & check:** inspect the first 20 selected rows. Return to the rules to correct a conversion before merging.
4. **Merge & export:** process all selected data, review valid/problem/duplicate rows, and download an Excel workbook.

The **Output template** page edits column names, order, types, and required status. First use starts with a blank form; Standard Sales Details and its fields are gray placeholders prefixed with “e.g.”; they are never prefilled. Enter the template name and target column names yourself (for example Student ID and Score). Blank or duplicate target names cannot be saved. After saving, source mappings must be confirmed again. Templates with an explicit saved configuration flag are reused. Legacy configurations without that flag require manual setup and are not silently treated as complete. Existing stored values and source rules are not rewritten when reading the legacy file. **Reset template** clears the template configuration and unsaved draft after confirmation; imported files and saved source rules remain available. Reset state persists across restarts, and Next requires template setup again.

**Source rules** supports editing, copying, deletion, and JSON library backups. Import replaces the current template and saved rules after confirmation. Export a backup first.

## Conversion and export behavior

- Cleanup order: trim whitespace → fill empty values → replace exact whole-cell values (first match) → convert types. No scripts or formula editor.
- Dates use the format explicitly selected in the rule; native Excel dates are read directly. Day/month order is not guessed. Number styles support `1,234.56`, `1234.56`, and `1.234,56`. Language switching does not change these parsing settings.
- Amounts use Decimal arithmetic. No automatic quantity-times-price calculation, currency conversion, or unit rescaling. Numeric values support up to 15 significant digits, 12 decimal places, and absolute value 10¹⁵; excess precision is isolated instead of silently rounded. Exact totals remain available in the processing result data.
- Order IDs and SKUs remain text. Existing text leading zeros and simple `000000` display formats are preserved; digits already lost in a source file cannot be reconstructed.
- Entirely blank rows are skipped and counted separately. Required-value and conversion errors are isolated with the source values and reasons. Unreadable files must be removed or fixed before proceeding. Valid rows + problem rows = data rows read.
- Exact duplicate detection compares all converted target fields; numeric `1.0` and `1.00` are equivalent. Duplicate rows are retained and grouped. Matching order IDs alone do not imply duplicates.
- Formulas use saved calculation caches only; no formulas are executed or recalculated. Missing caches in mapped cells become issues. Exported text cannot become an Excel formula. Excessive text length and unsupported control characters are isolated.
- Excel export contains **one worksheet only: Sales Details** (销售明细 for Chinese jobs), with valid merged records in exact template-column order. Problem rows, reasons, source information, counts, and duplicate warnings remain available on the results page while the session is running. They are not included as extra worksheets. Source files are never overwritten.

## Data and limits

Settings remain at `~/Library/Application Support/SalesSheetMerger/library.json`. Temporary batches, SQLite results, and generated exports use its `temporary/` subdirectory and are cleared on normal exit or the next startup. Downloaded files are kept where you save them. A file lock prevents another instance from clearing active data.

Limits: **30 files and 100,000 selected data rows per batch**, 50 MB per file, 1,000 source columns, 200,000 physical rows per sheet, and 256 MB uncompressed Excel content. One merge runs at a time. Legacy `.xls`, joins, aggregation, accounts, cloud sync, and complex merged-cell layouts are outside version 1.

The service binds only to `127.0.0.1` and checks local Host and Origin headers. There are no remote fonts, scripts, or analytics. Sales files, personal rules, temporary results, and downloads are excluded from Git.

## Development and verification

```sh
# Backend
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765 --reload
# Frontend (another terminal)
npm --prefix frontend run dev
# Build, formatting, frontend language tests
npm --prefix frontend run build
npm --prefix frontend run format:check
npm --prefix frontend test
# Backend tests, including the full 30-file / 100,000-row test
.venv/bin/python -m pytest -q -s
```

Vite proxies `/api` to the local backend in development. FastAPI serves the production build on the same origin. Interactive API documentation is available at `/docs`. `SALES_MERGER_DATA_DIR` selects an isolated application-data directory for development/testing.

English and Simplified Chinese catalogs live in `shared/locales/` and are used by both frontend and backend. Keep message keys and interpolation placeholders identical in both files. UI state stores message codes/parameters, not pretranslated notices. API requests send `Accept-Language: en` or `zh-CN`; missing/unsupported languages fall back to English. Error responses retain `detail` and add `code`/`params`; file/job errors add `error_code`/`error_params`, row reasons add `code`/`params`, and jobs expose `phase_code` and their fixed export `locale`. The version-1 library adds `template_configured`. Fresh installations return false until a template is saved; legacy saved/imported libraries without this field are treated as unconfigured. An explicitly false flag in a newer backup is preserved.

See [VALIDATION.md](VALIDATION.md) for coverage and practical limitations.
