import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:3100';
const b=await chromium.launch(); const page=await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,120)));
await page.goto(BASE+'/login');
await page.fill('input[name="email"]','mir@agency.test');
await page.fill('input[name="password"]','changeme123');
await page.click('button[type="submit"]');
await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:15000});
await page.goto(BASE+'/today',{waitUntil:'networkidle'});
const cbs = await page.locator('input[type="checkbox"]').all();
if (cbs.length < 1) { console.log('no unassigned rows to bulk assign'); await b.close(); process.exit(0); }
await cbs[0].check();
const sel = page.locator('select[name="userId"]').first();
console.log('userId select present:', await sel.count());
if (await sel.count()) await sel.selectOption({index:1});
const btn = page.locator('form button[type="submit"]:has-text("Assign")').first();
const t0=Date.now(); await btn.click();
let ms=null;
for(let i=0;i<40;i++){ const t=((await btn.textContent().catch(()=>''))||'').trim(); if(!t.includes('Assigning')&&i>0){ms=Date.now()-t0;break;} await page.waitForTimeout(250); }
console.log('bulk assign:', ms===null?'*** STUCK':`SETTLED ${ms}ms`);
console.log('pageerrors:', errs.length, errs[0]||'');
await b.close();
