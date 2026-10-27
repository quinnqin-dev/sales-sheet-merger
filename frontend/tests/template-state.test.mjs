import test from 'node:test';
import assert from 'node:assert/strict';
import {initialTemplateDraft, validTemplateDraft, SALES_TEMPLATE_EXAMPLE} from '../src/template-state.ts';

const example = {name:'Standard Sales Details', columns:[
  {id:'date',name:'Date',type:'date',required:true},
  {id:'amount',name:'Sales Amount',type:'number',required:true},
]};

test('fresh setup has no real sales fields or required values despite the example', () => {
  const draft=initialTemplateDraft(example,false);
  assert.equal(draft.name,'');
  assert.equal(draft.columns.length,1);
  assert.equal(draft.columns[0].name,'');
  assert.equal(draft.columns[0].required,false);
  assert.equal(draft.columns[0].type,'text');
  assert.equal(validTemplateDraft(draft),false);
  draft.name='Student Grades';draft.columns[0].name='Student ID';
  assert.equal(validTemplateDraft(draft),true);
  assert.equal(example.name,'Standard Sales Details');
  assert.equal(example.columns[0].name,'Date');
});

test('saved customer templates are copied without renaming or changing IDs', () => {
  const customer={name:'学生成绩',columns:[{id:'student',name:'学号',type:'text',required:true}]};
  const draft=initialTemplateDraft(customer,true);
  assert.deepEqual(draft,customer);
  draft.columns[0].name='Student ID';
  assert.equal(customer.columns[0].name,'学号');
  assert.equal(validTemplateDraft(draft),true);
});

test('blank and duplicate target columns cannot be saved', () => {
  assert.equal(validTemplateDraft({name:' ',columns:example.columns}),false);
  assert.equal(validTemplateDraft({name:'Grades',columns:[]}),false);
  assert.equal(validTemplateDraft({name:'Grades',columns:[{...example.columns[0],name:'   '}]}),false);
  assert.equal(validTemplateDraft({name:'Grades',columns:example.columns.map(c=>({...c,name:' Score '}))}),false);
  assert.equal(validTemplateDraft(structuredClone(example)),true);
});

test('reset produces a new empty draft without restoring example values or old target IDs', () => {
  const first=initialTemplateDraft(SALES_TEMPLATE_EXAMPLE,false);
  first.name='Student Grades';first.columns[0].name='Student ID';first.columns[0].required=true;
  const reset=initialTemplateDraft(SALES_TEMPLATE_EXAMPLE,false);
  assert.notEqual(reset.columns[0].id,first.columns[0].id);
  assert.equal(reset.name,'');assert.equal(reset.columns[0].name,'');
  assert.equal(reset.columns[0].required,false);
  assert.equal(validTemplateDraft(reset),false);
  assert.equal(SALES_TEMPLATE_EXAMPLE.name,'Standard Sales Details');
});

test('legacy template contents cannot auto-fill an unconfigured editor', () => {
  const old={name:'Old saved template',columns:[{id:'old',name:'Old field',type:'number',required:true}]};
  const draft=initialTemplateDraft(old,false);
  assert.equal(draft.name,'');assert.equal(draft.columns[0].name,'');
  assert.notEqual(draft.columns[0].id,'old');
  assert.equal(old.columns[0].name,'Old field');
});
