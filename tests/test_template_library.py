import json

from fastapi.testclient import TestClient

from backend import app as service
from test_merger import client, csv_bytes, make_rule, upload


def document(template_id='student-grades', name='Student grades'):
    return {'format': 'sales-sheet-merger.output-template', 'version': 1, 'id': template_id,
            'template': {'name': name, 'columns': [
                {'id': 'student_id', 'name': 'Student ID', 'type': 'text', 'required': True},
                {'id': 'score', 'name': 'Score', 'type': 'number', 'required': True}]}}


def test_create_edit_and_import_preserve_files_rules_and_active_template(client):
    initial = client.get('/api/config').json()
    batch, files = upload(client, [('students.csv', csv_bytes(['学号', '成绩'], [['S00001', 86]]))])
    rule = make_rule(['日期', '金额'], {'date': '日期', 'amount': '金额'})
    client.post('/api/rules', json=rule.model_dump())
    saved = {**document(), 'file_name': 'grades.json'}
    created = client.post('/api/templates', json=saved)
    assert created.status_code == 200
    lib = created.json()
    assert lib['templates'] == [saved]
    assert lib['template'] == initial['template'] and not lib['template_configured']
    # A lost response can be retried without creating another record.
    assert len(client.post('/api/templates', json=saved).json()['templates']) == 1
    changed = {**saved, 'template': {**saved['template'], 'name': 'Updated grades'}}
    assert client.post('/api/templates', json=changed).status_code == 409
    updated = client.put('/api/templates/student-grades', json=changed)
    assert updated.status_code == 200 and updated.json()['templates'][0] == changed
    assert updated.json()['rules'][0]['id'] == rule.id
    assert client.get(f'/api/batches/{batch}').json()['files'] == files
    assert client.put('/api/templates/missing', json={**changed, 'id': 'missing'}).status_code == 404
    assert client.put('/api/templates/wrong-id', json=changed).status_code == 400
    assert client.put('/api/template', json=changed['template']).status_code == 200
    reset = client.post('/api/template/reset').json()
    assert not reset['template_configured'] and reset['templates'] == [changed]
    backup = client.get('/api/config/export').json()
    assert client.post('/api/config/import', json=backup).json() == backup


def test_validate_template_files_without_mutating_the_library(client):
    original = client.get('/api/config').json()
    data = document(name='  Grades  ')
    data['template']['columns'][0]['name'] = '  Student ID  '
    checked = client.post('/api/templates/validate', json=data)
    assert checked.status_code == 200
    assert checked.json()['template']['name'] == 'Grades'
    assert checked.json()['template']['columns'][0]['name'] == 'Student ID'
    assert client.get('/api/config').json() == original
    for invalid in [dict(data, format='unknown'), dict(data, version=2), dict(data, id='invalid/path'), {'name': 'not a template'},
                    {**data, 'template': {'name': 'Grades', 'columns': []}}]:
        assert client.post('/api/templates/validate', json=invalid).status_code == 422
    assert client.get('/api/config').json() == original


def test_library_restart_and_migration_are_stable_and_do_not_rewrite_on_read(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'DATA_DIR', tmp_path / 'old-state')
    service.DATA_DIR.mkdir()
    old = {'version': 1, 'template': document()['template'], 'template_configured': True, 'rules': []}
    raw = json.dumps(old)
    path = service.DATA_DIR / 'library.json'
    path.write_text(raw)
    with TestClient(service.app) as session:
        first = session.get('/api/config').json()
        assert first['templates'][0]['template'] == old['template']
        assert path.read_text() == raw
    with TestClient(service.app) as session:
        assert session.get('/api/config').json() == first
        backup = session.get('/api/config/export').json()
        assert session.post('/api/config/import', json=backup).json() == first
    with TestClient(service.app) as session:
        assert session.get('/api/config').json() == first


def test_unconfigured_examples_do_not_migrate_and_duplicate_ids_are_rejected(client):
    assert client.post('/api/config/import', json={'version': 1, 'template_configured': True}).status_code == 400
    for flag in [False, None]:
        legacy = {'version': 1, 'template': document()['template'], 'rules': []}
        if flag is not None:
            legacy['template_configured'] = flag
        assert client.post('/api/config/import', json=legacy).json()['templates'] == []
    config = client.get('/api/config').json()
    config['templates'] = [{**document(), 'file_name': ''}] * 2
    assert client.post('/api/config/import', json=config).status_code == 400


def test_template_library_persists_independently_of_active_configuration(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'DATA_DIR', tmp_path / 'state')
    with TestClient(service.app) as session:
        for index in range(2):
            assert session.post('/api/templates', json=document(str(index))).status_code == 200
        backup = session.get('/api/config/export').json()
        assert len(backup['templates']) == 2 and backup['template_configured'] is False
    with TestClient(service.app) as session:
        assert session.get('/api/config').json() == backup
