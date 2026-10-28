import{test,expect}from'@playwright/test';
import{spawn}from'node:child_process';
import{mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';
test('inspect WebKit navigation preload in isolated static output',async({page},info)=>{
 test.skip(info.project.name!=='webkit');
 const root=mkdtempSync(join(tmpdir(),'sheet-navigation-probe-'));cpSync(new URL('../dist/',import.meta.url),root,{recursive:true});
 const swPath=join(root,'sw.js');let sw=readFileSync(swPath,'utf8');
 sw=sw.replace('self.addEventListener("install",',`const probe=async value=>{await(await caches.open(CACHE)).put('/navigation-diagnostic',new Response(JSON.stringify(value)));};\nself.addEventListener("install",`);
 sw=sw.replace('if (response?.ok) {',`await probe({phase:'response',exists:!!response,status:response?.status,url:response?.url});\n          if (response?.ok) {`);
 sw=sw.replace('// Keep the installed application',`await probe({phase:'assets',assets,missing:assets.filter(path=>!PRECACHE.includes(path)),hasMarker:html.includes('probe-new-html')});\n            // Keep the installed application`);
 sw=sw.replace('} catch {\n          /* Offline:',`} catch(error) {await probe({phase:'error',name:error.name,message:error.message});\n          /* Offline:`);
 writeFileSync(swPath,sw);
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4182','--strictPort','--outDir',root],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise<void>((res,rej)=>{server.stdout.on('data',d=>{if(String(d).includes('4182'))res();});server.on('error',rej);server.on('exit',c=>{if(c)rej(new Error('preview failed'));});});
  await page.goto('http://127.0.0.1:4182/');await expect(page.getByText('Ready for offline use',{exact:true})).toBeVisible();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const state=await page.evaluate(async()=>await(await navigator.serviceWorker.getRegistration())!.navigationPreload.getState());
  const html=join(root,'index.html');writeFileSync(html,readFileSync(html,'utf8')+'<!--probe-new-html-->');
  const response=await page.goto('http://127.0.0.1:4182/?probe=new');const body=await response!.text();
  const diagnostic=await page.evaluate(async()=>JSON.parse(await(await caches.match('/navigation-diagnostic'))!.text()));
  const result={state,fresh:body.includes('probe-new-html'),diagnostic};console.log(result);
  writeFileSync(new URL('../../docs/verification/webkit-navigation-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 }finally{server.kill('SIGTERM');rmSync(root,{recursive:true,force:true});}
});
