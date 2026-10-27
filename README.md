# Sheet Merger

[English](README.md) · [简体中文](README.zh-CN.md)

Merge spreadsheets with different column names into one consistent Excel file. Define your output columns once, save a mapping for each source, and reuse it next time.

Use it for student grades, inventory lists, order records, or any tables that need a consistent column layout. Files are processed on your computer, with no account or cloud upload required. No API key or separate database service is needed.

- **Import:** `.xlsx`, `.xls`, and `.csv`, including multiple worksheets.
- **Customize:** output column names, order, data types, and required fields.
- **Reuse:** save field mappings and cleanup settings; back up the configuration as JSON.
- **Export:** one `.xlsx` worksheet containing valid merged records.
- **Languages:** English by default, with a Simplified Chinese switch.

[Get started](#get-started) · [User guide](#user-guide) · [Common questions](#common-questions) · [Development](#development)

## Get started

The included setup and launcher scripts are for **macOS**. Install **Python 3.11+** and **Node.js 20.19+ with npm** first, then download or clone this repository and open a terminal in the project directory:

```sh
./setup.sh
./start.command
```

After setup, you can also double-click `start.command`. It opens <http://127.0.0.1:8765> in your browser. If dependencies or the frontend build are missing, the launcher runs setup automatically. Installation requires internet access; normal processing works offline.

Keep the launch terminal open while using the tool. **Closing the browser does not stop the service.** Download your result before stopping it with **Control-C**: stopping clears imported batches and temporary results, while saved templates and rules remain available.

## User guide

This example combines two student-grade tables with different headers: **12 records per file → 24 merged records**. The same steps apply to other spreadsheets. Screenshots use fictional data; click an image to view it at full size.

Two settings work together:

| Setting | What it decides |
| --- | --- |
| **Output template** | Which columns appear in the final file, in what order and with which data types. |
| **Source rules** | Which column in each original file supplies each output column. |

### 1. Import your files

Drag files into **Batch merge**, or click **Choose files**. Select the worksheets you want to combine, then click **Next: configure rules**.

Expand a file to preview the source data. If its column names are not on the first row, change **Header row**.

![Two imported student-grade files with 24 rows selected](frontend/public/guide/import-en.webp)

### 2. Select and confirm an output template

Every new batch starts with no template selected. Entering this step shows the template list directly. If you click **Confirm template, next** without selecting a template, the **No output template selected** prompt appears. Click **Select template** to return to the current list, or **New template** to open a blank template form directly.

Choose **Student grades** and review its four columns: **Student ID**, **Name**, **Subject** (Text), and **Score** (Number). Click **Confirm template, next**.

If you have no saved templates, see [Create and edit templates](#create-and-edit-templates) below. Imported files and worksheet selections stay in place while you configure a template.

![Confirming the saved four-column student-grade template](frontend/public/guide/template-en.webp)

### 3. Match the source columns

Click **Configure & confirm** for each source. For every output column on the left, select the corresponding source column on the right:

| Output column | First file | Second file |
| --- | --- | --- |
| Student ID | 学号 | Student ID |
| Name | 姓名 | Student Name |
| Subject | 科目 | Subject |
| Score | 成绩 | Points |

Keep **Save to the rule library for next time** checked if you want to reuse the mapping, then click **Confirm mapping**. Confirm every selected source before continuing.

![Source columns mapped to the four output columns](frontend/public/guide/mapping-en.webp)

### 4. Preview and check

Click **Preview converted data**. Check the IDs, names, scores, and warnings in the first 20 records. Return to the source rules to correct a mapping. To change the output template, return to step 2; mappings must be confirmed again after a change.

![Previewing mapped student-grade records](frontend/public/guide/preview-en.webp)

### 5. Merge and download

Click **Start merge** → **Download merged Excel**. This example produces **24 valid records** with the same four columns.

The downloaded Excel contains **one worksheet of valid records**. Problem rows and their reasons stay on the results page. Exact duplicates are retained and flagged; they are not automatically removed.

![Completed merge with 24 valid records and the download button](frontend/public/guide/result-en.webp)

## Create and edit templates

Open **Output template** to access the template library. Click **New template**, or **Edit template** beside a saved entry. Enter a name, add or reorder columns, and set each column’s type and required status. Gray examples are placeholders, not saved values.

Click **Save file & add to library** to choose a folder and filename on your computer. The JSON file contains the template configuration, without table data or source rules. After the file is saved, the template is added to the library automatically. Editing updates that library entry; **Save as new template** creates a separate entry.

Use Chrome or Edge for the native save-location dialog. If your browser does not support it, the tool explains this rather than silently saving elsewhere. Cancelling or failing to write the file leaves the library unchanged. If the file is saved but registration fails, retry adding it to the library without writing it again.

**Import template JSON** adds an existing template file to the library. A changed file with the same template ID requires confirmation before replacing the library copy. External file edits are not synchronized automatically; reimport the file to apply them. The tool does not delete or silently rewrite your saved files.

![Editing a saved template and saving a JSON copy](frontend/public/guide/editor-en.webp)

Use **Delete** to the right of **Edit template** to remove a library entry after confirmation. Its saved JSON file, imported files, and source rules are kept. If it was selected for the current batch, select another template before continuing.

## Reuse your setup

Your template library and saved source rules remain available after restarting. Select a template explicitly for each new batch. On your next import, matching headers suggest a saved rule—even when their column order differs. Review and confirm the mapping before merging.

Use **Source rules → Export rule library** to back up the current output template, template library, and saved source rules as JSON. **Import rule library** restores a backup by replacing the current template, template library, and rules.

To change the final columns, edit **Output template** and save, then confirm the source mappings again. **Reset template** clears the current template configuration and draft after confirmation; saved templates, imported files, and source rules remain available.

## Common questions

**Can this merge more than two files?**

Yes. Each batch supports up to **30 files and 100,000 selected data rows**, with a **50 MB limit per file**. You can select several worksheets from a file.

**Chinese CSV text looks wrong. What should I do?**

Expand the imported file and try **GB18030** under **Character encoding**. UTF-8 CSV files use the default setting.

**How do I keep leading zeros in IDs?**

Use the **Text** output type. Existing text zeros and simple formats such as `000000` are preserved; digits already lost in the source cannot be recovered.

**Why are some rows missing from the download?**

Entirely blank rows are skipped. Empty required values or failed conversions become problem rows; inspect their original values and reasons on the results page.

**Does the tool calculate formulas or combine matching IDs?**

Formulas are not recalculated; save their calculated results in Excel before importing. This tool appends records into a common column layout. It does not join records by ID, aggregate totals into new rows, or automatically calculate amounts.

**How do I switch languages?**

Choose **English / 简体中文** in the top bar. The browser remembers your choice, and the in-app guide switches its screenshots too. Template names, source headers, and data remain as entered. The exported worksheet name uses the language selected when the merge starts.

## Data and conversion details

Files are processed locally. Source files are never overwritten. Settings are saved at `~/Library/Application Support/SalesSheetMerger/library.json`; imported batches, intermediate results, and generated exports are temporary. Processing results use local temporary SQLite files, which are cleared when the service stops or next starts; these files are not included in the repository. Downloaded files remain wherever you save them. Switching between pages in the app preserves the current batch; download any needed results before refreshing the browser or stopping the service.

<details>
<summary>Conversion behavior and additional limits</summary>

- Cleanup order: trim whitespace → fill empty values → replace exact whole-cell values (first match) → convert types.
- Dates follow the format selected in the rule; native Excel dates are read directly. Day/month order is not guessed. Number formats include `1,234.56`, `1234.56`, and `1.234,56`.
- Numbers use Decimal arithmetic, with up to 15 significant digits, 12 decimal places, and absolute value 10¹⁵. Values outside these limits become problems instead of being silently rounded. Currency and units are not converted.
- In `.xlsx`, a mapped formula without a saved result becomes a problem. The `.xls` reader exposes saved results only; unavailable results may appear empty and follow the usual fill/required-value rules.
- Text is exported as text, including values starting with `=`. Excessive text length and unsupported control characters are isolated.
- Exact duplicates are identified using all converted target values. Numeric `1.0` and `1.00` are equivalent; matching IDs alone do not imply duplicates.
- Additional limits: 1,000 source columns, 200,000 physical rows per worksheet, and 256 MB of uncompressed `.xlsx` content. One merge runs at a time. Complex merged-cell layouts are not supported.
- The service binds to `127.0.0.1` and checks local Host and Origin headers. No remote fonts, scripts, or analytics are loaded.

</details>

The existing local data directory and template-file format identifiers are retained for compatibility with earlier versions; saved customer templates and rules are not renamed.

## Development

The backend uses **FastAPI**, **openpyxl**, and **xlrd**; the frontend uses **React**, **TypeScript**, and **Vite**. Dependencies are pinned in `requirements.lock` and `frontend/package-lock.json`.

After setup, run the backend and frontend in separate terminals:

```sh
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765 --reload
npm --prefix frontend run dev
```

Vite proxies `/api` to the backend. The production build is served by FastAPI. API documentation is available at `/docs`. Set `SALES_MERGER_DATA_DIR` to use a separate data directory for development or testing.

Run checks from the project directory. Frontend tests require Node.js 22.18+:

```sh
npm --prefix frontend run build
npm --prefix frontend run format:check
npm --prefix frontend test
.venv/bin/python -m pytest -q -s
```

Shared English and Chinese messages live in `shared/locales/`. Keep message keys and interpolation placeholders consistent between both catalogs. See [VALIDATION.md](VALIDATION.md) for test coverage and practical limitations.
