import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const columns=[{id:'id',name:'Student ID',type:'text',required:true},{id:'score',name:'Score',type:'number',required:true}];
for(const width of [360,412,600,1024,1440]) test(`layout ${width}`,async({page},info)=>{
 test.skip(info.project.name!=='chromium');
 await page.setViewportSize({width,height:1000});await page.goto('/');
 await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();
 await page.evaluate(async(columns)=>{
  const db=await new Promise<IDBDatabase>((res,rej)=>{const r=indexedDB.open('sheet-merger',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const template={name:'Student grades',columns};const tx=db.transaction(['settings','files'],'readwrite');
  tx.objectStore('settings').put({version:1,template,template_configured:true,rules:[],templates:[{format:'sheet-merger.output-template',version:1,id:'grades',template,file_name:'grades.json'}]},'library');
  const file={id:'f',name:'grades.csv',size:28,encoding:'utf-8-sig',header_rows:{},sheets:[{name:'CSV',header_row:1,headers:['ID','Score'],sample:[],row_count:3,blank_count:0}]};
  tx.objectStore('files').put({id:'f',batchId:'b',meta:file,blob:new File(['ID,Score\n001,80'],'grades.csv')});
  tx.objectStore('settings').put({batch:'b',files:[file],assignments:{'f:CSV':{enabled:true,confirmed:false,rule:null}},step:2,selectedTemplateId:'grades',preview:[],job:null},'workspace');
  await new Promise<void>((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});db.close();
 },columns);
 await page.reload();await expect(page.getByRole('heading',{name:'Choose this batch’s output template',exact:true})).toBeVisible();
 const path='../docs/verification/screenshots';mkdirSync(path,{recursive:true});
 const check=async(name:string)=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const button of await page.locator('main .btn:visible').all()){
   const box=await button.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
  }
  await page.screenshot({path:`${path}/${name}-${width}.png`,fullPage:true});
 };
 await check('template-confirm');
 await page.getByRole('button',{name:'Output template',exact:true}).click();await page.getByRole('button',{name:'Edit template',exact:true}).click();
 await expect(page.getByLabel('Column 1 name',{exact:true})).toBeVisible();await check('template-editor');
});
