import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:3000';
const b=await chromium.launch(); const page=await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)));
await page.goto(BASE+'/login');
await page.fill('input[name="email"]','mir@agency.test');
await page.fill('input[name="password"]','changeme123');
await page.click('button[type="submit"]');
await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:15000});
await page.goto(BASE+'/today',{waitUntil:'networkidle'});

// scope strictly to the "Assign several at once" panel
const panel = page.locator('div.panel:has(h3:has-text("Assign several at once"))');
if (!(await panel.count())) { console.log('bulk panel not present (need >1 unassigned)'); await b.close(); process.exit(0); }
const form = panel.locator('form');
const cbs = await form.locator('input[type="checkbox"]').all();
console.log('checkboxes in bulk form:', cbs.length);
await cbs[0].check();
const sel = form.locator('select[name="userId"]');
console.log('selects in bulk form:', await sel.count());
await sel.selectOption({index:1});
const btn = form.locator('button[type="submit"]');
console.log('button before:', JSON.stringify((await btn.textContent())?.trim()));
const t0=Date.now(); await btn.click();
let ms=null;
for(let i=0;i<40;i++){ const t=((await btn.textContent().catch(()=>''))||'').trim(); if(!t.includes('Assigning')&&i>0){ms=Date.now()-t0;break;} await page.waitForTimeout(250); }
console.log('BULK ASSIGN:', ms===null?'*** STUCK':`SETTLED ${ms}ms`);
console.log('pageerrors:', errs.length, errs[0]||'');
await b.close();
