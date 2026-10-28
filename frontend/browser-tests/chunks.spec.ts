import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
test('reader warms at idle, writer stays unloaded and cold UI is interactive within budget',async({page},info)=>{
 test.skip(info.project.name!=='chromium');
 const requested:string[]=[];page.on('request',r=>requested.push(r.url()));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Merge spreadsheets',exact:true})).toBeVisible();
 const interactive=await page.evaluate(()=>performance.now());
 await expect.poll(()=>requested.some(url=>/\/reader-[^/]+\.js/.test(url))).toBe(true);
 expect(requested.some(url=>/\/writer-[^/]+\.js/.test(url))).toBe(false);
 writeFileSync(new URL('../../docs/verification/interactive.json',import.meta.url),JSON.stringify({coldInteractiveMilliseconds:interactive,requested:requested.map(url=>new URL(url).pathname)},null,2)+'\n');
 expect(interactive).toBeLessThanOrEqual(1200);
});
