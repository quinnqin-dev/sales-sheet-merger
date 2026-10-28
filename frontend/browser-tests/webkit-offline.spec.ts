import{test,expect}from'@playwright/test';
import{spawn}from'node:child_process';
import{template,rule,csv}from'./fixtures';
import * as XLSX from 'xlsx';
test('WebKit completes offline refresh, fresh import and export with its server stopped',async({page,context},info)=>{
 test.skip(info.project.name!=='webkit');
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4181','--strictPort'],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise<void>((resolve,reject)=>{server.stdout.on('data',data=>{if(String(data).includes('4181'))resolve();});server.on('error',reject);server.on('exit',code=>{if(code)reject(new Error('preview failed'));});});
  await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:4181/');await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Source rules',exact:false}).first().click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:'rules.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,template,template_configured:true,rules:[rule],templates:[{format:'sheet-merger.output-template',version:1,id:'grades',template,file_name:'grades.json'}]}))});
  await expect(page.getByText('Grades rule',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Batch merge',exact:true}).click();await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const stopped=new Promise<void>(resolve=>server.once('exit',()=>resolve()));server.kill('SIGTERM');await stopped;
  const response=await page.reload({timeout:15000});expect(response!.headers()['content-security-policy']).toContain("connect-src 'none'");
  await page.getByLabel('Upload spreadsheets',{exact:true}).setInputFiles({name:'grades.csv',mimeType:'text/csv',buffer:Buffer.from(csv())});
  await page.getByRole('button',{name:'Next: confirm template',exact:true}).click();await page.getByRole('combobox',{name:'Output template for this batch',exact:true}).selectOption('grades');await page.getByRole('button',{name:'Confirm template, next',exact:true}).click();
  await page.getByRole('button',{name:'Configure & confirm',exact:true}).click();await page.getByRole('button',{name:'Confirm mapping',exact:true}).click();await page.getByRole('button',{name:'Preview converted data',exact:true}).click();await page.getByRole('button',{name:'Start merge',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download merged Excel',exact:true})).toBeVisible();await page.screenshot({path:'../docs/verification/screenshots/offline-webkit.png',fullPage:true});
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download merged Excel',exact:true}).click();const stream=await(await event).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const book=XLSX.read(Buffer.concat(chunks));expect(book.SheetNames).toEqual(['Merged Data']);expect(XLSX.utils.sheet_to_json(book.Sheets['Merged Data'])).toHaveLength(3);
  await page.goto('http://127.0.0.1:4181/guide/result-en.webp');await page.goto('http://127.0.0.1:4181/');await expect(page.getByRole('button',{name:'Download merged Excel',exact:true})).toBeVisible();
 }finally{server.kill('SIGTERM');}
});
