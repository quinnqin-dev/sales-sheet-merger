import {Zip, ZipDeflate, strToU8} from 'fflate';
import type {StoredJob, StoredRow} from './domain.ts';
import {database} from './storage.ts';
import type {Column} from './template-state';
const xml=(value:unknown)=>String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function letter(index:number):string {let s='';for(let i=index+1;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
const textCell=(ref:string,value:unknown,style=0)=>`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
export function writeHeader(columns:Column[]) {
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+columns.map((_,i)=>`<col min="${i+1}" max="${i+1}" width="20" customWidth="1"/>`).join('')+'</cols><sheetData><row r="1">'+columns.map((c,i)=>textCell(letter(i)+'1',c.name,1)).join('')+'</row>';
}
export function writeDataRow(row:StoredRow,columns:Column[],index:number) {
 return `<row r="${index}">`+row.values.map((value,i)=>{
  if(value==null)return '';
  const ref=letter(i)+index,type=columns[i].type;
  if(type==='text')return textCell(ref,value);
  let number:number=Number(value);
  if(type==='date'){
   const date=new Date(0),[y,m,d]=String(value).split('-').map(Number);date.setUTCFullYear(y,m-1,d);
   number=25569+date.getTime()/86400000;
  }
  return `<c r="${ref}" s="${type==='date'?3:2}"><v>${number}</v></c>`;
 }).join('')+'</row>';
}
export const writeAutoFilter=(count:number,columns:number)=>`</sheetData><autoFilter ref="A1:${letter(columns-1)}${count}"/></worksheet>`;
const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.############"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF214C40"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
// ExcelJS's browser bundle has no streaming workbook writer. Use the existing
// fflate incremental ZIP/Deflate API with inline strings instead: neither a full
// worksheet object model nor its full XML/string table is retained in memory.
// Only compressed output chunks and one 1,000-row IDB page are held at once.
export async function exportWorkbook(job:StoredJob) {
 const chunks:Uint8Array[]=[];let failure:Error|undefined;
 const zip=new Zip((error,data)=>{if(error)failure=error;else chunks.push(new Uint8Array(data));});
 const part=(path:string,content:string)=>{const entry=new ZipDeflate(path,{level:6});entry.mtime=new Date(2000,0,1);zip.add(entry);entry.push(strToU8(content),true);};
 part('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
 part('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 part('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Merged Data" sheetId="1" r:id="rId1"/></sheets></workbook>');
 part('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 part('xl/styles.xml',styles);
 const entry=new ZipDeflate('xl/worksheets/sheet1.xml',{level:6});entry.mtime=new Date(2000,0,1);zip.add(entry);entry.push(strToU8(writeHeader(job.template.columns)),false);
 const db=await database();let after=0,count=1;
 while(true){
  const tx=db.transaction('rows');let cursor=await tx.store.openCursor(IDBKeyRange.bound([job.id,after],[job.id,Number.MAX_SAFE_INTEGER],true,false));const page:StoredRow[]=[];
  while(cursor&&page.length<1000){page.push(cursor.value);cursor=await cursor.continue();}await tx.done;if(!page.length)break;
  const lines:string[]=[];for(const row of page){after=row.index;if(row.kind==='valid'&&!row.dropped)lines.push(writeDataRow(row,job.template.columns,++count));}
  entry.push(strToU8(lines.join('')),false);if(failure)throw failure;
 }
 entry.push(strToU8(writeAutoFilter(count,job.template.columns.length)),true);zip.end();if(failure)throw failure;
 return new Blob(chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
