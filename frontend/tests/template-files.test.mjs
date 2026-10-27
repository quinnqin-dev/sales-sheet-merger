import test from 'node:test';
import assert from 'node:assert/strict';
import { templateDocument, chooseTemplateFile, writeTemplateFile, TemplateFileError } from '../src/template-files.ts';

const template = {name:'Student grades',columns:[{id:'student',name:'Student ID',type:'text',required:true}]};

test('template files contain versioned configuration and preserve column IDs', async () => {
  const doc=templateDocument(template,'grades');
  let output=''; let closed=false;
  await writeTemplateFile({name:'grades.json', async createWritable(){ return {async write(value){output=value;},async close(){closed=true;}};}},doc);
  assert.equal(closed,true);
  assert.deepEqual(JSON.parse(output),doc);
  assert.equal(JSON.parse(output).template.columns[0].id,'student');
  assert.deepEqual(Object.keys(JSON.parse(output)),['format','version','id','template']);
  assert.notEqual(templateDocument(template).id,templateDocument(template).id);
});

test('failed writes abort and do not claim that the file was closed', async () => {
  let aborted=false,closed=false;
  const failure=new Error('disk full');
  await assert.rejects(writeTemplateFile({name:'grades.json',async createWritable(){return {async write(){throw failure;},async close(){closed=true;},async abort(){aborted=true;}};}},templateDocument(template)),error=>error===failure);
  assert.equal(aborted,true); assert.equal(closed,false);
});

test('the native picker uses the user gesture and cancellation is not converted to success', async () => {
  let options;
  const cancelled=new DOMException('Cancelled','AbortError');
  globalThis.window={showSaveFilePicker(value){options=value;return Promise.reject(cancelled);}};
  const result=chooseTemplateFile({...template,name:'Grades / 7A'});
  assert.equal(options.suggestedName,'Grades _ 7A.sales-template.json');
  await assert.rejects(result,error=>error===cancelled);
  globalThis.window={};
  assert.throws(()=>chooseTemplateFile(template),error=>error instanceof TemplateFileError && error.message==='templates.browserUnsupported');
});
