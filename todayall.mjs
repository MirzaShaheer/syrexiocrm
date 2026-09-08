import { chromium } from 'playwright';
const BASE='http://localhost:3000';
const b=await chromium.launch(); const page=await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,140)));
await page.goto(BASE+'/login');
await page.fill('input[name="email"]','mir@agency.test');
await page.fill('input[name="password"]','changeme123');
await page.click('button[type="submit"]');
await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:15000});

// ---- per-row AssignOwner (the dropdown on an unassigned row)
async function perRow(n) {
  let worst=0;
  for (let k=0;k<n;k++){
    await page.goto(BASE+'/today',{waitUntil:'networkidle'});
    const rowSel = page.locator('select[id^="assign-"]').first();
    if (!(await rowSel.count())) { console.log('per-row assign: no unassigned rows left'); return true; }
    const t0=Date.now();
    await rowSel.selectOption({index:1});
    let ms=null;
    for(let i=0;i<40;i++){
      const gone = (await rowSel.count())===0;
      if (gone) { ms=Date.now()-t0; break; }
      const txt = await rowSel.locator('option').first().textContent().catch(()=>'');
      if (!(txt||'').includes('Assigning') && i>1) { ms=Date.now()-t0; break; }
      await page.waitForTimeout(250);
    }
    if(ms===null){ console.log(`per-row assign  *** STUCK on run ${k+1}`); return false; }
    worst=Math.max(worst,ms);
  }
  console.log(`per-row assign  ${n}/${n} settled, worst ${worst}ms`);
  return true;
}

// ---- BulkAssign
async function bulk() {
  await page.goto(BASE+'/today',{waitUntil:'networkidle'});
  const panel = page.locator('div.panel:has(h3:has-text("Assign several at once"))');
  if (!(await panel.count())) { console.log('bulk assign: panel not shown (needs >1 unassigned)'); return true; }
  const form = panel.locator('form');
  const cbs = await form.locator('input[type="checkbox"]').all();
  await cbs[0].check();
  await form.locator('select[name="userId"]').selectOption({index:1});
  const btn = form.locator('button[type="submit"]');
  const t0=Date.now(); await btn.click();
  for(let i=0;i<40;i++){ const t=((await btn.textContent().catch(()=>''))||'').trim(); if(!t.includes('Assigning')&&i>0){ console.log(`bulk assign     settled ${Date.now()-t0}ms`); return true; } await page.waitForTimeout(250); }
  console.log('bulk assign     *** STUCK'); return false;
}

let ok = true;
ok = await bulk() && ok;
ok = await perRow(3) && ok;
console.log('pageerrors:', errs.length, errs[0]||'');
await b.close();
process.exit(ok?0:1);
