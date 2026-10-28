import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
test('offline shell retains CSP, manifest, icons and processing worker',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const cached=await page.evaluate(async()=>{const cache=await caches.open((await caches.keys())[0]);return (await cache.keys()).map(r=>new URL(r.url).pathname);});
 expect(cached).toContain('/manifest.webmanifest');expect(cached).toContain('/icon-512.png');expect(cached.some(p=>p.includes('processing.worker-'))).toBe(true);
 await context.setOffline(true);const response=await page.reload();
 expect(response!.headers()['content-security-policy']).toContain("connect-src 'none'");
 await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('updates wait for explicit refresh and can be dismissed',async({page},info)=>{
 test.skip(info.project.name!=='chromium');
 await page.goto('/');await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const path=new URL('../dist/sw.js',import.meta.url),original=readFileSync(path,'utf8');
 try{
  writeFileSync(path,original.replace("const CACHE = 'sheet-merger-","const CACHE = 'sheet-merger-update-"));
  await page.evaluate(async()=>{(window as any).stillHere=true;await (await navigator.serviceWorker.getRegistration())!.update();});
  await expect(page.getByText('A new version is available. Refresh to update.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).stillHere)).toBe(true);
  await page.locator('.offline-banner').getByRole('button',{name:'Dismiss notification',exact:true}).click();await expect(page.locator('.offline-banner')).toHaveCount(0);
 }finally{writeFileSync(path,original);}
});
