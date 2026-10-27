import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const elements = new Map();
const defaults = { costPrice:'12000',sellPrice:'29900',platform:'0.033',customFee:'3.3',shippingFee:'3000',adFee:'2500',fixedCostPerUnit:'500',taxType:'general',monthlyVolume:'500',targetMarginRate:'25' };
const get = id => { if (!elements.has(id)) elements.set(id, {value: defaults[id] || '', innerHTML:'', innerText:'', textContent:'', appendChild(){}}); return elements.get(id); };
const ctx = vm.createContext({ window:{}, document:{getElementById:get, createElement:()=>({})}, localStorage:{getItem:()=>null,setItem(){}}, console });
let passed=0;
function check(name, fn){fn();passed++;console.log('PASS', name);}
check('all inline scripts parse',()=>scripts.forEach(s=>new vm.Script(s)));
vm.runInContext(scripts.find(s=>s.includes('function estimateTax')), ctx);
check('scripts are vendored; no mutable executable CDN',()=>assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i));
check('static Tailwind CSS preserves dynamic profit colors without runtime compilation',()=>{
  assert.doesNotMatch(html, /<script[^>]+tailwind/);
  const css=fs.readFileSync(path.join(root,'vendor/tailwind-3.4.17.css'),'utf8');
  for(const cls of ['.text-emerald-400','.text-rose-400','.bg-gray-900'])assert.ok(css.includes(cls));
});
check('normal calculation remains available',()=>{ assert.equal(ctx.calculate(),true);assert.match(get('resNetProfit').innerText,/원/);assert.equal(get('inputError').textContent,''); });
check('negative, non-finite, blank, excessive and fractional quantity inputs block stale results',()=>{
  for(const [id, value] of [['costPrice','-1'],['sellPrice','Infinity'],['shippingFee',''],['customFee','101'],['monthlyVolume','1.5'],['adFee','1e20']]){
    const saved=get(id).value;get(id).value=value;assert.equal(ctx.calculate(),false);assert.equal(get('resNetProfit').innerText,'—');assert.ok(get('inputError').textContent);get(id).value=saved;
  }
  assert.equal(ctx.calculate(),true);
});
check('zero sale price stays finite',()=>{get('sellPrice').value='0';ctx.calculate();assert.equal(get('resMarginRate').innerText,'0.0%');get('sellPrice').value=defaults.sellPrice;});
check('recommended prices achieve target and are minimal whole-won values across 486 scenarios',()=>{
  for(const type of ['general','simple_retail','corporate'])for(const cost of [0,12000,1e6])for(const extra of [1,6000,90000])for(const fee of [0,.033,.4])for(const target of [.05,.25,.6,.85,.95,1]){
    const price=ctx.solveRecommendedPrice(cost,extra,fee,target,type);
    const profit=p=>p*(1-fee)-cost-extra-ctx.estimateTax(p,cost,type);
    if(price!==null){ assert.ok(profit(price)+1e-6>=price*target, `${type} ${cost} ${fee} ${target} ${price}`);if(price>1)assert.ok(profit(price-1)<(price-1)*target+1e-6); }
    else if(fee+target<1){const limit=1e12;assert.ok(profit(limit)<limit*target+1e-6);}
  }
});
check('zero costs require a positive selling price and feasible target',()=>{assert.equal(ctx.solveRecommendedPrice(0,0,.033,.25,'general'),1);assert.equal(ctx.solveRecommendedPrice(0,0,.95,.03,'general'),null);});
check('unachievable tax-inclusive margin is not reported as a finite price',()=>assert.equal(ctx.solveRecommendedPrice(12000,6000,.5,.45,'corporate'),null));
check('restored malformed storage does not execute data',()=>{ctx.localStorage.getItem=()=>'{"costPrice":{"valueOf":"bad"}}';ctx.restoreInputs();assert.equal(get('costPrice').value,'12000');});
console.log(`SUMMARY pass=${passed} fail=0`);
