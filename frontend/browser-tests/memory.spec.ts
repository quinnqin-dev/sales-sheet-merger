import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
test('measure 100k export worker heap',async({page,context},info)=>{
 test.skip(info.project.name!=='chromium');
 test.setTimeout(180000);
 const session=await context.newCDPSession(page),sessions=new Set<string>(),usage=new Map<string,number>();let serial=0,peak=0;
 session.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker')sessions.add(e.sessionId);});
 session.on('Target.receivedMessageFromTarget',e=>{const m=JSON.parse(e.message);if(m.result?.usedSize){usage.set(e.sessionId,m.result.usedSize+(m.result.backingStorageSize||0));peak=Math.max(peak,[...usage.values()].reduce((a,b)=>a+b,0));}});
 await session.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:false});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();
 const worker=readdirSync(new URL('../dist/assets/',import.meta.url)).find(n=>n.startsWith('processing.worker-')&&n.endsWith('.js'))!;
 const timer=setInterval(()=>{for(const id of sessions)void session.send('Target.sendMessageToTarget',{sessionId:id,message:JSON.stringify({id:++serial,method:'Runtime.getHeapUsage'})}).catch(()=>{});},50);
 const result=await page.evaluate(async url=>{
  const worker=new Worker(url,{type:'module'});let seq=0;const pending=new Map();worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(data.error):p.resolve(data.value);};const rpc=(operation:string,payload?:any):Promise<any>=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,operation,payload});});
  const start=performance.now(),batch=(await rpc('createBatch')).id;
  const columns=Array.from({length:8},(_,i)=>({id:'c'+i,name:'C'+i,type:i?'number':'text',required:true})),template={name:'Scale',columns},headers=columns.map(c=>c.name),rule={id:'s',name:'Scale',headers,mappings:columns.map((c,i)=>({target_id:c.id,mode:'source',source_index:i,fixed:'',trim:true,fill:'',replacements:[],date_format:'%Y-%m-%d',number_style:'comma'}))};
  const csv=headers.join(',')+'\n'+Array.from({length:100000},(_,i)=>[String(i).padStart(8,'0'),...Array(7).fill('0.1')].join(',')).join('\n');const files=await rpc('addFiles',{batch,files:[new File([csv],'scale.csv')]});let job=await rpc('startJob',{batch,locale:'en',request:{template,selections:[{file_id:files[0].id,sheet:'CSV',header_row:1,rule}]}});
  while(job.status==='running'){await new Promise(r=>setTimeout(r,100));job=await rpc('getJob',{id:job.id});}const out=await rpc('exportJob',{id:job.id});return {status:job.status,summary:job.summary,seconds:(performance.now()-start)/1000,bytes:out.blob.size};
 },'/assets/'+worker);
 clearInterval(timer);expect(result.status).toBe('done');expect(result.summary.valid).toBe(100000);expect(result.summary.totals.c1).toBe('10000');expect(peak).toBeGreaterThan(0);
 const label=readFileSync(new URL('../src/processing.ts',import.meta.url),'utf8').includes('import ExcelJS')?'before':'after';
 writeFileSync(new URL(`../../docs/verification/memory-${label}.json`,import.meta.url),JSON.stringify({...result,workerHeapAndBackingPeakBytes:peak,sampleMs:50},null,2)+'\n');console.log('100k memory',label,peak,result.seconds);
});
