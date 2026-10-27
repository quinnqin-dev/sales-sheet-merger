# Validation record

Environment: macOS, Python 3.13, Node.js 26. All automated and browser checks use synthetic sales data.

## Automated checks

```sh
.venv/bin/python -m pytest -q -s
npm --prefix frontend run build
npm --prefix frontend run format:check
npm --prefix frontend test
```

Coverage includes multiple sales sources and worksheets; header-row corrections and column reordering; UTF-8/GB18030; leading zeros, typed dates/numbers, decimal totals, safe literal text export, missing formula caches, invalid values, source provenance, duplicate retention, long original values, batch/file limits, restart persistence, temporary cleanup, and job rule snapshots.

Internationalization checks cover default English, unsupported-language fallback, language negotiation, concurrent request isolation, localized API/validation/file errors, localized row reasons, both Excel languages, immutable export-language snapshots, preservation of customer field names and values, legacy Chinese library reuse after restart, catalog-key/placeholder parity, saved browser language, blocked browser storage, and retranslation of stored notices/errors.

The scale test imports 30 actual files with 100,000 total rows, checks the final results page, and re-reads every exported sales row to verify counts and amounts. The initial implementation completed the whole test in about 17 seconds on this Mac; this is a measurement, not a performance guarantee.

## Browser checks

The original version was exercised through the macOS file picker, CSV import, mapping confirmation, preview, merge, valid results, and duplicate filtering. Three synthetic rows produced two valid duplicate-group rows and one isolated problem row; order ID `000123` and SKU `0011` were preserved.

The internationalized build is checked in Chrome for English layout, live switching to Simplified Chinese, restoring the selected language after reload, preserving unsaved template fields when switching, and translated navigation/help. Mapping/result messages and export language snapshots are covered by automated tests. Browser-extension file uploads may require local-file URL access; native macOS file selection works without changing extension permissions.

## Practical limits

Exported workbook values, types, sheets, counts, and totals are checked by reopening the output programmatically. Microsoft Excel native rendering/recalculation has not been tested; the product does not calculate formulas. No real sales sample files have been provided, so unusual source formats still need acceptance with actual data.


## Output-template setup guard

The configuration/mapping/merge regression run passed 41 backend tests (excluding the unchanged scale test), and all 8 frontend tests passed. Production build and formatting checks passed. Coverage includes the unconfigured first-run state, explicit save of the unchanged sales example, invalid drafts, preservation of imported batch/file IDs, restart persistence, legacy library recognition, and import/export of the configuration flag.

Browser validation used synthetic two-file student data in an isolated application-data directory. Confirmed: Next opens the missing-template dialog; English/Chinese dialog text; cancel preserves both selected worksheets; configuration starts blank with sales placeholders; invalid drafts disable save; Save and return preserves both imported files and selections; the next click reaches source mapping. The user’s saved settings were not changed by this test.


## Manual examples and reset

43 backend regression tests (excluding the unchanged scale test) and 10 frontend tests passed; production build and formatting checks passed. New tests verify that resets persist as unconfigured across restart, preserve imported files and source rules, and create blank drafts without restoring example names or IDs. Legacy libraries without explicit configuration flags now require manual setup; reading them preserves their stored content. Example text is display-only, prefixed with “e.g.” / “例：”, with gray placeholder styling. The one-click sales-example action has been removed.


Browser verification of the manual/reset flow confirmed empty actual input values, Chinese “例：” placeholders, computed gray placeholder color, disabled save before manual entry, successful manual save, reset cancellation preserving the saved template, and confirmed reset restoring a blank unconfigured form. The reset confirmation uses an in-page modal.


## Single-sheet export

The default Excel download now contains only the merged valid-data worksheet. Problem rows and Processing Summary are no longer exported as worksheets. The page/API still retain problem reasons, raw source values, counts, and duplicate flags for the current session. Export tests cover mixed valid/error rows, an all-error batch (header-only output), both worksheet languages, preserved numeric/date/text types, and the 100,000-row export.

## Legacy XLS import

Added `xlrd` for actual BIFF `.xls` imports; `xlwt` is used only to generate synthetic test fixtures. Import acceptance and both language catalogs now list `.xlsx`, `.xls`, and `.csv`; export remains a single-sheet `.xlsx` file.

All 50 backend tests and 10 frontend tests passed, together with the production build, formatting, and dependency checks. The full 30-file/100,000-row export check completed in 12.46 seconds on this Mac. New end-to-end tests mix XLS/XLSX/CSV, select multiple XLS sheets, reuse saved rules, correct header rows, handle corrupt files, retain leading-zero identifiers, and verify native dates under both the 1900 and 1904 date systems after reopening the export. Cell-type checks cover booleans, integers, text, Excel errors, and an empty cached formula result. The XLS reader exposes saved formula results only; it cannot distinguish an unavailable result from an empty result, as documented in both READMEs.
