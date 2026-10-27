import csv
import io
import json
import time
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from backend import app as service
from backend.engine import convert_row, inspect_sheet, parse_number, validate_rule
from backend.models import DEFAULT_TEMPLATE, Mapping, Rule


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'DATA_DIR', tmp_path / 'state')
    with TestClient(service.app) as client:
        yield client


def excel(headers, rows, other_sheets=None):
    book = Workbook()
    book.active.title = '明细'
    book.active.append(headers)
    for row in rows:
        book.active.append(row)
    for name, data in (other_sheets or {}).items():
        sheet = book.create_sheet(name)
        for row in data:
            sheet.append(row)
    stream = io.BytesIO()
    book.save(stream)
    return stream.getvalue()


def csv_bytes(headers, rows, encoding='utf-8-sig'):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(headers)
    writer.writerows(rows)
    return stream.getvalue().encode(encoding)


def make_rule(headers, fields, **changes):
    mappings = []
    for col in DEFAULT_TEMPLATE.columns:
        name = fields.get(col.id)
        mappings.append(Mapping(target_id=col.id, mode='source' if name else 'empty',
                                source_index=headers.index(name) if name else None,
                                **changes.get(col.id, {})))
    return Rule(id='example-rule', name='示例来源规则', headers=headers, mappings=mappings)


def upload(client, entries, batch=None):
    batch = batch or client.post('/api/batches').json()['id']
    response = client.post(f'/api/batches/{batch}/files', files=[('files', (n, data)) for n, data in entries])
    assert response.status_code == 200, response.text
    return batch, response.json()


def request_for(files, rules):
    return {'template': DEFAULT_TEMPLATE.model_dump(), 'selections': [
        {'file_id': f['id'], 'sheet': f['sheets'][0]['name'], 'header_row': f['sheets'][0]['header_row'],
         'rule': rule.model_dump()} for f, rule in zip(files, rules)]}


def run(client, batch, body):
    response = client.post(f'/api/batches/{batch}/jobs', json=body)
    assert response.status_code == 200, response.text
    job_id = response.json()['id']
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        job = client.get(f'/api/jobs/{job_id}').json()
        if job['status'] != 'running':
            assert job['status'] == 'done', job
            return job
        time.sleep(0.02)
    pytest.fail('Job timed out')


def test_three_sources_preview_export_and_reuse(client):
    h1 = ['销售日期', '订单编号', '商品', '件数', '收入']
    h2 = ['金额', '货号', '交易日', '销量']
    h3 = ['when', 'amount', 'order']
    batch, files = upload(client, [
        ('平台.xlsx', excel(h1, [['2026/10/27', '000123', '=literal', 2, '1,234.50'],
                               ['2026/10/27', '000123', '=literal', 2, '1,234.50'],
                               ['bad-date', '000124', '问题', 1, 'bad-money'],
                               [None] * 5])),
        ('门店.csv', csv_bytes(h2, [['20.10', '0011', '2026-10-27', 1]])),
        ('系统.xlsx', excel(h3, [[date(2026, 10, 27), -5.10, '00125']]))])
    # The product formula intentionally lacks cache; replace it with a literal CSV source below.
    rules = [make_rule(h1, {'date':'销售日期','order_id':'订单编号','product':'商品','quantity':'件数','amount':'收入'}, date={'date_format':'%Y/%m/%d'}),
             make_rule(h2, {'date':'交易日','sku':'货号','quantity':'销量','amount':'金额'}),
             make_rule(h3, {'date':'when','amount':'amount','order_id':'order'})]
    # Formula cache errors must be caught. Then use a fixed text value beginning '=' to check safe export.
    first_request = request_for(files, rules)
    pre = client.post(f'/api/batches/{batch}/preview', json=first_request).json()
    assert pre['rows'][0]['reasons'][0]['code'] == 'formula_cache'
    mapping = next(m for m in rules[0].mappings if m.target_id == 'product')
    mapping.mode, mapping.fixed = 'fixed', '=literal'
    body = request_for(files, rules)
    preview = client.post(f'/api/batches/{batch}/preview', json=body)
    assert preview.status_code == 200
    assert preview.json()['rows'][0]['values'][1] == '000123'
    assert len(preview.json()['rows'][2]['reasons']) == 2
    job = run(client, batch, body)
    summary = job['summary']
    assert (summary['read'], summary['valid'], summary['issues'], summary['blank']) == (5, 4, 1, 1)
    assert (summary['duplicate_rows'], summary['duplicate_extra']) == (2, 1)
    assert Decimal(summary['totals']['amount']) == Decimal('2484.00')
    rows = client.get(f'/api/jobs/{job["id"]}/rows?duplicates_only=true').json()
    assert rows['total'] == 2 and rows['rows'][0]['duplicate_group'] == rows['rows'][1]['duplicate_group']
    issue = client.get(f'/api/jobs/{job["id"]}/rows?kind=issues').json()['rows'][0]
    assert issue['row'] == 4 and issue['raw'][0] == 'bad-date'
    result = client.get(f'/api/jobs/{job["id"]}/export')
    book = load_workbook(io.BytesIO(result.content), data_only=False)
    assert book.sheetnames == ['Sales Details']
    details = book['Sales Details']
    assert details['B2'].value == '000123' and details['B2'].data_type == 's'
    assert details['D2'].value == '=literal' and details['D2'].data_type == 's'
    assert details['A2'].is_date and details['G2'].data_type == 'n'
    assert details.max_row == 5
    book.close()
    saved = client.post('/api/rules', json=rules[0].model_dump())
    assert saved.status_code == 200
    backup = client.get('/api/config/export').json()
    assert backup['rules'][0]['name'] == rules[0].name
    assert client.post('/api/config/import', json=backup).status_code == 200


def test_persistence_and_temporary_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'DATA_DIR', tmp_path / 'state')
    headers = ['日期', '金额']
    rule = make_rule(headers, {'date':'日期', 'amount':'金额'})
    with TestClient(service.app) as client:
        assert client.post('/api/rules', json=rule.model_dump()).status_code == 200
        batch, _ = upload(client, [('example.csv', csv_bytes(headers, [['2026-10-27', '0']]))])
        temporary = service.WORK_DIR
        assert temporary.exists()
    assert not temporary.exists()
    with TestClient(service.app) as client:
        assert client.get('/api/config').json()['rules'][0]['id'] == rule.id
        assert client.get(f'/api/batches/{batch}').status_code == 404
        assert list((service.DATA_DIR / 'temporary').iterdir()) == [service.WORK_DIR]


def test_reordered_headers_remap_and_cleaning():
    headers = ['日期', '金额', '编码']
    rule = make_rule(headers, {'date':'日期', 'amount':'金额', 'sku':'编码'}, sku={'fill':'unknown','replacements':[{'before':'old','after':'new'}]})
    validate_rule(rule, DEFAULT_TEMPLATE, ['金额', '编码', '日期'])
    values, reasons = convert_row(['0.10',' old ','2026-10-27'], set(), rule, DEFAULT_TEMPLATE, ['金额','编码','日期'])
    assert not reasons and values[2] == 'new' and values[6] == '0.10'
    values, reasons = convert_row(['0','', '2026-10-27'], set(), rule, DEFAULT_TEMPLATE, ['金额','编码','日期'])
    assert values[2] == 'unknown' and values[6] == '0' and not reasons
    with pytest.raises(ValueError):
        validate_rule(rule, DEFAULT_TEMPLATE, ['日期','新金额','编码'])


@pytest.mark.parametrize('value,style,expected', [('1,234.50','comma','1234.50'),('1.234,50','european','1234.50'),('0','plain','0'),('-5.25','plain','-5.25'),(12.5,'european','12.5')])
def test_numeric_conversion(value, style, expected):
    assert parse_number(value, style) == Decimal(expected)


@pytest.mark.parametrize('value,style', [('12,34','comma'),('1,2','plain'),('NaN','plain'),('Infinity','plain'),('￥10','comma'),('10.99','european'),('123456789012345.1','plain')])
def test_invalid_numbers(value, style):
    with pytest.raises(ValueError):
        parse_number(value, style)


def test_header_correction_encoding_and_unreadable_file_block(client):
    headers = ['日期','金额']
    data = excel(['销售明细'], [headers, ['2026-10-27', 10]], {'说明':[['备注']]})
    batch, files = upload(client, [('标题行.xlsx',data), ('损坏.xlsx',b'not an excel file')])
    first = files[0]
    rechecked = client.post(f'/api/batches/{batch}/files/{first["id"]}/inspect', json={'header_rows':{'明细':2}}).json()
    assert rechecked['sheets'][0]['headers'] == headers
    request = request_for([rechecked], [make_rule(headers, {'date':'日期','amount':'金额'})])
    assert client.post(f'/api/batches/{batch}/preview', json=request).status_code == 400
    assert client.delete(f'/api/batches/{batch}/files/{files[1]["id"]}').status_code == 200
    assert client.post(f'/api/batches/{batch}/preview', json=request).status_code == 200
    batch2, files2 = upload(client, [('中文.csv',csv_bytes(headers,[['2026-10-27',2]],'gb18030'))])
    assert files2[0]['error']
    fixed = client.post(f'/api/batches/{batch2}/files/{files2[0]["id"]}/inspect', json={'encoding':'gb18030'}).json()
    assert not fixed['error'] and fixed['sheets'][0]['row_count'] == 1


def test_multi_sheet_and_zero_padding(client):
    stream = io.BytesIO()
    book = Workbook()
    book.active.title = 'A'
    book.active.append(['日期','金额','编码'])
    book.active.append([date(2026,10,27),1,12])
    book.active['C2'].number_format = '000000'
    sheet = book.create_sheet('B')
    sheet.append(['日期','金额','编码'])
    sheet.append([date(2026,10,27),2,'000013'])
    book.save(stream)
    batch, files = upload(client, [('多工作表.xlsx',stream.getvalue())])
    rule = make_rule(['日期','金额','编码'], {'date':'日期','amount':'金额','sku':'编码'})
    body = request_for(files, [rule])
    second = dict(body['selections'][0], sheet='B')
    body['selections'].append(second)
    job = run(client,batch,body)
    rows = client.get(f'/api/jobs/{job["id"]}/rows').json()['rows']
    assert [r['values'][2] for r in rows] == ['000012','000013']
    assert job['summary']['totals']['amount'] == '3'


def test_duplicate_headers_and_limits(client):
    batch, files = upload(client,[('duplicate.csv',csv_bytes(['金额','金额'],[[1,2]]))])
    assert files[0]['sheets'][0]['error_code'] == 'invalid_headers'
    assert files[0]['error']
    response = client.post(f'/api/batches/{batch}/files', files=[('files',(f'{i}.csv',b'a\n1')) for i in range(30)])
    assert response.status_code == 400
    assert client.post('/api/config/import',json={'version':2}).status_code == 400
    template = DEFAULT_TEMPLATE.model_dump()
    template['columns'][1]['name'] = template['columns'][0]['name']
    assert client.put('/api/template',json=template).status_code == 422
    assert client.get('/api/health',headers={'host':'attacker.example'}).status_code == 403
    assert client.post('/api/batches',headers={'origin':'https://attacker.example'}).status_code == 403


def test_total_limit_without_partial_export(client):
    headers = ['日期','金额']
    batch, files = upload(client, [('a.csv',csv_bytes(headers, (['2026-10-27',1] for _ in range(60000)))),
                                  ('b.csv',csv_bytes(headers, (['2026-10-27',1] for _ in range(40001))))])
    rule = make_rule(headers,{'date':'日期','amount':'金额'})
    response = client.post(f'/api/batches/{batch}/jobs',json=request_for(files,[rule,rule]))
    assert response.status_code == 400 and response.json()['code'] == 'total_row_limit'


def test_long_problem_values_stay_available_in_page_results_not_excel(client):
    headers = ['日期','金额','备注']
    long_text = '长' * 40000
    batch, files = upload(client, [('long.csv',csv_bytes(headers,[['bad',1,long_text]]))])
    rule = make_rule(headers,{'date':'日期','amount':'金额','product':'备注'})
    job = run(client,batch,request_for(files,[rule]))
    assert job['summary']['issues'] == 1 and job['summary']['valid'] == 0
    book = load_workbook(io.BytesIO(client.get(f'/api/jobs/{job["id"]}/export').content),data_only=True)
    assert book.sheetnames == ['Sales Details']
    assert book['Sales Details'].max_row == 1
    problem = client.get(f'/api/jobs/{job["id"]}/rows?kind=issues').json()['rows'][0]
    assert problem['raw'] == ['bad','1',long_text]
    assert any(reason['code'] == 'text_length' for reason in problem['reasons'])
    book.close()


def test_job_keeps_rule_snapshot_and_export_type(client):
    headers = ['日期','金额']
    rule = make_rule(headers,{'date':'日期','amount':'金额'})
    channel = next(m for m in rule.mappings if m.target_id == 'channel')
    channel.mode, channel.fixed = 'fixed', 'Original'
    batch, files = upload(client,[('source.csv',csv_bytes(headers,[['2026-10-27','0.10']]))])
    body = request_for(files,[rule])
    job_response = client.post(f'/api/batches/{batch}/jobs',json=body)
    channel.fixed = 'Edited'
    assert client.post('/api/rules',json=rule.model_dump()).status_code == 200
    job_id = job_response.json()['id']
    for _ in range(100):
        state = client.get(f'/api/jobs/{job_id}').json()
        if state['status'] != 'running':
            break
        time.sleep(0.02)
    assert state['status'] == 'done'
    row = client.get(f'/api/jobs/{job_id}/rows').json()['rows'][0]
    assert row['values'][7] == 'Original'
    assert client.get('/api/jobs/not-a-job/export').status_code == 404
    assert client.get(f'/api/jobs/{job_id}/rows?page_size=10000').status_code == 400


@pytest.mark.scale
def test_thirty_files_one_hundred_thousand_rows(client):
    started = time.monotonic()
    headers = ['日期','订单','数量','金额']
    entries = []
    number = 0
    for i in range(30):
        count = 3333 if i < 29 else 3343
        rows = []
        for _ in range(count):
            rows.append(['2026-10-27',f'{number:08}',1,'1.10'])
            number += 1
        entries.append((f'来源{i+1:02}.csv',csv_bytes(headers,rows)))
    batch, files = upload(client, entries)
    rule = make_rule(headers,{'date':'日期','order_id':'订单','quantity':'数量','amount':'金额'})
    job = run(client,batch,request_for(files,[rule]*30))
    assert job['summary']['read'] == job['summary']['valid'] == 100000
    assert job['summary']['issues'] == job['summary']['duplicate_rows'] == 0
    assert Decimal(job['summary']['totals']['amount']) == Decimal('110000.00')
    page = client.get(f'/api/jobs/{job["id"]}/rows?page=2000').json()
    assert len(page['rows']) == 50 and page['rows'][-1]['values'][1] == '00099999'
    book = load_workbook(io.BytesIO(client.get(f'/api/jobs/{job["id"]}/export').content),read_only=True,data_only=True)
    assert book.sheetnames == ['Sales Details']
    count = 0
    total = Decimal(0)
    for row in book['Sales Details'].iter_rows(min_row=2,values_only=True):
        count += 1
        total += Decimal(str(row[6]))
    assert count == 100000 and total == Decimal('110000.0')
    book.close()
    print(f'\n30 files / 100000 rows / verified export: {time.monotonic()-started:.2f}s')
