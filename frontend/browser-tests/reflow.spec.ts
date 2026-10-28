import {test,expect} from '@playwright/test';
import {seed} from './fixtures';
test('400 percent equivalent reflow keeps mapping confirmation reachable',async({page},info)=>{
 test.skip(info.project.name!=='chromium');await page.setViewportSize({width:320,height:250});await seed(page);
 await page.getByRole('button',{name:'Back to rules',exact:true}).click();await page.locator('.rule-assignment .btn').first().click();
 const confirm=page.getByRole('button',{name:'Confirm mapping',exact:true});await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(320);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(250);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../docs/verification/screenshots/zoom-400-rule-editor.png'});await confirm.click();await expect(page.locator('.rule-modal')).toHaveCount(0);
});
