import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { readLocale, setCurrentLocale, getLocale, translate, renderMessage, msg, errorMessage, LocalizedError, messageFromError, LANGUAGE_KEY } from '../src/i18n-core.ts';

test('English is the default regardless of browser language; saved Chinese is restored', () => {
  const saved = new Map();
  globalThis.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key,value) => saved.set(key,value)};
  assert.equal(readLocale(),'en');
  setCurrentLocale('zh-CN');
  assert.equal(saved.get(LANGUAGE_KEY),'zh-CN');
  assert.equal(readLocale(),'zh-CN');
  saved.set(LANGUAGE_KEY,'fr');
  assert.equal(readLocale(),'en');
  setCurrentLocale('en');
});

test('stored notices and errors retranslate without altering customer values', () => {
  const notice=msg('invalid_date',{format:'%Y/%m/%d'});
  const error={error:'An old rendered message',error_code:'invalid_headers'};
  setCurrentLocale('en');
  assert.match(renderMessage(notice),/Date does not match/);
  assert.match(errorMessage(error),/duplicate names/);
  setCurrentLocale('zh-CN');
  assert.match(renderMessage(notice),/日期格式不符/);
  assert.match(errorMessage(error),/重复列名/);
  assert.equal(notice.params.format,'%Y/%m/%d');
  assert.equal(error.error,'An old rendered message');
  assert.equal(translate('ui.provenance',{sheet:'客户原始表',row:42}),'客户原始表 · 第 42 行');
  setCurrentLocale('en');
});

test('blocked local storage still allows live language switching', () => {
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readLocale(),'en');
  setCurrentLocale('zh-CN');
  assert.equal(getLocale(),'zh-CN');
  assert.equal(translate('phase_done'),'处理完成');
  setCurrentLocale('en');
  assert.equal(translate('phase_done'),'Completed');
});

test('API error codes survive state storage and locale changes', () => {
  const descriptor=messageFromError(new LocalizedError('invalid_date',{format:'%d/%m/%Y'}));
  assert.equal(descriptor.code,'invalid_date');
  setCurrentLocale('zh-CN');
  assert.match(renderMessage(descriptor),/%d\/%m\/%Y/);
  assert.equal(messageFromError(new TypeError('fetch failed')).code,'network_error');
  setCurrentLocale('en');
  assert.equal(translate('unknown-code'),translate('invalid_config'));
});

test('every literal UI message key exists in both catalogs', () => {
  const en=JSON.parse(fs.readFileSync(new URL('../../shared/locales/en.json',import.meta.url),'utf8'));
  const zh=JSON.parse(fs.readFileSync(new URL('../../shared/locales/zh-CN.json',import.meta.url),'utf8'));
  const source=ts.createSourceFile('main.tsx',fs.readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let checked=0;
  function visit(node){
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['t','msg'].includes(node.expression.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
      const key=node.arguments[0].text;assert.ok(en[key],key);assert.ok(zh[key],key);checked++;
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  assert.ok(checked>150);
});
