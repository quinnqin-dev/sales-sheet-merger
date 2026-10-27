import json

from fastapi.testclient import TestClient

from backend import app as service
from backend.models import DEFAULT_TEMPLATE
from test_merger import client, csv_bytes, upload


def test_fresh_example_is_not_configured_until_explicitly_saved(client):
    example=client.get('/api/config').json()
    assert example['template']['name']=='Standard Sales Details'
    assert example['template_configured'] is False
    # Even saving the identical example is an explicit configuration action.
    saved=client.put('/api/template',json=example['template'])
    assert saved.status_code==200 and saved.json()['template_configured'] is True
    assert client.get('/api/config').json()['template_configured'] is True


def test_invalid_output_template_keeps_unconfigured_state(client):
    template=DEFAULT_TEMPLATE.model_dump()
    for invalid in [dict(template,name=' '),dict(template,columns=[]),
                    dict(template,columns=[dict(template['columns'][0],name=' ')]),
                    dict(template,columns=[template['columns'][0],dict(template['columns'][1],name='Date')])]:
        assert client.put('/api/template',json=invalid).status_code==422
        assert client.get('/api/config').json()['template_configured'] is False


def test_configuring_template_preserves_imported_batch_and_file_ids(client):
    batch,files=upload(client,[('students.csv',csv_bytes(['学号','成绩'],[['S00001',86]]))])
    template={'name':'Student Grades','columns':[
        {'id':'student_id','name':'Student ID','type':'text','required':True},
        {'id':'score','name':'Score','type':'number','required':True}]}
    assert client.put('/api/template',json=template).json()['template_configured'] is True
    preserved=client.get(f'/api/batches/{batch}').json()['files']
    assert preserved==files
    assert preserved[0]['sheets'][0]['headers']==['学号','成绩']


def test_configured_state_survives_restart_and_json_export(tmp_path,monkeypatch):
    monkeypatch.setattr(service,'DATA_DIR',tmp_path/'state')
    with TestClient(service.app) as session:
        session.put('/api/template',json=DEFAULT_TEMPLATE.model_dump())
        backup=session.get('/api/config/export').json()
        assert backup['template_configured'] is True
    with TestClient(service.app) as session:
        assert session.get('/api/config').json()==backup
        assert session.post('/api/config/import',json=backup).json()==backup


def test_legacy_template_requires_manual_configuration_without_rewriting_user_content(tmp_path,monkeypatch):
    monkeypatch.setattr(service,'DATA_DIR',tmp_path/'legacy')
    service.DATA_DIR.mkdir()
    legacy={'version':1,'template':{'name':'我的成绩格式','columns':[
        {'id':'original-id','name':'原始学号','type':'text','required':True}]},'rules':[]}
    raw=json.dumps(legacy,ensure_ascii=False)
    (service.DATA_DIR/'library.json').write_text(raw,encoding='utf-8')
    with TestClient(service.app) as session:
        loaded=session.get('/api/config').json()
        assert loaded['template_configured'] is False
        assert loaded['template']==legacy['template']
        assert (service.DATA_DIR/'library.json').read_text('utf-8')==raw


def test_legacy_import_requires_configuration_and_explicit_choice_is_preserved(client):
    legacy={'version':1,'template':DEFAULT_TEMPLATE.model_dump(),'rules':[]}
    assert client.post('/api/config/import',json=legacy).json()['template_configured'] is False
    configured={**legacy,'template_configured':True}
    assert client.post('/api/config/import',json=configured).json()['template_configured'] is True
    unconfigured={**legacy,'template_configured':False}
    assert client.post('/api/config/import',json=unconfigured).json()['template_configured'] is False


def test_reset_preserves_rules_files_and_persists_unconfigured_state(client):
    from test_merger import make_rule
    rule=make_rule(['日期','金额'],{'date':'日期','amount':'金额'})
    assert client.post('/api/rules',json=rule.model_dump()).status_code==200
    student={'name':'Student Grades','columns':[{'id':'student','name':'Student ID','type':'text'}]}
    assert client.put('/api/template',json=student).json()['template_configured'] is True
    batch,files=upload(client,[('students.csv',csv_bytes(['学号','成绩'],[['S00001',86]]))])
    rules=client.get('/api/config').json()['rules']
    for _ in range(2):
        reset=client.post('/api/template/reset').json()
        assert reset['template_configured'] is False
        assert reset['rules']==rules
        assert client.get(f'/api/batches/{batch}').json()['files']==files
        assert client.get('/api/config').json()['template_configured'] is False
        assert client.get('/api/config/export').json()['template_configured'] is False


def test_reset_survives_restart(tmp_path,monkeypatch):
    monkeypatch.setattr(service,'DATA_DIR',tmp_path/'reset-state')
    with TestClient(service.app) as session:
        session.put('/api/template',json=DEFAULT_TEMPLATE.model_dump())
        session.post('/api/template/reset')
    with TestClient(service.app) as session:
        assert session.get('/api/config').json()['template_configured'] is False
