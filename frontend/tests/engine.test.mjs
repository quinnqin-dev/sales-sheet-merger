import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readBook, inspectFile, inspectSheet, parseNumber, parseDate, convertRow, duplicateKey, validateRule } from '../src/engine.ts';
import { normal } from '../src/casefold.ts';
import { documentSchema, validateLibrary } from '../src/validation.ts';
import { TEMPLATE_FORMAT } from '../src/template-files.ts';

const template={name:'Records',columns:[{id:'id',name:'ID',type:'text',required:true},{id:'date',name:'Date',type:'date',required:true},{id:'value',name:'Value',type:'number',required:true}]};
const rule={id:'source',name:'Source',headers:['编号','日期','金额'],mappings:template.columns.map((c,i)=>({target_id:c.id,mode:'source',source_index:i,fixed:'',trim:true,fill:'',replacements:[],date_format:'%Y-%m-%d',number_style:'comma'}))};
const error=(fn,code)=>assert.throws(fn,e=>e.code===code);
const row=(values,missing=[])=>({row:2,values,raw:values,missing:new Set(missing)});
const excel=(book,ext='xlsx')=>new File([XLSX.write(book,{type:'array',bookType:ext})],`test.${ext}`);

test('decimal separators, exponent scale, precision, and exact arithmetic',()=>{
  assert.equal(parseNumber('1,234.50','comma').toFixed(),'1234.5');
  assert.equal(parseNumber('1.234,50','european').toFixed(),'1234.5');
  assert.equal(parseNumber('1.25e2','plain').toFixed(),'125');
  assert.equal(parseNumber('0.1','plain').plus(parseNumber('0.2','plain')).toFixed(),'0.3');
  for(const [value,style,code] of [['12,34','comma','comma_number'],['1,2.3','european','european_number'],['￥12','plain','number_symbols'],['0.1000000000000','plain','number_range'],['1e16','plain','number_range'],['123456789012345.1','plain','number_precision']]) error(()=>parseNumber(value,style),code);
  error(()=>parseNumber(true,'plain'),'invalid_number');
});
test('dates use explicit formats, validate calendar and time, and support years below 100',()=>{
  assert.equal(parseDate('27/10/2026','%d/%m/%Y'),'2026-10-27');
  assert.equal(parseDate('0099-02-28','%Y-%m-%d'),'0099-02-28');
  assert.equal(parseDate('20260228','%Y%m%d'),'2026-02-28');
  error(()=>parseDate('2026-02-29','%Y-%m-%d'),'invalid_date');
  error(()=>parseDate('2026-10-27 24:00:00','%Y-%m-%d %H:%M:%S'),'invalid_date');
});
test('one conversion pipeline handles shuffled headers, cleanup, fill, replacements and formula errors',()=>{
  const r=structuredClone(rule);r.mappings[0].replacements=[{before:'old',after:'000012'}];r.mappings[2].fill='1.2';
  const result=convertRow(row(['2026-10-27','  old  ','']),r,template,['日期','编号','金额']);
  assert.deepEqual(result.values,['000012','2026-10-27','1.2']);assert.deepEqual(result.reasons,[]);
  const bad=convertRow(row(['00001','2026-10-27',null],[2]),rule,template,rule.headers);
  assert.equal(bad.reasons[0].code,'formula_cache');
  const control=convertRow(row(['a\u0001','2026-10-27','1']),rule,template,rule.headers);
  assert.equal(control.reasons[0].code,'text_control');
  assert.equal(normal(' ＳＴＲＡＳＳＥ '),normal('Straße'));
  assert.equal(duplicateKey(['001','2026-10-27','1.0'],template),duplicateKey(['001','2026-10-27','1.00'],template));
  error(()=>validateRule({...rule,headers:['Other']},template,rule.headers),'rule_headers');
});
test('CSV retains string IDs, quoted cells, delimiter detection and GB18030',async()=>{
  const file=new File(['ID;Name;Score\r\n0001;"A; B";86\r\n'],'test.csv');
  const book=await readBook(file),sheet=inspectSheet(book,'CSV');
  assert.deepEqual(sheet.sample[0].values,['0001','A; B','86']);assert.equal(sheet.row_count,1);
  const gb=new File([new Uint8Array([0xd0,0xd5,0xc3,0xfb,0x2c,0x49,0x44,0x0a,0xd5,0xc5,0xc8,0xfd,0x2c,0x30,0x31])],'gb.csv');
  assert.equal((await inspectFile(gb,'gb')).error_code,'encoding_error');
  assert.deepEqual((await inspectFile(gb,'gb','gb18030')).sheets[0].sample[0].values,['张三','01']);
});
test('XLS and XLSX preserve zero masks, date epochs, sheets and uncached formulas',async()=>{
  for(const ext of ['xls','xlsx']) for(const date1904 of [false,true]) {
    const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([rule.headers,[12, date1904?44860:46322, 86.5]]);
    // Use the same known calendar date in both date systems.
    sheet.B2.v=date1904?44860:46322;sheet.B2.z='yyyy-mm-dd';sheet.A2.z='000000';
    XLSX.utils.book_append_sheet(book,sheet,'成绩');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Name'],['A']]),'Other');book.Workbook={WBProps:{date1904}};
    const parsed=await readBook(excel(book,ext));
    assert.equal(parsed.names.length,2);
    const data=[...parsed.rows('成绩')][1];assert.equal(data.values[0],'000012');
    assert.equal(data.values[1].toISOString().slice(0,10),'2026-10-27');
  }
  const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Value']]);sheet.A2={t:'n',f:'1+1'};sheet['!ref']='A1:A2';XLSX.utils.book_append_sheet(book,sheet,'Data');
  const parsed=await readBook(excel(book));assert.equal([...parsed.rows('Data')][1].missing.has(0),true);
});
test('invalid headers, shifted headers and input limits are reported',async()=>{
  const duplicate=await inspectFile(new File(['Name,Ｎａｍｅ\nA,B'],'bad.csv'),'bad');assert.equal(duplicate.sheets[0].error_code,'invalid_headers');
  const shifted=await inspectFile(new File(['Title\nID,Value\n001,2'],'shift.csv'),'shift','utf-8-sig',{CSV:2});assert.deepEqual(shifted.sheets[0].headers,['ID','Value']);
  const wide=await inspectFile(new File([Array(1001).fill('A').join(',')],'wide.csv'),'wide');assert.equal(wide.error_code,'column_limit');
  assert.equal((await inspectFile(new File(['bad'],'bad.txt'),'bad')).error_code,'unsupported_file');
});
test('legacy configuration migrates without changing customer column IDs and rejects conflicting IDs',()=>{
  const old={version:1,template,template_configured:true,rules:[rule]};
  const migrated=validateLibrary(old);assert.equal(migrated.templates.length,1);assert.deepEqual(migrated.templates[0].template,template);assert.deepEqual(migrated.rules,[rule]);
  assert.equal(migrated.templates[0].format,TEMPLATE_FORMAT);
  assert.equal(validateLibrary({...old,template_configured:false}).templates.length,0);
  error(()=>validateLibrary({...old,rules:[rule,rule]}),'duplicate_rules');
  error(()=>validateLibrary({...old,version:2}),'library_format');
});
test('legacy template files are accepted and normalized to the current format',()=>{
  const legacy={format:'sales-sheet-merger.output-template',version:1,id:'legacy',template};
  const document=documentSchema.parse(legacy);
  assert.equal(document.format,TEMPLATE_FORMAT);
  assert.deepEqual(document.template,template);
});
