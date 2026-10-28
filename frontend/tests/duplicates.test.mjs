import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {operations as op} from '../src/operations.ts';
import {restore} from '../src/storage.ts';
const template={name:'Records',columns:[{id:'id',name:'ID',type:'text',required:true},{id:'value',name:'Value',type:'number',required:true}]};
const rule={id:'source',name:'Source',headers:['ID','Value'],mappings:template.columns.map((c,i)=>({target_id:c.id,mode:'source',source_index:i,fixed:'',trim:true,fill:'',replacements:[],date_format:'%Y-%m-%d',number_style:'comma'}))};
test('all duplicate policies retain the same fingerprint definition and consistent exact totals',async()=>{
 for(const policy of [undefined,'keep-all','keep-first','keep-last']){
  const batch=(await op.createBatch()).id,files=await op.addFiles({batch,files:[new File(['ID,Value\n001,0.1\n001,0.10\n002,0.2\n002,0.20\n003,0.3\n004,0.4'],'data.csv')]});
  let job=await op.startJob({batch,locale:'en',request:{template,...(policy?{duplicatePolicy:policy}:{}),selections:[{file_id:files[0].id,sheet:'CSV',header_row:1,rule}]}});
  for(let i=0;job.status==='running'&&i<1000;i++){await new Promise(r=>setTimeout(r,2));job=await op.getJob({id:job.id});}
  assert.equal(job.status,'done');const keepAll=!policy||policy==='keep-all';assert.equal(job.summary.read,6);assert.equal(job.summary.valid,keepAll?6:4);assert.equal(job.summary.duplicate_rows,4);assert.equal(job.summary.duplicate_extra,2);assert.equal(job.summary.duplicate_dropped,keepAll?0:2);assert.equal(job.summary.totals.value,keepAll?'1.3':'1');assert.equal(job.summary.sources[0].valid,keepAll?6:4);
  const valid=await op.getRows({id:job.id,kind:'valid',page:1,duplicates:false});assert.equal(valid.total,keepAll?6:4);assert.equal(valid.rows.length,valid.total);
  const duplicate=await op.getRows({id:job.id,kind:'valid',page:1,duplicates:true});assert.equal(duplicate.total,4);assert.equal(duplicate.rows.filter(r=>r.dropped).length,keepAll?0:2);
  if(!keepAll)assert.deepEqual(valid.rows.map(r=>r.row),policy==='keep-first'?[2,4,6,7]:[3,5,6,7]);
  const book=XLSX.read(await(await op.exportJob({id:job.id})).blob.arrayBuffer(),{type:'array'});assert.deepEqual(book.SheetNames,['Merged Data']);assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Merged Data']).length,keepAll?6:4);
  assert.equal((await restore()).workspace.job.duplicatePolicy,policy??'keep-all');
 }
});
