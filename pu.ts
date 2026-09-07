import "dotenv/config";
import { chromium } from "playwright";
const B="http://127.0.0.1:3000";
async function main(){
  const b=await chromium.launch(); const ctx=await b.newContext(); const p=await ctx.newPage();
  await p.goto(`${B}/login`); await p.fill('input[name="email"]',"mir@agency.test");
  await p.fill('input[name="password"]',"changeme123"); await p.click('button[type="submit"]');
  await p.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:25000});
  await p.goto(`${B}/today`); await p.waitForTimeout(1500);
  const href=await p.locator('main a[href^="/contracts/"]').first().getAttribute("href");
  await p.goto(`${B}${href}`); await p.waitForTimeout(2000);
  await p.fill("#update-body","Instrumented "+Date.now());
  const btn=p.locator('button:has-text("Post")').first();
  const t0=Date.now(); console.log("client: clicked at 0");
  await btn.click();
  for(let i=0;i<70;i++){ await p.waitForTimeout(500);
    const t=await btn.innerText().catch(()=>"(gone)");
    if(!t.includes("Posting")){ console.log(`client: settled ${Date.now()-t0}ms`); break; } }
  await ctx.close(); await b.close();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
