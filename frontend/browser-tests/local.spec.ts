import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { readdirSync } from "node:fs";

const template={name:"Student grades",columns:[{id:"student",name:"Student ID",type:"text",required:true},{id:"name",name:"Name",type:"text",required:true},{id:"subject",name:"Subject",type:"text",required:true},{id:"score",name:"Score",type:"number",required:true}]};
const headers=[["学号","姓名","科目","成绩"],["Student ID","Student Name","Subject","Points"]];
const rules=headers.map((headers,n)=>({id:`source-${n}`,name:`Class ${n+1}`,headers,mappings:template.columns.map((c,i)=>({target_id:c.id,mode:"source",source_index:i,fixed:"",trim:true,fill:"",replacements:[],date_format:"%Y-%m-%d",number_style:"comma"}))}));
const library={version:1,template,template_configured:true,rules,templates:[{format:"sheet-merger.output-template",version:1,id:"grades",template,file_name:"grades.sheet-template.json"}]};
async function open(page:Page) {
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/"); await expect(page.getByRole("heading",{name:"Merge spreadsheets",exact:true})).toBeVisible();
}
async function importLibrary(page:Page) {
  await page.getByRole("button",{name:"Source rules",exact:false}).first().click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:"rules.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(library))});
  await expect(page.getByText("Class 1",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Batch merge",exact:true}).click();
}
async function uploadGrades(page:Page) {
  const files=headers.map((h,n)=>{
    const data=[h,...Array.from({length:12},(_,i)=>[String(n*12+i+1).padStart(6,"0"),`Student ${n*12+i+1}`,"Math",80+i])];
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),"Grades");
    return {name:`Class-${n+1}.xlsx`,mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:XLSX.write(book,{type:"buffer",bookType:"xlsx"})};
  });
  await page.getByLabel("Upload spreadsheets",{exact:true}).setInputFiles(files);
  await expect(page.getByText("Class-2.xlsx",{exact:true})).toBeVisible();
}
async function confirmAndMerge(page:Page) {
  await page.getByRole("button",{name:"Next: confirm template",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button",{name:"Confirm template, next",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button",{name:"Select template",exact:true}).click();
  await page.getByLabel("Output template for this batch").selectOption("grades");
  await page.getByRole("button",{name:"Confirm template, next",exact:true}).click();
  for(let i=0;i<2;i++) {
    await page.getByRole("button",{name:"Configure & confirm",exact:true}).first().click();
    await page.getByRole("button",{name:"Confirm mapping",exact:true}).click();
    await expect(page.getByText(`${i+1} / 2 confirmed`,{exact:true})).toBeVisible();
  }
  await page.getByRole("button",{name:"Preview converted data",exact:true}).click();
  await expect(page.getByText("000001",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Start merge",exact:true}).click();
  await expect(page.getByRole("button",{name:"Download merged Excel",exact:true})).toBeVisible();
}

test("five steps work offline, output is typed, and files/results restore after closing the tab",async({page,context})=>{
  // Force and verify the Firefox/Safari-style download fallback on every engine.
  await context.addInitScript(()=>{Object.defineProperty(window,"showSaveFilePicker",{value:undefined,configurable:true});});
  const requests:{method:string;url:string}[]=[];context.on("request",r=>requests.push({method:r.method(),url:r.url()}));
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await open(page);await importLibrary(page);
  await context.setOffline(true);
  await uploadGrades(page);await confirmAndMerge(page);
  await expect(page.locator(".result-stat").nth(1).locator("strong")).toHaveText("24");
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Download merged Excel",exact:true}).click();
  const stream=await (await download).createReadStream();const chunks:Buffer[]=[];
  for await(const chunk of stream) chunks.push(Buffer.from(chunk));
  const book=XLSX.read(Buffer.concat(chunks),{type:"buffer"});const sheet=book.Sheets[book.SheetNames[0]];
  expect(book.SheetNames).toEqual(["Merged Data"]);expect(sheet.A2.v).toBe("000001");expect(sheet.D2.t).toBe("n");expect(XLSX.utils.sheet_to_json(sheet)).toHaveLength(24);
  await expect(page.getByText("Saved in this browser",{exact:true})).toBeVisible();
  await context.setOffline(false);await page.reload();await expect(page.getByRole("button",{name:"Download merged Excel",exact:true})).toBeVisible();
  await page.close();const reopened=await context.newPage();await open(reopened);await expect(reopened.getByRole("button",{name:"Download merged Excel",exact:true})).toBeVisible();
  await reopened.getByRole("button",{name:"Import files",exact:true}).click();
  await expect(reopened.getByText("Class-1.xlsx",{exact:true})).toBeVisible();
  await reopened.getByRole("combobox",{name:"Language / 语言"}).selectOption("zh-CN");await expect(reopened.getByRole("heading",{name:"表格批量合并",exact:true})).toBeVisible();
  await reopened.getByRole("combobox",{name:"Language / 语言"}).selectOption("en");
  await reopened.getByRole("button",{name:"New batch",exact:true}).click();await expect(reopened.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
  await reopened.getByRole("dialog").getByRole("button",{name:"New batch",exact:true}).click();await expect(reopened.locator(".empty-files")).toBeVisible();
  expect(requests.every(r=>r.method==="GET" && new URL(r.url).origin==="http://127.0.0.1:4178")).toBe(true);expect(requests.some(r=>r.url.includes("/api"))).toBe(false);expect(errors).toEqual([]);
});

test("template save falls back to a JSON download, and delete requires confirmation",async({page,context})=>{
  await context.addInitScript(()=>{Object.defineProperty(window,"showSaveFilePicker",{value:undefined,configurable:true});});
  await open(page);await importLibrary(page);await page.getByRole("button",{name:"Output template",exact:true}).click();
  await page.getByRole("button",{name:"Edit template",exact:true}).click();
  await page.getByLabel("Column 1 name",{exact:true}).fill("Student identifier");
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Save file & add to library",exact:true}).click();
  expect((await download).suggestedFilename()).toBe("Student grades.sheet-template.json");
  await page.getByRole("button",{name:"Delete template Student grades",exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();await expect(page.getByRole("heading",{name:"Student grades",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Delete template Student grades",exact:true}).click();await page.getByRole("button",{name:"Confirm delete",exact:true}).click();await expect(page.getByText("No saved templates yet",{exact:true})).toBeVisible();
});

const workerName=readdirSync(new URL("../dist/assets/",import.meta.url)).find(n=>n.startsWith("processing.worker-")&&n.endsWith(".js"))!;
async function harness(page:Page) {
  await open(page);
  await page.evaluate((url)=>{
    const w=new Worker(url,{type:"module"});let id=0;const pending=new Map();
    w.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(data.error):p.resolve(data.value);};
    (window as any).rpc=(operation:string,payload:any)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});w.postMessage({id:key,operation,payload});});
  },`/assets/${workerName}`);
}
test("100,000 rows merge in a worker with exact totals and readable output",async({page},info)=>{
  test.skip(info.project.name!=="chromium","Scale run uses Chromium; all engines run the complete UI flow.");
  await harness(page);
  const result=await page.evaluate(async()=>{
    const rpc=(window as any).rpc;await rpc("clearData",{all:true});const batch=(await rpc("createBatch")).id;
    let pulses=0;const timer=setInterval(()=>pulses++,10);const start=performance.now();
    const data="ID,Value\n"+Array.from({length:100000},(_,i)=>`${String(i).padStart(8,"0")},0.1`).join("\n");
    const files=await rpc("addFiles",{batch,files:[new File([data],"scale.csv")]});
    const template={name:"Scale",columns:[{id:"id",name:"ID",type:"text",required:true},{id:"value",name:"Value",type:"number",required:true}]};
    const rule={id:"scale",name:"Scale",headers:["ID","Value"],mappings:template.columns.map((c,i)=>({target_id:c.id,mode:"source",source_index:i,fixed:"",trim:true,fill:"",replacements:[],date_format:"%Y-%m-%d",number_style:"comma"}))};
    let job=await rpc("startJob",{batch,locale:"en",request:{template,selections:[{file_id:files[0].id,sheet:"CSV",header_row:1,rule}]}});
    while(job.status==="running") {await new Promise(r=>setTimeout(r,200));job=await rpc("getJob",{id:job.id});}
    clearInterval(timer);const output=await rpc("exportJob",{id:job.id});const bytes=Array.from(new Uint8Array(await output.blob.arrayBuffer()));
    return {status:job.status,summary:job.summary,elapsed:performance.now()-start,pulses,bytes};
  });
  expect(result.status).toBe("done");expect(result.summary.valid).toBe(100000);expect(result.summary.totals.value).toBe("10000");expect(result.pulses).toBeGreaterThan(100);
  const book=XLSX.read(new Uint8Array(result.bytes),{type:"array"}),rows=XLSX.utils.sheet_to_json<any>(book.Sheets["Merged Data"]);
  expect(rows).toHaveLength(100000);expect(rows[0].ID).toBe("00000000");expect(rows[99999].ID).toBe("00099999");expect(rows.reduce((n,r)=>n+Math.round(r.Value*10),0)).toBe(100000);
  console.log(`100k: ${(result.elapsed/1000).toFixed(1)}s, ${result.pulses} main-thread timer ticks`);
});

test("another tab cannot overwrite a saved workspace",async({page,context})=>{
  await open(page);const second=await context.newPage();await second.goto("/");await expect(second.getByText("Sheet Merger is already open in another tab. Close that tab, then reload this page.",{exact:true})).toBeVisible();
  await page.close();await second.reload();await expect(second.getByRole("heading",{name:"Merge spreadsheets",exact:true})).toBeVisible();
});
