import {scope, summarize, compare, rankedChanges, stockWatch, planLocal, answer} from "./metrics.js";
const $ = id => document.getElementById(id);
const pct = n => n == null ? "—" : (100 * n).toFixed(1) + "%";
const pts = n => n == null ? "—" : (n > 0 ? "+" : "") + (100 * n).toFixed(1) + " pp";
const el = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (className) node.className = className;
  return node;
};
function table(headers, rows) {
  if (!rows.length) return el("p", "No matching observations.");
  const t = el("table");
  const head = t.createTHead().insertRow();
  for (const title of headers) head.append(el("th",title));
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of row) tr.append(el("td", value));
  }
  return t;
}
try {
  const response = await fetch("./snapshot.json");
  if (!response.ok) throw Error("Snapshot is unavailable");
  const data = await response.json();
  const filters = ["day","market","word"];
  const markets = [...new Set(Object.values(data.stores).map(s=>s.city))];
  const locations = Object.values(data.stores).map(s=>s.name);
  const opts = [data.days, ["All markets", ...markets, ...locations], ["All keywords", ...Object.keys(data.words)]];
  opts.forEach((values, i) => values.forEach(value => $(filters[i]).append(new Option(value,value))));
  $("day").value = data.days.at(-1);
  const current = () => Object.fromEntries(filters.map(id => [id,$(id).value]));
  function render(){
    const f = current();
    const days = data.days.filter(day => day <= f.day);
    const dayRows = scope(data, f, [f.day]);
    const prev = scope(data, f, days.slice(-2,-1));
    const now = summarize(data,dayRows);
    const change = compare(data,dayRows,prev);
    $("status").textContent = f.day + " · First screen measured for " + now.first + "/" + now.planned +
      " searches · Full pagination for " + now.full + "/" + now.planned + " · " + now.empty + " verified empty";
    $("metrics").replaceChildren(...["Organic","Sponsored"].map((name,i)=>{
      const box=el("div",name); box.append(el("strong",pct(now.share[i]),i?"paid":"organic"),
        el("small",pts(change.delta[i]) + " vs prior day · " + change.matched + " matched"),
        el("small",pct(now.inStockShare[i]) + " in-stock share","stockshare")); return box;
    }));
    const trend = el("div",null,"trend");
    const daily = days.map(day => [day, summarize(data, scope(data,f,[day]))]);
    const largest = Math.max(0, ...daily.flatMap(([,s]) => s.share.filter(n => n !== null)));
    const scale = Math.max(1, Math.ceil(largest * 10)) / 10;
    for (const [day,s] of daily) {
      const col=el("div"), bar=el("div",null,"daybars");
      bar.title = day + " · Organic " + pct(s.share[0]) + " · Sponsored " + pct(s.share[1]) + " · " + s.first + "/" + s.planned + " measured";
      bar.setAttribute("aria-label",bar.title);
      if(s.share[0]==null) bar.append(el("span","—","missing"));
      else s.share.forEach((n,i)=>{const fill=el("span",null,i?"bar paid":"bar");fill.style.height=(n/scale*100)+"%";bar.append(fill)});
      col.append(bar,el("div",day.slice(-2),"daylabel"));trend.append(col);
    }
    const trendDetails = el("details",null,"trend-details");
    trendDetails.append(el("summary","Daily values and coverage"),
      table(["Date","Organic","Sponsored","Measured"],daily.map(([day,s]) =>
        [day,pct(s.share[0]),pct(s.share[1]),s.first+"/"+s.planned])));
    $("chart").replaceChildren(trend,el("small","November 2026 · 0–"+Math.round(scale*100)+"% scale"),trendDetails);
    const ranked = rankedChanges(data,dayRows,prev);
    const biggest = ranked.find(row => row.delta[0] < 0);
    const summary = biggest
      ? el("p", biggest.word + " in " + data.stores[biggest.store].name + " had the largest volume-weighted organic loss (" + pts(biggest.delta[0]) + ").")
      : el("p", ranked.length ? "No organic losses among compared searches." : "Daily comparison unavailable for this selection.");
    $("changes").replaceChildren(summary, table(["Search","Store","Organic","Paid","Top organic gainer"],
      ranked.slice(0,7).map(r=>[r.word,data.stores[r.store].name,pts(r.delta[0]),pts(r.delta[1]),r.gain])));
    const stock = stockWatch(data,dayRows);
    $("stock").replaceChildren(el("p",stock.out.length+" out of stock across "+stock.observed+" observed product-store pairs · "+stock.conflicts+" conflicting"),
      table(["Product","Store","Date"],stock.out.slice(0,10)),
      el("small",stock.out.length > 10 ? "Showing 10 of " + stock.out.length + " observations." : ""));
    const stores = new Set(dayRows.map(x=>x[1]));
    const keywords = new Set(dayRows.map(x=>x[2]));
    const gaps = data.gaps.filter(g=>g[0]===f.day && stores.has(g[1]) && keywords.has(g[2]));
    const details=el("details");
    details.append(el("summary",gaps.length+" searches with recorded failures"),
      table(["Store","Keyword","Page","Reason"],gaps.map(g=>[g[1],g[2],g[3],g[4]])));
    const aliases = Object.entries(data.aliases || {}).map(([id,a]) => a.name + " (" + id + ") matched " +
      data.stores[a.canonical].name + " on " + a.matched_nonempty + " non-empty first screens.");
    $("coverage").replaceChildren(el("p",(now.planned-now.first)+" missing first screens · "+(now.first-now.full)+" partially paginated searches"), details,
      ...aliases.map(a => el("p", a + " Duplicate excluded from rollups.")));
  }
  for(const id of filters) $(id).addEventListener("change",render);
  document.querySelectorAll(".prompts button").forEach(button=>button.onclick=()=>{$("question").value=button.textContent;$("question").focus()});
  document.querySelector("form").onsubmit=async event=>{
    event.preventDefault();
    const question=$("question").value.trim(), f=current(), button=document.querySelector(".primary");
    if(!question) return;
    button.disabled=true;
    $("answer").textContent="Checking the data…";
    let plan=planLocal(data,question,f), mode="Local query";
    try{
      const isLocal = ["127.0.0.1", "localhost"].includes(location.hostname);
      const options=isLocal && await fetch("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question})});
      if(options.ok){const result=await options.json(); if(result.plan){plan={...plan,...result.plan};mode="AI query";}}
    }catch{ /* Static deployments and offline mode use deterministic parsing. */ }
    $("answer").textContent=answer(data,plan,f)+"\n\n"+mode+" · QuickShelf snapshot";
    button.disabled=false;
  };
  render();
} catch(error) {
  $("status").textContent = "Could not load the QuickShelf snapshot. Generate it with python crawler.py export and reload.";
}

