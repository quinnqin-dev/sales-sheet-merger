import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { operations as op } from '../src/operations.ts';
import { database, saveWorkspace, restore, storageError } from '../src/storage.ts';

const template={name:'Records',columns:[{id:'id',name:'ID',type:'text',required:true},{id:'value',name:'Value',type:'number',required:true}]};
const rule={id:'source',name:'Source',headers:['ID','Value'],mappings:template.columns.map((c,i)=>({target_id:c.id,mode:'source',source_index:i,fixed:'',trim:true,fill:'',replacements:[],date_format:'%Y-%m-%d',number_style:'comma'}))};
test('files, mappings, complete output and exact totals survive restore; interrupted jobs cannot export',async()=>{
  await op.clearData({all:true});await op.applyTemplate(template);
  const batch=(await op.createBatch()).id;
  const files=await op.addFiles({batch,files:[new File(['ID,Value\n0001,0.1\n0001,0.10\n0002,0.2\n0003,bad\n'],'data.csv')]});
  const state={batch,files,assignments:{[files[0].id+':CSV']:{enabled:true,confirmed:true,rule}},step:4,selectedTemplateId:null,preview:[],job:null};
  await saveWorkspace(state);
  const request={template,selections:[{file_id:files[0].id,sheet:'CSV',header_row:1,rule}]};
  assert.equal((await op.preview({batch,request,locale:'en'})).rows.length,4);
  let job=await op.startJob({batch,request,locale:'zh-CN'});
  for(let i=0;i<1000&&job.status==='running';i++){await new Promise(r=>setTimeout(r,10));job=await op.getJob({id:job.id});}
  assert.equal(job.status,'done',JSON.stringify(job));assert.equal(job.summary.valid,3);assert.equal(job.summary.issues,1);assert.equal(job.summary.duplicate_rows,2);assert.equal(job.summary.totals.value,'0.4');
  const duplicates=await op.getRows({id:job.id,kind:'valid',page:1,duplicates:true});assert.equal(duplicates.total,2);assert.equal(duplicates.rows[0].duplicate_group,duplicates.rows[1].duplicate_group);
  const result=await op.exportJob({id:job.id}),book=XLSX.read(await result.blob.arrayBuffer(),{type:'array'});
  assert.deepEqual(book.SheetNames,['合并明细']);assert.equal(book.Sheets['合并明细'].A2.v,'0001');assert.equal(book.Sheets['合并明细'].B2.t,'n');assert.equal(XLSX.utils.sheet_to_json(book.Sheets['合并明细']).length,3);
  const restored=await restore();assert.equal(restored.workspace.job.status,'done');assert.deepEqual(restored.workspace.assignments,state.assignments);assert.equal(restored.workspace.files.length,1);
  // Simulate a page closing after inputs committed but before an output committed.
  const db=await database(),interrupted={...job,id:'interrupted',batchId:batch,status:'running',created:new Date().toISOString()};
  await db.put('jobs',interrupted);await saveWorkspace({...state,job:interrupted});
  assert.equal((await restore()).workspace.job.status,'interrupted');
  await assert.rejects(op.exportJob({id:'interrupted'}),e=>e.code==='job_incomplete');
  await op.clearData({all:false});assert.equal((await op.getConfig()).template.name,'Records');assert.equal(await db.count('files'),0);assert.equal(await db.count('rows'),0);
  await saveWorkspace(state);assert.equal((await restore()).workspace.batch,'');
  await op.clearData({all:true});assert.equal((await op.getConfig()).template_configured,false);
});
test('quota errors are explicit and aborted writes retain the previous saved library',async()=>{
  const original=await op.getConfig(),db=await database();
  const tx=db.transaction('settings','readwrite');await tx.store.put({...original,template_configured:true},'library');tx.abort();await tx.done.catch(()=>{});
  assert.deepEqual(await op.getConfig(),original);
  assert.equal(storageError(new DOMException('full','QuotaExceededError')).code,'browser.quota');
});
