import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {seed,csv} from './fixtures';
test('full backup, counted clear confirmation, restore and original file relinking',async({page,context})=>{
 await context.addInitScript(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});});page.on('dialog',d=>d.accept());
 await seed(page);await page.getByRole('button',{name:'Start merge',exact:true}).click();await expect(page.getByRole('button',{name:'Download merged Excel',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Source rules',exact:false}).first().click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export full backup',exact:true}).click();const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const buffer=Buffer.concat(chunks);expect(Object.keys(unzipSync(buffer))).toContain('result.xlsx');
 await page.getByRole('button',{name:'Clear browser data',exact:true}).click();const dialog=page.getByRole('dialog');
 for(const text of ['Batch files: 1','Generated merge results: 1','Template library: 1 templates','Rule library: 1 rules'])await expect(dialog.getByText(text,{exact:true})).toBeVisible();
 await page.screenshot({path:'../docs/verification/screenshots/clear-data-confirm.png'});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Clear browser data',exact:true}).click();await dialog.getByRole('button',{name:'Clear browser data',exact:true}).click();await expect(page.locator('.empty-files')).toBeVisible();
 await page.getByRole('button',{name:'Source rules',exact:false}).first().click();await page.getByLabel('Import full backup',{exact:true}).setInputFiles({name:'backup.zip',mimeType:'application/zip',buffer});
 await expect(page.getByRole('heading',{name:'Reselect the original files',exact:true})).toBeVisible();await expect(page.locator('.empty-files')).toBeVisible();
 await page.getByLabel('Upload spreadsheets',{exact:true}).setInputFiles({name:'grades.csv',mimeType:'text/csv',buffer:Buffer.from(csv())});await expect(page.locator('.file-name strong')).toHaveText('grades.csv');await expect(page.locator('.backup-pending')).toHaveCount(0);
 await page.getByRole('button',{name:'Next: confirm template',exact:true}).click();await page.getByRole('button',{name:'Confirm template, next',exact:true}).click();
 await expect(page.getByLabel('grades.csv source rule',{exact:true})).toHaveValue('r');await expect(page.getByText('0 / 1 confirmed',{exact:true})).toBeVisible();
});
test('low-memory preflight allows adjust or continue; updates cannot refresh an active merge',async({page,context},info)=>{
 test.skip(info.project.name!=='chromium');
 await context.addInitScript(()=>Object.defineProperty(navigator,'deviceMemory',{value:4,configurable:true}));
 await seed(page,60001);await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.getByRole('button',{name:'Start merge',exact:true}).click();await expect(page.getByRole('dialog').getByText('Large batch on a mobile or low-memory device',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to adjust',exact:true}).click();await page.getByRole('button',{name:'Start merge',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Converting and checking',exact:true})).toBeVisible();
 const path=new URL('../dist/sw.js',import.meta.url),original=readFileSync(path,'utf8');
 try{
  writeFileSync(path,original.replace("sheet-merger-","sheet-merger-busy-"));
  await page.evaluate(async()=>{(window as any).stillMerging=true;await(await navigator.serviceWorker.getRegistration())!.update();});
  await expect(page.getByText('A new version is ready. Refresh after this merge finishes.',{exact:true})).toBeVisible();await expect(page.locator('.offline-banner').getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();expect(await page.evaluate(()=>(window as any).stillMerging)).toBe(true);
  await page.screenshot({path:'../docs/verification/screenshots/update-during-merge.png'});
  await expect(page.getByRole('button',{name:'Download merged Excel',exact:true})).toBeVisible({timeout:120000});expect(await page.evaluate(()=>(window as any).stillMerging)).toBe(true);await expect(page.locator('.offline-banner').getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
 }finally{writeFileSync(path,original);}
});
test('recoverable export error stays on results page and retries saved rows',async({page})=>{
 await seed(page,3,'export-failed',5);await expect(page.getByRole('heading',{name:'Rows processed; export needs another attempt',exact:true})).toBeVisible();await expect(page.getByText('Export could not finish. Completed rows are still saved. Close other tabs and retry the export, or use a smaller batch.',{exact:true})).toBeVisible();
 await page.screenshot({path:'../docs/verification/screenshots/export-retry.png'});await page.getByRole('button',{name:'Retry export',exact:true}).click();await expect(page.getByRole('button',{name:'Download merged Excel',exact:true})).toBeVisible();
});
