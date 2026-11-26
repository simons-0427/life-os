import {dayLabel, daysBetween, definitions, formatNumber, formatValue, groups, buildModel, numeric,
  observed, shift, stamp, weightGoalAt, weightGoalText, calorieGoalAt} from "./metrics.js";
import {buckets, detailedStats, histogram, moving, pairSeries, regression, series, sleepEstimate} from "./analysis.js";
import {clearCharts, comparisonChart, histogramChart, scatterChart, sleepRing, stackedStages, trendChart} from "./charts.js";
import {host, loadRecords, mobile} from "./connector.js";
import {quickEntryForm, recordDialog, settingsPanel} from "./editor.js";

const $ = id => document.getElementById(id);
const names = {overview:"Tagesübersicht",metrics:"Messwerte",math:"Mathematik",data:"API-Daten",settings:"Einstellungen"};
const initialDay = new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());
const state = {
  view:"overview", today:initialDay, day:initialDay, daySet:false, source:{state:"loading"}, profile:null,
  model:buildModel(), period:30, from:"", to:"", includeToday:false, group:"all", metric:"steps",
  rolling:7, grain:"day", correlationX:"steps", correlationY:"sleep_duration_minutes", lag:0,
  dataView:"original", rawView:"day", page:0, search:"", quickDrafts:new Map(), estimate:{},
};
const labels = {api:"API",derived:"Berechnet"};
const calculatedRecord = record => ["gymprogress-derived","gymprogress-history-derived"].includes(record.source);
const stageSpecs = [
  ["deep_sleep_minutes","Tiefschlaf","#8874f9","deep_sleep_phases"],
  ["light_sleep_minutes","Leichtschlaf","#a8a9ff","light_sleep_phases"],
  ["rem_sleep_minutes","REM","#e6abea","rem_sleep_phases"],
  ["awake_minutes","Wach","#f4bb6c","awake_phases"],
];
const primary = ["steps","sleep_duration_minutes","weight_kg","nutrition_kcal","cycling_km","resting_heart_rate_bpm",
  "sleep_score","training","sleep_heart_rate_bpm","target_phase","current_phase","notes"];
const pageSize=60;

function el(tag, className, ...children) {
  const node=document.createElement(tag);
  if (className) node.className=className;
  for (const child of children.flat()) {
    if (child!==null && child!==undefined) node.append(child);
  }
  return node;
}

function button(text,onClick,{active=false,className="control"}={}) {
  const node=el("button",`${className}${active?" active":""}`,text);
  node.type="button";
  node.addEventListener("click",onClick);
  return node;
}

function select(label,options,value,change) {
  const node=el("select","");
  for (const [key,text] of options) {
    const option=el("option","",text);
    option.value=key;
    node.append(option);
  }
  node.value=String(value);
  node.addEventListener("change",()=>change(node.value));
  return el("label","",label,node);
}

function check(label,checked,change) {
  const node=el("input","");
  node.type="checkbox";
  node.checked=checked;
  node.addEventListener("change",()=>change(node.checked));
  return el("label","check",node,label);
}

function setColor(node,color) {
  node.style.setProperty("--metric-color",color);
  return node;
}

const colorOf = definition => groups[definition?.group]?.color ?? groups.other.color;
const def = id => state.model.metrics.get(id) ?? definitions[id];
const sample = (id,day=state.day) => state.model.dates.get(day)?.get(id);
const measured = (id,day) => sample(id,day)?.value;
const dayText = day => dayLabel(day,{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const compactDay = day => dayLabel(day,{day:"numeric",month:"short",year:"numeric"});
const valueText = (id,v=measured(id)) => formatValue(v,def(id));
const small = text => el("p","text-small",text);
const chip = (text,className="") => el("span",`chip ${className}`,text);

function move(view) {
  state.view=view;
  render();
  window.scrollTo({top:0});
}

function openMetric(id) {
  state.metric=id;
  state.group=def(id)?.group ?? "all";
  move("metrics");
}

function chooseDay(day) {
  if (!day) return;
  state.daySet=true;
  state.day=day;
  state.page=0;
  render();
}

function showDayData(day) {
  state.daySet=true;
  state.day=day;
  state.rawView="day";
  state.dataView="original";
  state.page=0;
  state.search="";
  move("data");
}

function bounds() {
  const available=[...state.model.dates.keys()].sort();
  const earliest=available[0] ?? shift(state.today,-365);
  const end=state.includeToday?state.today:shift(state.today,-1);
  const to=state.period==="custom"?state.to || end:end;
  const from=state.period==="custom"?state.from || earliest
    : typeof state.period==="number"?shift(to,1-state.period):earliest;
  return [from, to>end?end:to];
}

function interval() {
  const [from,to]=bounds();
  const n=daysBetween(from,to);
  return n>0 && n<=10000 ? {from,to,n}:null;
}

function rangeControls() {
  const [from,to]=bounds();
  const toolbar=el("div","toolbar range-toolbar");
  const presets=[[7,"7 Tage"],[30,"30 Tage"],[90,"90 Tage"],[365,"1 Jahr"],["all","Gesamt"],["custom","Zeitraum"]];
  for (const [key,text] of presets) toolbar.append(button(text,()=>{
    if (key==="custom" && state.period!=="custom") {state.from=from; state.to=to;}
    state.period=key;
    state.page=0;
    render();
  },{active:state.period===key}));
  toolbar.append(check("Heute einbeziehen",state.includeToday,value=>{state.includeToday=value;state.page=0;render();}));
  if (state.period==="custom") {
    for (const [field,label] of [["from","Von"],["to","Bis"]]) {
      const input=el("input","");
      input.type="date";
      input.value=state[field];
      input.addEventListener("change",()=>{state[field]=input.value;state.page=0;render();});
      toolbar.append(el("label","",label,input));
    }
  }
  toolbar.append(el("span","text-small period",interval()?`${compactDay(from)} – ${compactDay(to)}`:"Zeitraum prüfen (maximal 10.000 Tage)"));
  return toolbar;
}

function panel(title,subtitle,...children) {
  const head=el("div","panel-head",el("div","",el("h2","",title),subtitle?small(subtitle):null));
  return el("section","panel",head,...children);
}

function legend(entries) {
  return el("div","legend",entries.map(entry=>setColor(el("span","legend-item",entry.name),entry.color)));
}

function miniGrid(entries) {
  return el("div","mini-grid",entries.map(([name,value])=>el("div","mini",el("span","",name),el("strong","",value))));
}

function table(headers, rows) {
  const head=el("thead","",el("tr","",headers.map(label=>el("th","",label))));
  const body=el("tbody","");
  for (const cells of rows) body.append(el("tr","",cells.map(cell=>el("td","",cell ?? "–"))));
  return el("div","table-wrap",el("table","",head,body));
}

function metricOptions(list=[...state.model.metrics.values()]) {
  return list.toSorted((a,b)=>a.label.localeCompare(b.label,"de")).map(item=>[item.id,item.label]);
}

function dayMetricCards() {
  const ids=["steps","sleep_duration_minutes","weight_kg","nutrition_kcal","cycling_km",
    "resting_heart_rate_bpm","sleep_score","training"];
  const cards=ids.map(id=>{
    const definition=def(id), entry=sample(id), value=entry?.value;
    const color=colorOf(definition);
    const points=series(state.model,id,shift(state.day,-13),state.day);
    const first=points.find(p=>numeric(p.value));
    const previous=points.slice(0,-1).findLast(p=>numeric(p.value));
    let detail=entry?.source ? labels[entry.source] : "Kein Wert an diesem Tag";
    if (numeric(value) && previous) {
      const delta=value-previous.value;
      detail=`${delta>0?"+":""}${formatNumber(delta)}${definition.unit?` ${definition.unit}`:""} zu ${dayLabel(previous.date)}`;
    } else if (!observed(value) && first) {
      const latest=points.findLast(p=>numeric(p.value));
      detail=`Zuletzt ${valueText(id,latest.value)} am ${dayLabel(latest.date)}`;
    }
    const node=button("",()=>openMetric(id),{className:"card"});
    node.append(el("span","card-title",definition.label),el("strong","card-value",valueText(id,value)),
      el("span","card-detail",detail));
    if(!mobile) node.append(trendChart([{points,color,name:definition.label}],{definition,spark:true,height:29}));
    return setColor(node,color);
  });
  return el("div","card-grid",cards);
}

function sleepPanel() {
  const stages=stageSpecs.map(([id,name,color,count])=>({id,name,color,value:measured(id),count:measured(count)}));
  const all=stages.every(stage=>numeric(stage.value));
  const sum=all?stages.reduce((total,item)=>total+item.value,0):0;
  const row=el("div","sleep-legend");
  for (const stage of stages) {
    row.append(setColor(el("span","colored",stage.name),stage.color),
      el("strong","",formatValue(stage.value,{unit:"min"})),
      el("span","share",[
        all&&sum>0?`${formatNumber(stage.value/sum*100,1)} %`:null,
        numeric(stage.count)?`${stage.count} Ph.`:null
      ].filter(Boolean).join(" / ") || "–"));
  }
  const missing=stages.some(stage=>!numeric(stage.value));
  const efficiency=valueText("stage_efficiency");
  return panel("Schlafphasen",compactDay(state.day),sleepRing(stages,measured("sleep_duration_minutes")),row,
    el("p","text-small sleep-note",missing?"Der Ring zeigt die Anteile der verfügbaren Phasen.":`Effizienz aus Schlaf- und Wachphasen ${efficiency}`));
}

function stageHistory(time) {
  const stages=stageSpecs.map(([id,name,color])=>({id,name,color}));
  const byStage=stages.map(({id})=>series(state.model,id,time.from,time.to));
  const rows=byStage[0].map((point,index)=>({date:point.date,values:byStage.map(column=>column[index].value)}));
  const complete=rows.filter(row=>row.values.every(value=>numeric(value)&&value>=0)).length;
  return panel("Schlafphasen im Verlauf",`${complete} / ${time.n} Tage mit vier Phasenwerten | Minuten`,
    stackedStages(rows,stages,item=>showDayData(item.date)),legend(stages));
}

function overview() {
  const options=["steps","sleep_duration_minutes","weight_kg","nutrition_kcal","cycling_km","resting_heart_rate_bpm","min_heart_rate_bpm"];
  const id=options.includes(state.metric)?state.metric:"steps";
  const definition=def(id);
  const time=interval();
  const points=time?series(state.model,id,time.from,time.to):[];
  const lines=[{points,color:colorOf(definition),name:definition.label},
    {points:moving(points,7),color:"#f0ecdb",name:"7-Tage-Mittel"}];
  const trend=panel("Verlauf",null,
    el("div","toolbar",select("Messwert",options.map(key=>[key,def(key).label]),id,key=>{state.metric=key;render();})),
    trendChart(lines,{definition,onPick:item=>chooseDay(item.date)}),legend(lines));
  const notes=measured("notes"), day=state.model.dates.get(state.day), goal=weightGoalAt(state.model,state.day);
  const actual=[...day?.values() ?? []].filter(entry=>observed(entry.value)&&entry.source!=="derived");
  const dayHead=el("div","section-heading",
    el("div","",el("h2","","Kennzahlen"),small(`${actual.length} Messwerte und Einträge`)),
    el("div","toolbar",
      state.day===state.today?chip("Laufender Tag","today"):null,
      button("‹",()=>chooseDay(shift(state.day,-1))),button("Heute",()=>chooseDay(state.today)),
      button("›",()=>chooseDay(shift(state.day,1)))));
  for (const [text,title] of [["‹","Vorheriger Tag"],["›","Nächster Tag"]]) {
    [...dayHead.querySelectorAll("button")].find(b=>b.textContent===text).setAttribute("aria-label",title);
  }
  return el("div","stack",el("section","",dayHead,dayMetricCards()),rangeControls(),
    el("div","panel-grid",trend,sleepPanel()),
    panel("Tagesprotokoll",null,el("dl","details-list",[
      ["Training",valueText("training")],["Geplante Phase",valueText("target_phase")],
      ["Aktuelle Phase",valueText("current_phase")],["Eintrag",notes ?? "–"],
      ["Gewichtsziel",goal?`${weightGoalText(goal)} kg`:"–"],["Gewichtsabweichung",valueText("weight_deviation")],
      ["Kalorienziel",formatValue(calorieGoalAt(state.model,state.day)?.value,definitions.zielkalorien)],
      ["Kalorienabweichung",valueText("calorie_deviation")],
      ["Mindestpuls",valueText("min_heart_rate_bpm")]
    ].flatMap(([key,value])=>[el("dt","",key),el("dd","wrap",value)])),
    el("div","legend",button("Alle Tageswerte",()=>showDayData(state.day)),newRecordButton())));
}

function categoryBars(samples) {
  const counts=new Map();
  for (const item of samples) counts.set(String(item.value),(counts.get(String(item.value))??0)+1);
  const sorted=[...counts].sort((a,b)=>b[1]-a[1]);
  if (!sorted.length) return small("Im Zeitraum sind keine Werte erfasst.");
  return el("div","breakdown",sorted.slice(0,30).map(([name,count])=>{
    const bar=el("span","");
    bar.style.setProperty("--width",`${100*count/sorted[0][1]}%`);
    return el("div","breakdown-row",el("span","wrap",name),el("span","bar",bar),
      el("span","nowrap",`${count} (${formatNumber(100*count/samples.length,1)} %)`));
  }));
}

function metricView() {
  const time=interval();
  const items=[...state.model.metrics.values()];
  const list=state.group==="all"?items:items.filter(item=>item.group===state.group);
  const tabs=el("div","tabs",
    [["all","Alle"],...Object.entries(groups).map(([key,value])=>[key,value.label])]
      .map(([key,text])=>button(text,()=>{state.group=key;render();},{active:state.group===key})));
  if (!list.length || !time) return el("div","stack",rangeControls(),tabs,el("p","loading","Für diese Auswahl fehlen Daten."));
  const id=list.some(item=>item.id===state.metric)?state.metric:list[0].id;
  const definition=def(id), points=series(state.model,id,time.from,time.to), stats=detailedStats(points);
  const displayColor=colorOf(definition);
  const values=[...state.model.dates.entries()].filter(([date])=>date>=time.from&&date<=time.to)
    .map(([date,day])=>({date,...day.get(id)})).filter(item=>observed(item.value)).sort((a,b)=>a.date.localeCompare(b.date));
  const coverage=`${values.length} / ${time.n} Tage`;
  const range=rangeControls();
  const metricPicker=el("div","toolbar",select("Messwert",metricOptions(list),id,key=>{state.metric=key;render();}));
  if (!stats.n) {
    const rows=values.toReversed().map(item=>[button(compactDay(item.date),()=>showDayData(item.date)),formatValue(item.value,definition),entryAction(item)]);
    return el("div","stack",range,tabs,panel(definition.label,coverage,metricPicker,
      id==="notes"?null:categoryBars(values),table(["Datum","Eintrag","Aktion"],rows)));
  }
  const displayPoints=state.grain==="day"?points:buckets(points,state.grain,definition.additive);
  const lines=[{points:displayPoints,name:definition.label,color:displayColor}];
  if (state.grain==="day" && state.rolling) lines.push({points:moving(points,state.rolling),name:`${state.rolling}-Tage-Mittel`,color:"#f0ecdb"});
  if (id==="weight_kg" && state.grain==="day") {
    const effective=points.map(({date})=>({date,goal:weightGoalAt(state.model,date)}));
    for (const [kind,name,color] of [["single","Ziel","#eaf5a4"],["low","Untergrenze","#85be8d"],["high","Obergrenze","#b3d691"]]) {
      const target=effective.map(({date,goal})=>({date,value:!goal?null:
        kind==="single"?(goal.low===goal.high?goal.low:null):(goal.low!==goal.high?goal[kind]:null)}));
      if (target.some(p=>numeric(p.value))) lines.push({points:target,name,color});
    }
  }
  if (id==="nutrition_kcal" && state.grain==="day") {
    const target=points.map(({date})=>({date,value:calorieGoalAt(state.model,date)?.value??null}));
    if (target.some(p=>numeric(p.value))) lines.push({points:target,name:"Kalorienziel",color:"#eaf5a4"});
  }
  const aggregation=state.grain==="day"?"Tageswerte":definition.additive?"Summe vorhandener Werte je Zeitraum":"Mittelwert vorhandener Werte je Zeitraum";
  const chart=panel(definition.label,`${coverage} | ${aggregation}`,metricPicker,
    el("div","toolbar legend",select("Auflösung",[["day","Täglich"],["week","Wöchentlich"],["month","Monatlich"]],state.grain,key=>{state.grain=key;render();}),
      state.grain==="day"?select("Gleitendes Mittel",[[0,"Aus"],[7,"7 Tage"],[14,"14 Tage"],[30,"30 Tage"]],state.rolling,key=>{state.rolling=Number(key);render();}):null),
    trendChart(lines,{definition,bars:definition.additive,height:260,onPick:item=>showDayData(item.date)}),legend(lines),
    definition.method?el("p","footnote",definition.method):null,
    state.grain==="day"&&state.rolling?el("p","footnote",`Das gleitende Mittel benötigt ein Fenster von ${state.rolling} Kalendertagen mit mindestens ${Math.ceil(state.rolling/2)} Messwerten.`):null);
  const report=panel("Kennzahlen",`${stats.n} numerische Tage`,miniGrid([
    ["Mittelwert",valueText(id,stats.avg)],["Median",valueText(id,stats.median)],["Minimum",valueText(id,stats.min)],
    ["Maximum",valueText(id,stats.max)],["Erster Messwert",valueText(id,stats.first.value)],["Letzter Messwert",valueText(id,stats.last.value)],
    ["Änderung",statNumber(stats.delta,definition.unit)],["Trend pro Woche",statNumber(numeric(stats.slope)?stats.slope*7:null,definition.unit)],
    ...(definition.additive?[["Summe",valueText(id,stats.sum)]]:[])
  ]),el("div","legend",button("Mathematik für diesen Messwert",()=>{state.metric=id;move("math");})));
  const rows=values.toReversed().map(item=>[
    button(compactDay(item.date),()=>showDayData(item.date)),formatValue(item.value,definition),
    entryAction(item),
  ]);
  return el("div","stack",range,tabs,chart,definition.group==="sleep"&&!mobile?stageHistory(time):null,
    report,panel("Einzelwerte",null,table(["Datum","Wert","Aktion"],rows)));
}

const statNumber = (value,unit="") => numeric(value)?`${formatNumber(value)}${unit?` ${unit}`:""}`:"–";

function mathView() {
  const time=interval();
  if (!time) return el("div","stack",rangeControls(),small("Wähle einen gültigen Zeitraum."));
  const numericList=[...state.model.metrics.values()].filter(metric=>
    [...state.model.dates.values()].some(day=>numeric(day.get(metric.id)?.value)));
  if (!numericList.length) return el("div","stack",rangeControls(),small("Keine Zahlenreihen verfügbar."),estimatePanel());
  const available=new Set(numericList.map(metric=>metric.id));
  const id=available.has(state.metric)?state.metric:numericList[0].id;
  const xKey=available.has(state.correlationX)?state.correlationX:numericList[0].id;
  const yKey=available.has(state.correlationY)?state.correlationY:numericList[1]?.id ?? xKey;
  const definition=def(id), values=series(state.model,id,time.from,time.to), stats=detailedStats(values);
  const xDef=def(xKey), yDef=def(yKey);
  const xValues=series(state.model,xKey,time.from,time.to), yValues=series(state.model,yKey,time.from,time.to);
  const pairs=pairSeries(xValues,yValues,state.lag);
  const fit=regression(pairs);
  const summary=panel("Verteilung und Trend",`Tage mit Zahl ${stats.n} / ${time.n}`,
    el("div","toolbar",select("Messwert",metricOptions(numericList),id,key=>{state.metric=key;render();})),
    histogramChart(histogram(values),colorOf(definition),definition.unit),
    miniGrid([["Ø Mittel",stats.avg],["Median",stats.median],["10. Perzentil",stats.p10],["90. Perzentil",stats.p90],
      ["1. Quartil",stats.q1],["3. Quartil",stats.q3],["Interquartilsabstand",stats.iqr],["Std.-Abweichung (n−1)",stats.sd],
      ["Minimum",stats.min],["Maximum",stats.max],["Δ erster bis letzter",stats.delta],["Trend je Tag",stats.slope],
      ["Varianz (n−1)",stats.variance],["R² der Zeitreihe",stats.r2],["Tage ohne Zahl",time.n-stats.n],
      ["Ausreißer (1,5 × IQR)",stats.outliers?.length]].map(([label,value])=>[label,statNumber(value)])),
    el("details","footnote",el("summary","","Formeln und Ausreißer"),
      el("p","","Mittelwert = Σx / n. Perzentile werden linear zwischen sortierten Messwerten interpoliert. IQR = Q3 − Q1. Stichprobenvarianz = Σ(x − Mittelwert)² / (n − 1). Die Standardabweichung ist die Wurzel daraus. Ausreißer liegen außerhalb Q1 − 1,5 × IQR oder Q3 + 1,5 × IQR."),
      el("p","","Die lineare Steigung nutzt echte Kalendertage. Lücken zählen zur Abdeckung und gehen nicht als Nullen in die Statistik ein."),
      stats.outliers?.length?table(["Datum","Wert"],stats.outliers.map(o=>[button(compactDay(o.date),()=>showDayData(o.date)),valueText(id,o.value)])):null));
  const periodSize=time.n;
  const prior=detailedStats(series(state.model,id,shift(time.from,-periodSize),shift(time.from,-1)));
  const change=numeric(stats.avg)&&numeric(prior.avg)?stats.avg-prior.avg:null;
  const comparison=panel("Vergleich mit dem vorherigen Zeitraum",`${periodSize} Tage je Zeitraum, Mittelwerte der erfassten Tage`,
    comparisonChart([{label:"Vorher",value:prior.avg,count:prior.n,color:"#a4b6c9"},
      {label:"Aktuell",value:stats.avg,count:stats.n,color:colorOf(definition)}],"Vergleich der Mittelwerte",definition.unit),
    miniGrid([["Aktueller Zeitraum",statNumber(stats.avg,definition.unit)],["Vorheriger Zeitraum",statNumber(prior.avg,definition.unit)],
      ["Veränderung",statNumber(change,definition.unit)],["Relative Änderung",statNumber(numeric(change)&&prior.avg!==0?100*change/Math.abs(prior.avg):null,"%")],
      ["Abdeckung aktuell",`${stats.n}/${periodSize}`],["Abdeckung vorher",`${prior.n}/${periodSize}`]]),
    el("p","footnote","Relative Änderung = Differenz der Mittelwerte ÷ Betrag des vorherigen Mittelwerts × 100."));
  const weekdays=["Mo","Di","Mi","Do","Fr","Sa","So"].map((label,i)=>{
    const subset=values.filter(item=>((stamp(item.date)+3)%7+7)%7===i);
    const result=detailedStats(subset);
    return {label,value:result.avg,count:result.n,color:colorOf(definition)};
  });
  const pattern=panel("Muster nach Wochentag",`Durchschnitt je Wochentag${definition.unit?` in ${definition.unit}`:""}`,
    comparisonChart(weekdays,"Mittelwerte nach Wochentag",definition.unit),
    miniGrid(weekdays.map(item=>[item.label,`${statNumber(item.value)} (n=${item.count})`])));
  const lags=Array.from({length:15},(_,i)=>i-7).map(lag=>{
    const hits=pairSeries(xValues,yValues,lag);
    return {lag, n:hits.length, r:hits.length>=3?regression(hits)?.r:null};
  });
  const corr=panel("Zusammenhänge",null,
    el("div","toolbar",
      select("X-Achse",metricOptions(numericList),xKey,key=>{state.correlationX=key;render();}),
      select("Y-Achse",metricOptions(numericList),yKey,key=>{state.correlationY=key;render();}),
      select("Versatz Y gegenüber X",lags.map(({lag})=>[lag,`${lag>0?"+":""}${lag} Tage`]),state.lag,key=>{state.lag=Number(key);render();})),
    scatterChart(pairs, pairs.length>=3?fit:null,xDef,yDef),
    miniGrid([["Pearson r",statNumber(pairs.length>=3?fit?.r:null)],["R²",statNumber(pairs.length>=3?fit?.r2:null)],
      ["Steigung",statNumber(pairs.length>=3?fit?.slope:null)],["Messpaare",String(pairs.length)]]),
    el("p","footnote","Positiver Versatz vergleicht X mit späteren Y-Werten. Pearson r misst den linearen Zusammenhang. Eine Korrelation zeigt keine Ursache."),
    el("details","footnote",el("summary","","Alle Zeitversätze und Rechenweg"),
      el("p","","Pearson r = Σ((x − x̄)(y − ȳ)) / √(Σ(x − x̄)² × Σ(y − ȳ)²). Mindestens drei Paare mit Streuung in beiden Reihen sind erforderlich."),
      table(["Versatz","Paare","Pearson r"],lags.map(({lag,n,r})=>[button(`${lag>0?"+":""}${lag} Tage`,()=>{state.lag=lag;render();}),String(n),statNumber(r)]))));
  return el("div","stack",rangeControls(),summary,el("div","panel-grid equal",comparison,pattern),corr,estimatePanel());
}

function estimatePanel() {
  const fields=[["duration","Schlafdauer (min)"],["latency","Zeit bis stabiler Schlaf (min)"],["sound","Stabiler Schlaf (min)"],
    ["restlessness","Unruhe (min)"],["interruptions","Unterbrechungen (min)"],["awakenings","Vollständiges Erwachen (Anzahl)"]];
  const result=el("div","");
  function show() {
    const outcome=sleepEstimate(state.estimate);
    if (!outcome) {
      result.replaceChildren(small("Für die Schätzung werden sechs gültige Eingaben benötigt."));
      return;
    }
    result.replaceChildren(miniGrid([["Geschätzter Score",`${outcome.rounded} / 100`],["Vor Rundung",statNumber(outcome.value)]]),
      el("div","breakdown",outcome.components.map(item=>{
        const bar=el("span","");
        bar.style.setProperty("--width",`${item.score}%`);
        return el("div","breakdown-row",el("span","",`${item.name} (${100*item.weight} %)`),el("span","bar",bar),
          el("span","nowrap",`${formatNumber(item.points)} Pkt.`));
      })));
  }
  const inputs=fields.map(([key,label])=>{
    const input=el("input","");
    input.type="number";
    input.min="0";
    input.step=key==="awakenings"?"1":"any";
    input.value=state.estimate[key] ?? "";
    input.addEventListener("input",()=>{state.estimate[key]=input.value===""?null:input.valueAsNumber;show();});
    return el("label","",label,input);
  });
  show();
  return panel("Sleep Score berechnen","Näherungsformel aus dem GymProgress-Projekt",
    miniGrid([["Erfasster Score am gewählten Tag",valueText("sleep_score")]]),
    el("div","form-grid",inputs),
    el("div","toolbar",button("Schlafdauer vom Tag übernehmen",()=>{
      state.estimate.duration=measured("sleep_duration_minutes");render();
    }),button("Beispiel einsetzen",()=>{
      state.estimate={duration:450,latency:15,sound:160,restlessness:18,interruptions:5,awakenings:1};render();
    }),button("Eingaben leeren",()=>{state.estimate={};render();})),
    el("div","legend"),result,
    el("details","footnote",el("summary","","Teilformeln und Anforderungen"),
      el("p","","Jeder Teilwert wird auf 0–100 begrenzt. Ergebnis = 0,60 × D* + 0,10 × L* + 0,15 × SS* + 0,07 × R* + 0,05 × I* + 0,03 × A*."),
      el("p","","D* = D / 480 × 100. L* = 100 − 2 × max(0, L − 10). SS* = SS / (0,35 × D) × 100. R* = 100 − (R/D − 0,02) / 0,13 × 100. I* = 100 − 2I. A* = 105 − 15A."),
      el("p","","Tägliche Summen der Schlafphasen enthalten keine genaue Zeit bis zum stabilen Schlaf und keine getrennten Messungen zu Unruhe, längeren Unterbrechungen oder vollständigem Erwachen. Der Rechner verwendet dafür die eingegebenen Werte.")));
}

function paginate(items,headers,toRow) {
  const size=Math.max(1,Math.ceil(items.length/pageSize));
  state.page=Math.max(0,Math.min(size-1,state.page));
  const start=state.page*pageSize;
  const prev=button("Zurück",()=>{state.page--;updateRawTable();});
  const next=button("Weiter",()=>{state.page++;updateRawTable();});
  prev.disabled=state.page<=0;
  next.disabled=state.page>=size-1;
  return el("div","",items.length?table(headers,items.slice(start,start+pageSize).map(toRow)):small("Keine passenden Einträge."),
    el("div","pagination",prev,small(`Seite ${state.page+1} / ${size} | ${items.length} Einträge`),next));
}

function openEditor(record) {
  if (!state.profile?.canWrite) {
    move("settings");
    return;
  }
  recordDialog({profile:state.profile,record,day:state.day,knownRecords:state.source.data,onFinish:refresh});
}

function newRecordButton() {
  return button("API-Wert hinzufügen",()=>openEditor());
}

function entryAction(entry) {
  if (entry.source==="derived") return small("Berechnet");
  return el("div","toolbar",entry.records?.map(record=>calculatedRecord(record)?
    small("Berechnet"):button("Bearbeiten",()=>openEditor(record))) ?? []);
}

function matching(...fields) {
  const text=state.search.trim().toLocaleLowerCase("de");
  return !text || fields.some(field=>String(field??"").toLocaleLowerCase("de").includes(text));
}

function updateRawTable() {
  const output=$("raw-results");
  if (!output) return;
  const time=interval(), rows=[];
  for (const [date,day] of [...state.model.dates].sort(([a],[b])=>b.localeCompare(a))) {
    const outsideRange=!time || date<time.from || date>time.to;
    if (state.rawView==="day"?date!==state.day:outsideRange) continue;
    const order=id=>primary.includes(id)?primary.indexOf(id):primary.length;
    for (const [id,entry] of [...day].sort(([a],[b])=>order(a)-order(b)||def(a).label.localeCompare(def(b).label,"de"))) {
      const definition=def(id);
      if (entry.source==="derived") {
        if (matching(date,id,definition.label,entry.value)) rows.push({date,entry,definition,id,value:entry.value});
      } else {
        for (const record of entry.records) {
          if (matching(date,id,definition.label,record.value,record.source,record.namespace,record.metric)) {
            rows.push({date,entry,definition,id,value:record.value,record});
          }
        }
      }
    }
  }
  output.replaceChildren(paginate(rows,["Datum","Messwert","Wert","Aktion"],({date,entry,definition,id,value,record})=>[
    compactDay(date),state.model.metrics.has(id)?button(definition.label,()=>openMetric(id)):definition.label,
    el("div","",el("div","wrap",formatValue(value,definition)),
      record?el("details","footnote",el("summary","","API-Details"),small(`${record.namespace} / ${record.metric}`),
        small([record.source,record.updated_at].filter(Boolean).join(" | ")),
        record.rawValue!==undefined?small(`API-Rohwert ${record.rawValue}`):null):null,
      !record&&definition.method?el("details","footnote",el("summary","","Formel"),definition.method):null),
    record?(calculatedRecord(record)?small("Berechnet"):
      button("Bearbeiten",()=>openEditor(record))):small(labels[entry.source])
  ]));
}

function dataView() {
  const sections=el("nav","tabs",[["original","Originalwerte"],["quick","Schnelleingabe"]].map(([key,label])=>{
    const tab=button(label,()=>{
      state.dataView=key;
      if (key==="quick"&&!state.daySet) {
        state.day=state.today;
        state.daySet=true;
      }
      render();
    },{active:state.dataView===key});
    tab.setAttribute("aria-pressed",String(state.dataView===key));
    return tab;
  }));
  sections.setAttribute("aria-label","API-Datenansicht");
  if (state.dataView==="quick") {
    const day=state.day;
    if (!state.quickDrafts.has(day)) state.quickDrafts.set(day,{edits:new Map(),saving:false,message:""});
    const form=quickEntryForm({day,profile:state.profile,
      records:(state.source.data??[]).filter(record=>record.date===day),
      goal:weightGoalAt(state.model,day),calorieGoal:calorieGoalAt(state.model,day),weight:measured("weight_kg",day),
      draft:state.quickDrafts.get(day),ready:state.source.state==="ok",
      onSaved:refresh,onRender:render,onSettings:()=>move("settings")});
    return el("div","stack",sections,panel("Manuelle Tageswerte",dayText(day),form));
  }
  const tabs=el("div","tabs",[["day","Gewählter Tag"],["range","Zeitraum"]]
    .map(([key,label])=>button(label,()=>{state.rawView=key;state.page=0;state.search="";render();},
      {active:state.rawView===key})));
  const search=el("input","");
  search.type="search";
  search.placeholder="Messwert, Datenbereich …";
  search.value=state.search;
  search.setAttribute("aria-label","Daten durchsuchen");
  search.addEventListener("input",()=>{state.search=search.value;state.page=0;updateRawTable();});
  const result=el("div","");
  result.id="raw-results";
  const api=state.source;
  const sources=panel("Verbindung",state.profile?.baseUrl,small(api.state==="ok"?
    `${api.data.length} Einträge | zuletzt abgerufen ${new Date(api.checkedAt).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})} Uhr`:api.message??"Wird geladen."));
  return el("div","stack",sections,state.rawView==="range"?rangeControls():null,
    panel("Originalwerte",state.rawView==="day"?dayText(state.day):null,tabs,el("div","legend"),
      el("div","data-controls",search,newRecordButton()),
      result),sources);
}

function status() {
  const item=state.source;
  $("source-status").replaceChildren(el("div",`source-line ${item.state}`,el("strong","","API"),
    el("span","",item.state==="ok"?"Verbunden":item.state==="loading"?"Lädt …":item.data?"Letzter Abruf":"Offline")));
  const notices=item.state==="error"?[el("p","",`API: ${item.message}${item.data?" Die letzte geladene Ansicht bleibt sichtbar.":""}`)]:[];
  $("notice").className=notices.length?"notice":"";
  $("notice").replaceChildren(...notices);
}

function render() {
  status();
  $("heading").textContent=names[state.view];
  $("heading-date").textContent=dayText(state.day);
  $("selected-day").value=state.day;
  for (const node of $("navigation").querySelectorAll("button")) {
    if (node.dataset.view===state.view) node.setAttribute("aria-current","page");
    else node.removeAttribute("aria-current");
  }
  const content=$("content");
  clearCharts(content);
  if (state.view==="settings") {
    content.replaceChildren(settingsPanel(state.profile??{},async profile=>{
      state.profile=profile;
      state.daySet=false;
      state.quickDrafts.clear();
      state.source={state:"loading"};
      state.model=buildModel();
      move("overview");
      await refresh();
    }));
    return;
  }
  if (!state.model.metrics.size && state.source.state==="loading") {
    content.replaceChildren(el("p","loading","GymProgress-Daten werden geladen."));
    return;
  }
  const views={overview,metrics:metricView,math:mathView,data:dataView};
  content.replaceChildren(views[state.view]());
  if (state.view==="data") updateRawTable();
}

function merge() {
  state.model=buildModel(state.source.data);
  if (!state.daySet) {
    const candidates=[...state.model.dates.entries()]
      .filter(([day,values])=>day<=state.today&&[...values.values()].some(item=>item.source==="api"))
      .map(([day])=>day).sort();
    state.day=candidates.at(-1)??state.today;
  }
}

let latestRequest=0;
async function refresh() {
  const requestId=++latestRequest;
  $("refresh").disabled=true;
  state.source={...state.source,state:"loading"};
  if(state.view!=="settings")render();
  try {
    const profile=state.profile??await host("settings");
    if(requestId!==latestRequest)return;
    state.profile=profile;
    const today=await host("today");
    const data=await loadRecords(profile,today);
    if(requestId!==latestRequest)return;
    state.today=today;
    state.source={state:"ok",data,checkedAt:new Date().toISOString()};
  } catch(error) {
    if(requestId!==latestRequest)return;
    state.source={...state.source,state:"error",message:error.message};
  } finally {
    if(requestId===latestRequest) {
      $("refresh").disabled=false;
      merge();
      if(state.view!=="settings")render();
      else status();
    }
  }
}

$("navigation").addEventListener("click",event=>{
  const node=event.target.closest("button[data-view]");
  if (node) move(node.dataset.view);
});
$("refresh").addEventListener("click",refresh);
$("selected-day").addEventListener("change",event=>chooseDay(event.target.value));
if(mobile) document.body.classList.add("mobile-shell");
else setInterval(()=>fetch("heartbeat",{cache:"no-store"}).catch(()=>{}),60000);
setInterval(()=>{
  const entering=state.view==="data"&&state.dataView==="quick";
  if(document.visibilityState==="visible"&&state.view!=="settings"&&!entering&&!document.querySelector("dialog[open]"))refresh();
},5*60000);
refresh();
