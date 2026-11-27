import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {answer,compare,planLocal,scope,stockWatch,summarize} from "./docs/metrics.js";

const data = {
  days:["2026-11-13","2026-11-14"],
  stores:{S01:{store_id:"S01",name:"A",city:"Bengaluru"},S02:{store_id:"S02",name:"B",city:"Bengaluru"}},
  words:{"protein bar":100, "oats":10},
  rows:[
    ["2026-11-13","S01","protein bar",8,{Peakfuel:[2,0]},true,{}],
    ["2026-11-14","S01","protein bar",8,{Peakfuel:[4,1,3,1]},false,{P1:["Bar",false]}],
    ["2026-11-14","S01","oats",8,{Peakfuel:[0,0]},true,{P1:["Bar",true]}],
    ["2026-11-14","S02","oats",0,{},true,{}],
    ["2026-11-14","S02","protein bar",null,{},false,{}],
  ]
};
const filters={day:"2026-11-14",market:"All markets",word:"All keywords"};
const rows=scope(data,filters,["2026-11-14"]);

test("weighted shares exclude gaps and verified empty searches add zero slots",()=>{
  assert.deepEqual(summarize(data,rows),{share:[400/880,100/880],inStockShare:[300/880,100/880],planned:4,first:3,full:2,empty:1});
  assert.deepEqual(summarize(data, [rows.at(-1)]).share,[null,null]);
});

test("comparison pairs exact store and keyword",()=>{
  assert.deepEqual(compare(data,rows,[data.rows[0]]),{matched:1,delta:[.25,.125]});
});

test("contradicting stock observations are counted once and excluded from confirmed outages",()=>{
  assert.deepEqual(stockWatch(data,rows),{observed:1,conflicts:1,out:[]});
});

test("ask answer uses measured values and quotes its scope",()=>{
  const q=planLocal(data,"How did we do on protein bar this week?",filters);
  const result=answer(data,q,filters);
  assert.match(result,/37\.5% organic and 6\.3% sponsored/);
  assert.match(result,/protein bar \| 2\/3 first screens measured/);
  assert.match(answer(data,planLocal(data,"How did we do on mango?",filters),filters),/Ask about/);
});

test("export preserves availability gaps and legal empty searches",()=>{
  const snap=JSON.parse(readFileSync(new URL("./docs/snapshot.json",import.meta.url),"utf8"));
  assert.equal(snap.rows.length,snap.days.length*Object.keys(snap.stores).length*Object.keys(snap.words).length);
  const rowsByKey = new Map(snap.rows.map(row => [JSON.stringify(row.slice(0, 3)), row]));
  for (const gap of snap.gaps) {
    const row = rowsByKey.get(JSON.stringify(gap.slice(0, 3)));
    if (row) {
      assert.equal(row[5], false);
      if (gap[3] === 1) assert.equal(row[3], null);
    }
  }
  assert.ok(snap.rows.some(row=>row[3]===0 && row[5]));
  assert.ok(snap.rows.some(row=>row[3]>0 && !row[5]));
});


