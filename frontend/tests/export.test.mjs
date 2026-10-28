import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {unzipSync,strFromU8} from 'fflate';
import {writeFileSync} from 'node:fs';
import {database,putRows,restore} from '../src/storage.ts';
import {exportWorkbook,finishExport} from '../src/processing.ts';
import {operations as op} from '../src/operations.ts';
import {memoryEstimate} from '../src/preflight.ts';
test('streamed XLSX keeps one typed worksheet, frozen header, filter, and literal strings',async()=>{
 const template={name:'Typed',columns:[{id:'id',name:'ID',type:'text',required:true},{id:'v',name:'Value',type:'number',required:true},{id:'d',name:'Date',type:'date',required:true}]};
 const row={jobId:'typed',kind:'valid',fingerprint:'',duplicate:0,file:'sample.csv',sheet:'CSV',row:2,raw:[],reasons:[],values:['=literal<&', '0.1','2026-10-28']};
 await putRows([{...row,index:1},{...row,index:2,values:['0001','0.2','2026-10-29']},{...row,index:3,values:['0001','0.2','2026-10-29'],duplicate:1},{...row,index:4,kind:'issues',values:[],raw:['bad'],reasons:[{column:'Value',code:'invalid_number',reason:'bad'}]}]);
 const bytes=new Uint8Array(await(await exportWorkbook({id:'typed',locale:'en',template})).arrayBuffer());
 writeFileSync(new URL('../../docs/verification/export-single-sheet.xlsx',import.meta.url),bytes);
 const parts=unzipSync(bytes),book=XLSX.read(bytes,{type:'array',cellDates:true});
 assert.deepEqual(book.SheetNames,['Merged Data']);assert.equal(Object.keys(parts).filter(p=>/^xl\/worksheets\/sheet\d+.xml$/.test(p)).length,1);
 const sheet=book.Sheets['Merged Data'];assert.equal(sheet.A2.v,'=literal<&');assert.equal(sheet.A2.f,undefined);assert.equal(sheet.B2.t,'n');assert.equal(sheet.C2.t,'d');assert.equal(sheet.C2.v.toISOString().slice(0,10),'2026-10-28');assert.equal(sheet.A3.v,'0001');assert.equal(XLSX.utils.sheet_to_json(sheet).length,3);
 const xml=strFromU8(parts['xl/worksheets/sheet1.xml']);assert.match(xml,/pane ySplit="1"/);assert.match(xml,/autoFilter ref="A1:C4"/);assert.match(strFromU8(parts['xl/styles.xml']),/FF214C40/);
});
test('export failures preserve rows, restore as retryable and can retry without conversion',async()=>{
 const db=await database(),summary={read:1,valid:1,issues:0,blank:0,duplicate_rows:0,duplicate_extra:0,duplicate_groups:0,totals:{},sources:[]};
 const job={id:'retry',batchId:'retry',status:'running',phase:'',phase_code:'phase_exporting',locale:'en',processed:1,total:1,summary,template:{name:'Retry',columns:[{id:'id',name:'ID',type:'text',required:true}]},created:new Date().toISOString()};
 await putRows([{jobId:'retry',index:1,kind:'valid',fingerprint:'',duplicate:0,file:'a',sheet:'s',row:2,raw:[],reasons:[],values:['0001']}]);
 for(const error of [new RangeError('allocation failed'),new DOMException('full','QuotaExceededError'),new Error('write failed')]){
  await finishExport(job,async()=>{throw error;});const failed=await db.get('jobs',job.id);assert.equal(failed.status,'export-failed');assert.equal(failed.error_code,'browser.exportError');assert.equal(await db.count('rows',IDBKeyRange.bound(['retry',0],['retry',100])),1);
 }
 await db.put('settings',{batch:'retry',files:[],assignments:{},step:5,selectedTemplateId:null,preview:[],job},'workspace');
 const retry=await op.retryExport({id:job.id});assert.equal(retry.status,'running');let result;
 for(let i=0;i<100;i++){result=await op.getJob({id:job.id});if(result.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(result.status,'done');assert.ok((await op.exportJob({id:job.id})).blob.size>0);
 await db.put('jobs',{...job,status:'running',output:undefined});assert.equal((await restore()).workspace.job.status,'export-failed');
});
test('large batch warnings use conservative row count and device hints without hard blocking',()=>{
 assert.equal(memoryEstimate(50000,10,{deviceMemory:4}).warn,false);assert.equal(memoryEstimate(50001,10,{deviceMemory:4}).warn,true);assert.equal(memoryEstimate(100000,10,{userAgent:'iPhone'}).warn,true);assert.equal(memoryEstimate(100000,10,{deviceMemory:8,userAgent:'Desktop'}).warn,false);assert.equal(memoryEstimate(60000,2,{deviceMemory:4}).bytes,30720000);
});
