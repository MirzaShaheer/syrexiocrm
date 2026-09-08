import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const BASE='http://localhost:3000';
const b=await chromium.launch(); const page=await b.newPage();
const errs=[];
page.on('pageerror',e=>errs.push(e.stack||String(e)));
await page.goto(BASE+'/login');
await page.fill('input[name="email"]','mir@agency.test');
await page.fill('input[name="password"]','changeme123');
await page.click('button[type="submit"]');
await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:15000});

let html=null;
page.on('response', async r=>{
  if (r.url().endsWith('/today') && r.request().resourceType()==='document') html = await r.text().catch(()=>null);
});
await page.goto(BASE+'/today',{waitUntil:'networkidle'});
if(!html){ html = await page.evaluate(()=>document.documentElement.outerHTML); console.log('(fell back to DOM html)'); }
writeFileSync('today-ssr.html', html);
console.log('ssr html bytes:', html.length);

// scan raw HTML for <form> nesting depth
let depth=0, maxDepth=0, nested=0;
const re=/<\/?form\b/gi; let m;
while((m=re.exec(html))){
  if(m[0][1]==='/'){ depth--; } else { depth++; if(depth>1) nested++; maxDepth=Math.max(maxDepth,depth); }
}
console.log('form max nesting depth:', maxDepth, '| nested form opens:', nested);

// same for <p> containing block elements, and <button> nesting
for (const [name,rx] of [['button', /<\/?button\b/gi], ['a', /<\/?a\b/gi]]) {
  let d=0,mx=0; let mm; const r2=new RegExp(rx.source, 'gi');
  while((mm=r2.exec(html))){ if(mm[0][1]==='/') d--; else { d++; mx=Math.max(mx,d);} }
  console.log(`${name} max nesting depth:`, mx);
}
console.log('pageerrors:', errs.length);
if (errs.length) console.log(errs[0].split('\n').slice(0,6).join('\n'));
await b.close();
