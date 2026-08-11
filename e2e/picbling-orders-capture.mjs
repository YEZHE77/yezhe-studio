import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE='18976896425', PASSWORD=process.env.PICBLING_PWD||'';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
if(!PASSWORD){console.error('no pwd');process.exit(1);}
const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--window-size=1680,1050']});
try{
  const page=await browser.newPage(); await page.setViewport({width:1680,height:1050});
  page.on('dialog',async d=>{try{await d.dismiss();}catch{}});
  await page.goto('https://www.picbling.com/auth/login',{waitUntil:'networkidle2',timeout:60000}); await sleep(2500);
  await page.evaluate((ph)=>{const el=[...document.querySelectorAll('input')].find(i=>/手机|phone|tel/i.test((i.placeholder||'')+(i.name||'')))||[...document.querySelectorAll('input')][0];el.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,ph);el.dispatchEvent(new Event('input',{bubbles:true}));},PHONE);
  await page.evaluate((pw)=>{const el=[...document.querySelectorAll('input')].find(i=>i.type==='password');el.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,pw);el.dispatchEvent(new Event('input',{bubbles:true}));},PASSWORD);
  await sleep(500);
  await page.evaluate(()=>{const btn=[...document.querySelectorAll('button')].find(b=>/立即登录/.test(b.innerText||''));if(btn)btn.click();});
  await sleep(6000);
  await page.goto('https://www.picbling.com/pCenter/entry?login_success=1',{waitUntil:'domcontentloaded',timeout:45000}); await sleep(8000);
  await page.evaluate(()=>{const el=[...document.querySelectorAll('li,a,div,span')].find(d=>(d.innerText||'').trim()==='订单中心'&&d.getBoundingClientRect().width>40&&d.getBoundingClientRect().height>20);if(el)el.click();});
  await sleep(8000);
  console.log('URL:',page.url());
  await page.screenshot({path:'/tmp/picbling-orders.png'});
  const dom=await page.evaluate(()=>{
    const out=[]; const nodes=[]; let n;
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT);
    while((n=w.nextNode()))nodes.push(n);
    for(const el of nodes){
      if(el.tagName==='SCRIPT'||el.tagName==='STYLE')continue;
      const r=el.getBoundingClientRect();
      if(r.width<3||r.height<3)continue;
      const cs=getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden')continue;
      const text=(el.innerText||'').replace(/\s+/g,' ').trim().slice(0,36);
      out.push({tag:el.tagName.toLowerCase(),text,cls:(el.className||'').toString().slice(0,70),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},bg:cs.backgroundColor,color:cs.color,font:cs.fontSize+'/'+cs.fontWeight,border:cs.borderTopWidth+' '+cs.borderTopColor});
    }
    return out;
  });
  fs.writeFileSync('/tmp/picbling-orders-dom.json',JSON.stringify(dom,null,1));
  console.log('DOM ITEMS:',dom.length);
}finally{await browser.close();}
