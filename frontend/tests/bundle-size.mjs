import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {brotliCompressSync,constants} from 'node:zlib';
const root=new URL('../dist/',import.meta.url);
const rows=['index.html','sw.js',...readdirSync(new URL('assets/',root)).filter(n=>/\.(js|css)$/.test(n)).map(n=>'assets/'+n)].map(file=>{const data=readFileSync(new URL(file,root));return{file,bytes:data.length,br:brotliCompressSync(data,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length};});
writeFileSync(new URL('../../docs/verification/bundle-after.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
console.log(rows);
