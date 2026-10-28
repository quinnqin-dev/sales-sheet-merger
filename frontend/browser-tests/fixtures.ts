import {expect,type Page} from '@playwright/test';
export const template={name:'Student grades',columns:[{id:'id',name:'Student ID',type:'text',required:true},{id:'score',name:'Score',type:'number',required:true}]};
export const rule={id:'r',name:'Grades rule',headers:['ID','Score'],mappings:template.columns.map((c,i)=>({target_id:c.id,mode:'source',source_index:i,fixed:'',trim:true,fill:'',replacements:[],date_format:'%Y-%m-%d',number_style:'comma'}))};
export const csv=(rows=3)=>'ID,Score\n'+Array.from({length:rows},(_,i)=>`${String(i).padStart(8,'0')},0.1`).join('\n');
export async function seed(page:Page,rows=3,status='',step=4,url='/'){
 await page.goto(url);await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();await expect(page.getByText('Saved in this browser',{exact:true})).toBeAttached();
 await page.evaluate(async({template,rule,rows,status,step,data})=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sheet-merger',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction(['settings','files','jobs','rows'],'readwrite');
  const file={id:'f',name:'grades.csv',size:new Blob([data]).size,encoding:'utf-8-sig',header_rows:{},sheets:[{name:'CSV',header_row:1,headers:rule.headers,sample:[],row_count:rows,blank_count:0}]};
  const summary={read:rows,valid:rows,issues:0,blank:0,duplicate_rows:0,duplicate_extra:0,duplicate_groups:0,totals:{score:String(rows/10)},sources:[{file:file.name,sheet:'CSV',read:rows,valid:rows,issues:0,blank:0}]};
  const job=status?{id:'j',batchId:'b',status,phase:'',phase_code:'phase_exporting',locale:'en',processed:rows,total:rows,summary,template,created:new Date().toISOString(),...(status==='export-failed'?{error_code:'browser.exportError'}:{})}:null;
  tx.objectStore('settings').put({version:1,template,template_configured:true,rules:[rule],templates:[{format:'sheet-merger.output-template',version:1,id:'grades',template,file_name:'grades.json'}]},'library');
  tx.objectStore('files').put({id:'f',batchId:'b',meta:file,blob:new TextEncoder().encode(data).buffer});
  tx.objectStore('settings').put({batch:'b',files:[file],assignments:{'f:CSV':{enabled:true,confirmed:true,rule}},step,selectedTemplateId:'grades',preview:[],job},'workspace');
  if(job){tx.objectStore('jobs').put(job);for(let i=0;i<rows;i++)tx.objectStore('rows').put({jobId:'j',index:i+1,kind:'valid',fingerprint:'',duplicate:0,file:file.name,sheet:'CSV',row:i+2,raw:[],reasons:[],values:[String(i).padStart(8,'0'),'0.1']});}
  await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 },{template,rule,rows,status,step,data:csv(rows)});
 await page.reload();await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();
}
