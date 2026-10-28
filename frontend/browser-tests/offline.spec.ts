import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
test('offline shell retains CSP, manifest, icons and processing worker',async({page,context},info)=>{
 test.skip(info.project.name==='webkit','See the stopped-server offline test for WebKit.');
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
  writeFileSync(path,original.replace("sheet-merger-","sheet-merger-update-"));
  await page.evaluate(async()=>{(window as any).stillHere=true;await (await navigator.serviceWorker.getRegistration())!.update();});
  await expect(page.getByText('A new version is available. Refresh to update.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).stillHere)).toBe(true);
  await page.locator('.offline-banner').getByRole('button',{name:'Dismiss notification',exact:true}).click();await expect(page.locator('.offline-banner')).toHaveCount(0);
 }finally{writeFileSync(path,original);}
});
// Keep the unmet WebKit freshness check visible as an expected failure.
// Its stopped-server test separately verifies offline refresh/import/export.
test('online navigation updates cached HTML before offline fallback',async({page,context},info)=>{
 test.fail(info.project.name==='webkit','WebKit 26 returns installed HTML despite enabled Navigation Preload under the unchanged strict CSP.');
 await page.goto('/');await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const path=new URL('../dist/index.html',import.meta.url),original=readFileSync(path,'utf8'),marker='network-first-probe-20261028';
 try{
  writeFileSync(path,original+`<!--${marker}-->`);const response=await page.goto('/?navigation-probe=20261028');expect(await response!.text()).toContain(marker);
  await context.setOffline(true);const cached=await page.reload();expect(await cached!.text()).toContain(marker);
 }finally{writeFileSync(path,original);}
});
test('opening an offline guide screenshot never overwrites the application shell',async({page,context},info)=>{
 test.skip(info.project.name==='webkit','See the stopped-server offline test for WebKit.');
 await page.goto('/');await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true);const image=await page.goto('/guide/result-en.webp');expect(image!.headers()['content-type']).toContain('image/webp');await page.goto('/');await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();
});
