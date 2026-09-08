import { chromium } from 'playwright';
const BASE='http://localhost:3000';
const b=await chromium.launch(); const page=await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)));
await page.goto(BASE+'/login');
await page.fill('input[name="email"]','mir@agency.test');
await page.fill('input[name="password"]','changeme123');
await page.click('button[type="submit"]');
await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:15000});
await page.goto(BASE+'/today');
const href=await page.locator('a[href^="/contracts/"]:not([href="/contracts/new"])').first().getAttribute('href');
const marker='REG-'+Date.now();
let ok=true;
async function run(name, prep, sel, word, n){
  let worst=0;
  for(let k=0;k<n;k++){
    await page.goto(BASE+href,{waitUntil:'networkidle'});
    await prep(k);
    const btn=page.locator(sel); const t0=Date.now(); await btn.click();
    let ms=null;
    for(let i=0;i<40;i++){const t=(await btn.textContent().catch(()=>''))||''; if(!t.includes(word)&&i>0){ms=Date.now()-t0;break;} await page.waitForTimeout(250);}
    if(ms===null){console.log(`${name.padEnd(14)} *** STUCK run ${k+1}`);ok=false;return;}
    worst=Math.max(worst,ms);
  }
  console.log(`${name.padEnd(14)} ${n}/${n} settled, worst ${worst}ms`);
}
await run('postUpdate', async k=>page.fill('#update-body', marker+'-'+k), 'form:has(#update-body) button[type="submit"]','Posting',3);
await run('addNote',    async k=>page.fill('#note-body','n'+k), 'form:has(#note-body) button[type="submit"]','Saving',3);
await run('nextAction', async k=>page.fill('#next-text','na'+k), 'form:has(#next-text) button[type="submit"]','Saving',3);
// activity stamps
await page.goto(BASE+href,{waitUntil:'networkidle'});
for (const label of ['Client messaged','We replied']) {
  const btn=page.locator(`button:has-text("${label}")`).first();
  if(!(await btn.count())) { console.log(label+': not present'); continue; }
  const t0=Date.now(); await btn.click();
  let done=false;
  for(let i=0;i<32;i++){const t=((await btn.textContent().catch(()=>''))||'').trim(); if(!t.includes('Saving')&&i>2){done=true;break;} await page.waitForTimeout(250);}
  console.log(`${label.padEnd(16)} ${done?'settled ~'+(Date.now()-t0)+'ms':'*** STUCK'}`); if(!done) ok=false;
}
// every screen still renders
for (const p of ['/','/today','/week','/clients','/history','/people','/settings','/map']) {
  const r = await page.goto(BASE+p,{waitUntil:'domcontentloaded'});
  console.log(`${p.padEnd(10)} ${r.status()}`);
  if (r.status()>=400) ok=false;
}
console.log('pageerrors:', errs.length, errs[0]||'');
await b.close(); process.exit(ok?0:1);
