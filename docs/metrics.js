export function scope(data, filters, days) {
  return data.rows.filter(([day,store,word])=>days.includes(day) &&
    (filters.market==="All markets" || [data.stores[store].city,data.stores[store].name,store].includes(filters.market)) &&
    (filters.word==="All keywords" || word===filters.word));
}

export function summarize(data, rows, brand="Peakfuel") {
  let denominator=0, first=0, full=0, empty=0;
  const numerator=[0,0];
  for (const [, ,word,slots,top,complete] of rows) {
    full+=Number(complete);
    if (slots===null) continue;
    first++;
    empty+=Number(slots===0);
    const weight=data.words[word];
    denominator+=weight*slots;
    const counts=top[brand] || [0,0];
    numerator[0]+=weight*counts[0];
    numerator[1]+=weight*counts[1];
  }
  return {share:numerator.map(n=>denominator?n/denominator:null), planned:rows.length, first, full, empty};
}

export function compare(data, rows, previous, brand="Peakfuel") {
  const key=r=>JSON.stringify(r.slice(1,3));
  const earlier=new Map(previous.filter(r=>r[3]!==null).map(r=>[key(r),r]));
  const matched=rows.filter(r=>r[3]!==null && earlier.has(key(r)));
  const a=summarize(data,matched,brand).share, b=summarize(data,matched.map(r=>earlier.get(key(r))),brand).share;
  return {matched:matched.length,delta:a.map((n,i)=>n==null||b[i]==null?null:n-b[i])};
}

const brands = ["Brawn","Nutrova","Grainly","Cocobloom","FitFolk"];
export function rankedChanges(data, rows, previous) {
  const old=new Map(previous.map(r=>[JSON.stringify(r.slice(1,3)),r]));
  return rows.flatMap(r=>{
    const [,store,word]=r, before=old.get(JSON.stringify([store,word]));
    if(!before) return [];
    const {delta}=compare(data,[r],[before]);
    if(delta[0]===null) return [];
    const gain=brands.map(brand=>[brand,compare(data,[r],[before],brand).delta[0]]).sort((a,b)=>b[1]-a[1])[0];
    return [{store,word,delta,gain:gain[1]>0?gain[0]:"—"}];
  }).sort((a,b)=> a.delta[0]*data.words[a.word]-b.delta[0]*data.words[b.word]);
}

export function stockWatch(data, rows) {
  const observations=new Map();
  for (const [day,store,,,,,stock] of rows) {
    for (const [id,[title,inStock]] of Object.entries(stock)) {
      const key=JSON.stringify([day,store,id]);
      const row=observations.get(key)||{day,store,title,states:new Set()};
      row.states.add(inStock);
      observations.set(key,row);
    }
  }
  const all=[...observations.values()];
  return {observed:all.length, conflicts:all.filter(r=>r.states.size>1).length,
    out:all.filter(r=>r.states.size===1&&r.states.has(false)).map(r=>[r.title,data.stores[r.store].name,r.day])};
}

export function planLocal(data, question, f) {
  const q=question.toLowerCase();
  const words=Object.keys(data.words);
  const markets=[...new Set(Object.values(data.stores).flatMap(s=>[s.city,s.name,s.store_id]))];
  const market=markets.sort((a,b)=>b.length-a.length).find(n=>(" "+q.replace(/[^a-z0-9 ]/g," ")+" ").includes(" "+n.toLowerCase()+" ")) ?? (q.includes("bangalore")?"Bengaluru":f.market);
  const word=words.find(w=>q.includes(w))||f.word;
  let end=q.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]||f.day;
  if(q.includes("yesterday") && !q.includes("vs")) end=data.days[data.days.indexOf(f.day)-1]||"";
  const window=q.includes("week")?7:q.includes("trend")||q.includes("14 days")?14:1;
  let intent="unsupported";
  if (/stock|availability|available/i.test(q)) intent="stock";
  else if (/competit|who gained|who took|brawn|nutrova|grainly|cocobloom|fitfolk/.test(q)) intent="competitors";
  else if (/coverage|missing|measure|crawl|empty/.test(q)) intent="coverage";
  else if (/visibility|share|how did|perform|organic|sponsored|ranking|first screen/.test(q)) intent="visibility";
  const requested=q.match(/\b(?:on|for) ([a-z ]+)\b/)?.[1]?.trim();
  if (requested && !words.some(w=>requested.includes(w)) &&
      !markets.some(m=>requested.includes(m.toLowerCase())) &&
      !/^(peakfuel|us|all |the |this |last |both )/.test(requested) &&
      !/^(coverage|today|yesterday|organic|sponsored|paid|stock)/.test(requested)) intent="unsupported";
  return {intent,market,word,end,window};
}

export function answer(data, plan, filters) {
  const market=plan.market||filters.market, word=plan.word||filters.word;
  const validMarkets=Object.values(data.stores).flatMap(s=>[s.city,s.name,s.store_id]);
  if (market!=="All markets"&&!validMarkets.includes(market) || word!=="All keywords"&&!Object.hasOwn(data.words,word))
    return "That market or keyword is outside the tracked scope.";
  const idx=data.days.indexOf(plan.end);
  if (idx<0) return "There is no snapshot for that date. Choose November 1–14, 2026.";
  const width=[1,7,14].includes(plan.window)?plan.window:1;
  const start=Math.max(0,idx+1-width);
  const days=data.days.slice(start,idx+1);
  const f={market,word}, rows=scope(data,f,days), s=summarize(data,rows);
  const source=days[0]+(days.length>1?" through "+days.at(-1):"")+" | "+market+" | "+word+
    " | "+s.first+"/"+s.planned+" first screens measured, "+s.full+"/"+s.planned+" fully paginated.";
  const pct=n=>n===null?"unavailable":(100*n).toFixed(1)+"%";
  if (plan.intent==="coverage") return source+" "+s.empty+" measured searches were verified empty.";
  if (plan.intent==="stock") {
    const stock=stockWatch(data,rows);
    return stock.out.length+" out-of-stock product/store/day observations from "+stock.observed+
      " observed. "+stock.conflicts+" conflicting observations.\n"+
      stock.out.slice(0,5).map(r=>r.join(" · ")).join("\n")+"\n"+source;
  }
  const anchor=days.at(-1), prior=data.days[start-1], a=scope(data,f,[anchor]), b=scope(data,f,prior?[prior]:[]);
  const pp=n=>n===null?"unavailable":(n>=0?"+":"")+(100*n).toFixed(1)+" pp";
  if (plan.intent==="competitors") {
    const changes=brands.map(brand=>[brand,compare(data,a,b,brand)]).filter(row=>row[1].delta[0]!==null)
      .sort((x,y)=>y[1].delta[0]-x[1].delta[0]);
    const leader=changes.find(row=>row[1].delta[0]>0);
    return (leader?leader[0]+" led organic gains ("+pp(leader[1].delta[0])+" across "+leader[1].matched+
      " matched searches, "+prior+" vs "+anchor+").":changes.length?"No competitor gained organic share in the matched comparison.":"Organic comparison unavailable.")+"\n"+source;
  }
  if(plan.intent==="visibility") {
    const c=compare(data,a,b);
    return "Peakfuel held "+pct(s.share[0])+" organic and "+pct(s.share[1])+
      " sponsored first-screen share. "+(prior&&c.matched?"Organic "+pp(c.delta[0])+", sponsored "+pp(c.delta[1])+
      " from "+prior+" to "+anchor+" on "+c.matched+" matched searches. ":"")+source;
  }
  return "Ask about QuickShelf first-screen share, competitor gains, stock, or crawl coverage.";
}

