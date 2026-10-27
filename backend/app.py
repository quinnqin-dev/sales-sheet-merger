import asyncio
import copy
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal, getcontext
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import ValidationError

from .engine import (ILLEGAL_XML, MAX_ROWS, convert_row, dumps, duplicate_key,
                     inspect_sheet, is_blank, read_rows, sheet_names, validate_rule, wire)
from .models import DEFAULT_TEMPLATE, InspectRequest, Library, Rule, RunRequest, Template

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get('SALES_MERGER_DATA_DIR', str(Path.home() / 'Library/Application Support/SalesSheetMerger')))
STATE_LOCK = threading.RLock()
RUN_LOCK = threading.Lock()
BATCHES = {}
JOBS = {}
WORK_DIR = None


def library_path():
    return DATA_DIR / 'library.json'


def save_library(lib):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = DATA_DIR / 'library.json.new'
    temporary.write_text(lib.model_dump_json(indent=2), encoding='utf-8')
    temporary.replace(library_path())


def load_library():
    with STATE_LOCK:
        if library_path().exists():
            try:
                return Library.model_validate_json(library_path().read_text('utf-8'))
            except (ValueError, OSError):
                raise HTTPException(500, '规则库无法读取，原文件已保留，请检查或从备份恢复') from None
        return Library(template=DEFAULT_TEMPLATE)


@asynccontextmanager
async def lifespan(app):
    global WORK_DIR
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    scratch = DATA_DIR / 'temporary'
    scratch.mkdir(exist_ok=True)
    # Avoid deleting another running instance's active data.
    import fcntl
    handle = (DATA_DIR / 'instance.lock').open('a')
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise RuntimeError('已有归表实例正在使用此数据目录') from None
    for item in scratch.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()
    WORK_DIR = Path(tempfile.mkdtemp(prefix='session-', dir=scratch))
    BATCHES.clear()
    JOBS.clear()
    try:
        yield
    finally:
        # Finish the bounded background task before removing its files.
        await asyncio.to_thread(RUN_LOCK.acquire)
        RUN_LOCK.release()
        shutil.rmtree(WORK_DIR, ignore_errors=True)
        handle.close()


app = FastAPI(title='归表 · 本机销售表合并', lifespan=lifespan)


@app.middleware('http')
async def local_only(request: Request, call_next):
    host = request.headers.get('host', '').split(':')[0]
    if host not in ('127.0.0.1', 'localhost', 'testserver'):
        return JSONResponse({'detail': '仅允许本机访问'}, 403)
    origin = request.headers.get('origin')
    if origin and origin not in (f'http://{request.headers.get("host")}', 'http://127.0.0.1:5173', 'http://localhost:5173'):
        return JSONResponse({'detail': '不允许的访问来源'}, 403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def batch_for(batch_id):
    if batch_id not in BATCHES:
        raise HTTPException(404, '批次不存在或已过期，请重新导入')
    return BATCHES[batch_id]


def file_for(batch_id, file_id):
    batch = batch_for(batch_id)
    if file_id not in batch['files']:
        raise HTTPException(404, '文件不存在')
    return batch['files'][file_id]


def public_file(item):
    return {k: v for k, v in item.items() if k != 'path'}


def inspect_file(item, options):
    item['encoding'] = options.encoding
    item['header_rows'] = options.header_rows
    try:
        names = sheet_names(item['path'])
        if len(names) > 100:
            raise ValueError('工作表超过 100 个，请拆分文件')
        sheets = []
        for name in names:
            header_row = options.header_rows.get(name, 1)
            try:
                sheets.append(inspect_sheet(item['path'], name, header_row, options.encoding))
            except Exception as exc:
                sheets.append({'name': name, 'header_row': header_row, 'error': friendly_error(exc)})
        item['sheets'] = sheets
        item['error'] = '所有工作表均无法读取，请调整表头或移除文件' if all(s.get('error') for s in sheets) else None
    except Exception as exc:
        item['error'] = friendly_error(exc)
        item['sheets'] = []


def friendly_error(exc):
    if isinstance(exc, UnicodeError):
        return '字符编码无法读取，请尝试 GB18030 后重新检查'
    if isinstance(exc, ValueError):
        return str(exc)[:240]
    return '文件无法读取，可能已损坏、加密或并非真正的 Excel / CSV 文件'


@app.get('/api/health')
def health():
    return {'status': 'ok', 'app': 'sales-sheet-merger', 'max_files': 30, 'max_rows': MAX_ROWS}


@app.get('/api/config')
def get_config():
    return load_library()


@app.put('/api/template')
def put_template(template: Template):
    with STATE_LOCK:
        lib = load_library()
        lib.template = template
        save_library(lib)
    return lib


@app.post('/api/rules')
def put_rule(rule: Rule):
    with STATE_LOCK:
        lib = load_library()
        validate_rule_or_400(rule, lib.template, rule.headers)
        lib.rules = [r for r in lib.rules if r.id != rule.id] + [rule]
        if len(lib.rules) > 500:
            raise HTTPException(400, '最多保存 500 条规则')
        save_library(lib)
    return lib


@app.delete('/api/rules/{rule_id}')
def delete_rule(rule_id: str):
    with STATE_LOCK:
        lib = load_library()
        lib.rules = [r for r in lib.rules if r.id != rule_id]
        save_library(lib)
    return lib


@app.get('/api/config/export')
def export_config():
    return JSONResponse(load_library().model_dump(), headers={'Content-Disposition': 'attachment; filename="sales-rules.json"'})


@app.post('/api/config/import')
async def import_config(request: Request):
    body = await request.body()
    if len(body) > 2 * 1024 * 1024:
        raise HTTPException(413, '规则文件超过 2 MB')
    try:
        lib = Library.model_validate_json(body)
    except ValidationError:
        raise HTTPException(400, '规则文件格式或版本不支持') from None
    with STATE_LOCK:
        save_library(lib)
    return lib


@app.post('/api/batches')
def create_batch():
    if len(BATCHES) >= 50:
        raise HTTPException(400, '本次运行已有 50 个批次，请重启工具清理临时文件')
    batch_id = uuid.uuid4().hex
    directory = WORK_DIR / batch_id
    directory.mkdir()
    BATCHES[batch_id] = {'id': batch_id, 'directory': directory, 'files': {}}
    return {'id': batch_id}


@app.get('/api/batches/{batch_id}')
def get_batch(batch_id: str):
    return {'id': batch_id, 'files': [public_file(f) for f in batch_for(batch_id)['files'].values()]}


@app.post('/api/batches/{batch_id}/files')
async def upload_files(batch_id: str, files: list[UploadFile] = File(...)):
    batch = batch_for(batch_id)
    # Reservation prevents concurrent uploads from bypassing the file-count limit.
    with STATE_LOCK:
        if len(batch['files']) + len(files) > 30:
            raise HTTPException(400, '每批最多 30 个文件')
        items = []
        for uploaded in files:
            file_id = uuid.uuid4().hex
            name = Path(uploaded.filename or '未命名').name
            suffix = Path(name).suffix.lower()
            item = {'id': file_id, 'name': name, 'encoding': 'utf-8-sig', 'header_rows': {},
                    'sheets': [], 'error': '正在读取', 'size': 0,
                    'path': batch['directory'] / f'{file_id}{suffix}'}
            batch['files'][file_id] = item
            items.append((uploaded, item, suffix))
    for uploaded, item, suffix in items:
        try:
            if suffix not in ('.xlsx', '.csv'):
                item['error'] = '仅支持 .xlsx 和 .csv；旧版 .xls 请先另存为 .xlsx'
                continue
            with item['path'].open('wb') as dest:
                while chunk := await uploaded.read(1024 * 1024):
                    item['size'] += len(chunk)
                    if item['size'] > 50 * 1024 * 1024:
                        raise ValueError('单个文件超过 50 MB，请拆分文件')
                    dest.write(chunk)
            await asyncio.to_thread(inspect_file, item, InspectRequest())
        except Exception as exc:
            item['error'] = friendly_error(exc)
            item['path'].unlink(missing_ok=True)
        finally:
            await uploaded.close()
    return [public_file(f) for f in batch['files'].values()]


@app.post('/api/batches/{batch_id}/files/{file_id}/inspect')
def reinspect_file(batch_id: str, file_id: str, options: InspectRequest):
    item = file_for(batch_id, file_id)
    inspect_file(item, options)
    return public_file(item)


@app.delete('/api/batches/{batch_id}/files/{file_id}')
def remove_file(batch_id: str, file_id: str):
    if any(j['batch_id'] == batch_id and j['status'] == 'running' for j in JOBS.values()):
        raise HTTPException(409, '正在合并，请等待完成后再移除文件')
    item = file_for(batch_id, file_id)
    item['path'].unlink(missing_ok=True)
    del batch_for(batch_id)['files'][file_id]
    return {'ok': True}


def validate_rule_or_400(rule, template, headers):
    try:
        validate_rule(rule, template, headers)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


def prepare(batch_id, request):
    batch = batch_for(batch_id)
    if any(f['error'] for f in batch['files'].values()):
        raise HTTPException(400, '请先明确移除无法读取的文件，或修正编码后重新检查')
    selected_keys, prepared, total = set(), [], 0
    for selection in request.selections:
        key = (selection.file_id, selection.sheet)
        if key in selected_keys:
            raise HTTPException(400, '同一工作表不能重复选择')
        selected_keys.add(key)
        item = file_for(batch_id, selection.file_id)
        sheet = next((s for s in item['sheets'] if s['name'] == selection.sheet), None)
        if not sheet or sheet.get('error'):
            raise HTTPException(400, '选中的工作表无法读取，请检查表头和格式')
        if sheet['header_row'] != selection.header_row:
            raise HTTPException(400, '表头行已变化，请重新预览')
        validate_rule_or_400(selection.rule, request.template, sheet['headers'])
        total += sheet['row_count']
        prepared.append((copy.deepcopy(item), copy.deepcopy(sheet), selection.model_copy(deep=True)))
    if total > MAX_ROWS:
        raise HTTPException(400, '选中数据合计超过 10 万行，请减少文件或工作表')
    return prepared, total


@app.post('/api/batches/{batch_id}/preview')
def preview(batch_id: str, request: RunRequest):
    prepared, total = prepare(batch_id, request)
    rows = []
    for item, sheet, selection in prepared:
        for n, values, missing, raw in read_rows(item['path'], sheet['name'], item['encoding']):
            if n <= selection.header_row or is_blank(raw):
                continue
            result, reasons = convert_row(values, missing, selection.rule, request.template, sheet['headers'])
            rows.append({'file': item['name'], 'sheet': sheet['name'], 'row': n,
                         'values': result, 'reasons': reasons, 'raw': [wire(v) for v in raw]})
            if len(rows) >= 20:
                return {'rows': rows, 'total': total}
    return {'rows': rows, 'total': total}


def connect(job):
    db = sqlite3.connect(job['db'])
    db.row_factory = sqlite3.Row
    return db


def run_job(job, prepared, request):
    db = None
    try:
        getcontext().prec = 50  # This background thread owns its decimal context.
        db = connect(job)
        db.executescript('''
            CREATE TABLE rows (id INTEGER PRIMARY KEY, kind TEXT, data TEXT, raw TEXT,
                reasons TEXT, file TEXT, sheet TEXT, original_row INTEGER, fingerprint TEXT);
            CREATE TABLE duplicates (fingerprint TEXT PRIMARY KEY, count INTEGER);
            CREATE INDEX rows_kind ON rows(kind, id);
        ''')
        sources = []
        numeric_indices = [(i, c) for i, c in enumerate(request.template.columns) if c.type == 'number']
        totals = {c.id: Decimal(0) for _, c in numeric_indices}
        for item, sheet, selection in prepared:
            source = {'file': item['name'], 'sheet': sheet['name'], 'read': 0, 'valid': 0, 'issues': 0, 'blank': 0}
            for n, values, missing, raw in read_rows(item['path'], sheet['name'], item['encoding']):
                if n <= selection.header_row:
                    continue
                if is_blank(raw):
                    source['blank'] += 1
                    continue
                result, reasons = convert_row(values, missing, selection.rule, request.template, sheet['headers'])
                source['read'] += 1
                job['processed'] += 1
                if job['processed'] > MAX_ROWS:
                    raise ValueError('数据合计超过 10 万行')
                kind = 'issues' if reasons else 'valid'
                source[kind] += 1
                key = duplicate_key(result, request.template) if not reasons else None
                db.execute('INSERT INTO rows(kind,data,raw,reasons,file,sheet,original_row,fingerprint) VALUES (?,?,?,?,?,?,?,?)',
                           (kind, dumps(result), dumps(raw), dumps(reasons), item['name'], sheet['name'], n, key))
                if not reasons:
                    db.execute('INSERT INTO duplicates VALUES (?,1) ON CONFLICT(fingerprint) DO UPDATE SET count=count+1', (key,))
                    for i, col in numeric_indices:
                        if result[i] is not None:
                            totals[col.id] += Decimal(result[i])
                if job['processed'] % 1000 == 0:
                    db.commit()
            sources.append(source)
        db.commit()
        dup = db.execute('SELECT COALESCE(SUM(count),0), COALESCE(SUM(count-1),0), COUNT(*) FROM duplicates WHERE count>1').fetchone()
        job['summary'] = {'read': job['processed'], 'valid': sum(s['valid'] for s in sources),
                          'issues': sum(s['issues'] for s in sources), 'blank': sum(s['blank'] for s in sources),
                          'duplicate_rows': dup[0], 'duplicate_extra': dup[1], 'duplicate_groups': dup[2],
                          'totals': {k: wire(v) for k, v in totals.items()}, 'sources': sources}
        job['phase'] = '正在生成 Excel'
        export_workbook(job, db, request.template)
        job['status'] = 'done'
        job['phase'] = '处理完成'
    except Exception as exc:
        job['status'] = 'failed'
        job['error'] = str(exc) if isinstance(exc, ValueError) else '处理失败，请检查源文件并重试'
    finally:
        if db:
            db.close()
        RUN_LOCK.release()


def text_cell(ws, value, heading=False):
    if isinstance(value, str):
        value = ILLEGAL_XML.sub(lambda match: f'\\u{ord(match.group()):04x}', value)
    cell = WriteOnlyCell(ws, value=value)
    if isinstance(value, str):
        cell.data_type = 's'
    if heading:
        cell.font = Font(color='FFFFFF', bold=True)
        cell.fill = PatternFill('solid', fgColor='214C40')
    return cell


def append_text(ws, values, heading=False):
    ws.append([text_cell(ws, v, heading) for v in values])


def export_workbook(job, db, template):
    book = Workbook(write_only=True)
    details = book.create_sheet('销售明细')
    issues = book.create_sheet('问题行')
    summary = book.create_sheet('处理汇总')
    for sheet in (details, issues, summary):
        sheet.freeze_panes = 'A2'
        for index in range(1, min(30, len(template.columns) + 6) + 1):
            sheet.column_dimensions[get_column_letter(index)].width = 20
    append_text(details, [c.name for c in template.columns], True)
    max_raw = db.execute('SELECT COALESCE(MAX(LENGTH(raw)),0) FROM rows WHERE kind="issues"').fetchone()[0]
    raw_parts = max(1, (max_raw + 29999) // 30000)
    raw_headers = ['原始值（JSON）'] if raw_parts == 1 else [f'原始值JSON片段 {i+1}（按顺序拼接）' for i in range(raw_parts)]
    append_text(issues, ['文件', '工作表', '原始行号', '问题说明'] + raw_headers + [c.name for c in template.columns], True)
    cursor = db.execute('SELECT * FROM rows ORDER BY id')
    for row in cursor:
        values = json.loads(row['data'])
        if row['kind'] == 'issues':
            reasons = json.loads(row['reasons'])
            parts = [row['raw'][i * 30000:(i + 1) * 30000] for i in range(raw_parts)]
            append_text(issues, [row['file'], row['sheet'], row['original_row'],
                                '；'.join(f'{r["column"]}：{r["reason"]}' for r in reasons)] + parts + values)
        else:
            cells = []
            for value, col in zip(values, template.columns):
                if value is not None and col.type == 'number':
                    cell = WriteOnlyCell(details, Decimal(value))
                    cell.number_format = '#,##0.############'
                elif value is not None and col.type == 'date':
                    cell = WriteOnlyCell(details, date.fromisoformat(value))
                    cell.number_format = 'yyyy-mm-dd'
                else:
                    cell = text_cell(details, value)
                cells.append(cell)
            details.append(cells)
    details.auto_filter.ref = f'A1:{get_column_letter(len(template.columns))}{job["summary"]["valid"] + 1}'
    append_text(summary, ['处理指标', '结果'], True)
    labels = [('read', '读取数据行'), ('valid', '有效行'), ('issues', '问题行'), ('blank', '跳过空行'),
              ('duplicate_rows', '重复组内行数（全部保留）'), ('duplicate_extra', '重复的额外行数')]
    for key, label in labels:
        append_text(summary, [label, job['summary'][key]])
    for col in template.columns:
        if col.type == 'number':
            append_text(summary, [f'{col.name}合计（十进制精确文本）', job['summary']['totals'][col.id]])
    append_text(summary, [])
    append_text(summary, ['文件', '工作表', '读取行', '有效行', '问题行', '跳过空行'], True)
    for source in job['summary']['sources']:
        append_text(summary, [source[k] for k in ('file', 'sheet', 'read', 'valid', 'issues', 'blank')])
    append_text(summary, [])
    append_text(summary, ['明细导出行号', '文件', '工作表', '原始行号', '重复组（空白表示无重复）'], True)
    for index, row in enumerate(db.execute('SELECT r.*,d.count AS duplicate_count FROM rows r LEFT JOIN duplicates d ON r.fingerprint=d.fingerprint WHERE kind="valid" ORDER BY r.id'), 2):
        append_text(summary, [index, row['file'], row['sheet'], row['original_row'], row['fingerprint'][:12] if row['duplicate_count'] > 1 else ''])
    book.save(job['output'])


@app.post('/api/batches/{batch_id}/jobs')
def start_job(batch_id: str, request: RunRequest):
    prepared, total = prepare(batch_id, request)
    if not RUN_LOCK.acquire(blocking=False):
        raise HTTPException(409, '已有批次正在合并，请等待完成')
    job_id = uuid.uuid4().hex
    job = {'id': job_id, 'batch_id': batch_id, 'status': 'running', 'phase': '正在转换与检查',
           'processed': 0, 'total': total, 'summary': None, 'error': None,
           'template': request.template.model_dump(), 'db': WORK_DIR / f'{job_id}.sqlite',
           'output': WORK_DIR / f'{job_id}.xlsx'}
    JOBS[job_id] = job
    # The request object and all selected source metadata are snapshots.
    threading.Thread(target=run_job, args=(job, prepared, request.model_copy(deep=True)), daemon=True).start()
    return public_job(job)


def public_job(job):
    return {k: v for k, v in job.items() if k not in ('db', 'output')}


def job_for(job_id):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, '任务不存在或已过期')
    return job


@app.get('/api/jobs/{job_id}')
def get_job(job_id: str):
    return public_job(job_for(job_id))


@app.get('/api/jobs/{job_id}/rows')
def get_rows(job_id: str, kind: str = 'valid', page: int = 1, page_size: int = 50, duplicates_only: bool = False):
    job = job_for(job_id)
    if job['status'] != 'done':
        raise HTTPException(409, '任务尚未完成')
    if kind not in ('valid', 'issues') or page < 1 or not 1 <= page_size <= 200:
        raise HTTPException(400, '分页参数无效')
    db = connect(job)
    try:
        condition = 'r.kind=?' + (' AND d.count>1' if duplicates_only else '')
        total = db.execute(f'SELECT COUNT(*) FROM rows r LEFT JOIN duplicates d ON r.fingerprint=d.fingerprint WHERE {condition}', (kind,)).fetchone()[0]
        rows = db.execute(f'SELECT r.*,d.count AS duplicate_count FROM rows r LEFT JOIN duplicates d ON r.fingerprint=d.fingerprint WHERE {condition} ORDER BY r.id LIMIT ? OFFSET ?',
                          (kind, page_size, (page - 1) * page_size)).fetchall()
        return {'total': total, 'rows': [{'file': r['file'], 'sheet': r['sheet'], 'row': r['original_row'],
                    'values': json.loads(r['data']), 'raw': json.loads(r['raw']), 'reasons': json.loads(r['reasons']),
                    'duplicate_group': r['fingerprint'][:12] if (r['duplicate_count'] or 0) > 1 else None} for r in rows]}
    finally:
        db.close()


@app.get('/api/jobs/{job_id}/export')
def download(job_id: str):
    job = job_for(job_id)
    if job['status'] != 'done':
        raise HTTPException(409, '任务尚未完成')
    return FileResponse(job['output'], filename=f'sales-merged-{date.today().isoformat()}.xlsx',
                        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


DIST = ROOT / 'frontend/dist'
if DIST.exists():
    app.mount('/', StaticFiles(directory=DIST, html=True), name='frontend')
