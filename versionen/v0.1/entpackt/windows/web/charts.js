import {dayLabel, formatNumber, formatValue, numeric} from "./metrics.js";

const palette={grid:"#30343c", subtle:"#969fab", text:"#edf0f5", panel:"#20242a", highlight:"#c8f587"};
const active=new Map();
const observer=new ResizeObserver(entries=>entries.forEach(e=>active.get(e.target)?.()));

export function clearCharts(root) {
  for (const canvas of root.querySelectorAll("canvas")) {
    observer.unobserve(canvas);
    active.delete(canvas);
  }
}

function element(tag, className, text) {
  const node=document.createElement(tag);
  if (className) node.className=className;
  if (text!==undefined) node.textContent=text;
  return node;
}

function canvasFrame(label, height, draw, tooltip, onPick) {
  const frame=element("div","chart-frame");
  const canvas=element("canvas");
  canvas.style.height=`${height}px`;
  canvas.setAttribute("role","img");
  canvas.setAttribute("aria-label",label);
  const note=element("div","chart-note");
  note.hidden=true;
  frame.append(canvas,note);
  let hover=null, hits=[];
  function paint() {
    const width=canvas.clientWidth;
    if (!width) return;
    const dpr=Math.min(2,window.devicePixelRatio || 1);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    const c=canvas.getContext("2d");
    c.scale(dpr,dpr);
    c.lineWidth=1;
    c.font="11px system-ui";
    hits=draw(c,width,height,hover) || [];
  }
  function closest(event) {
    const rect=canvas.getBoundingClientRect();
    const x=event.clientX-rect.left, y=event.clientY-rect.top;
    return hits.reduce((best,item)=>{
      const distance=Math.hypot(item.x-x,item.y==null?0:item.y-y);
      return distance<best.distance ? {item,distance} : best;
    },{item:null,distance:Infinity});
  }
  if (tooltip) canvas.addEventListener("pointermove",event=>{
    const {item,distance}=closest(event);
    hover=distance<=26?item.id:null;
    note.hidden=hover===null;
    if (hover!==null) note.textContent=tooltip(item);
    paint();
  });
  canvas.addEventListener("pointerleave",()=>{hover=null; note.hidden=true; paint();});
  if (onPick) canvas.addEventListener("click",event=>{
    const {item,distance}=closest(event);
    if (item && distance<=26) onPick(item);
  });
  active.set(canvas,paint);
  observer.observe(canvas);
  return frame;
}

function domain(values, zero=false) {
  let low=Math.min(...values,...(zero?[0]:[])), high=Math.max(...values,...(zero?[0]:[]));
  if (low===0 && high===0) return [0,1];
  const span=(high-low) || Math.max(1,Math.abs(high)*.1);
  low=low>=0?Math.max(0,low-span*.10):low-span*.10;
  high=high<=0?Math.min(0,high+span*.10):high+span*.10;
  return [low,high];
}

function line(c,x1,y1,x2,y2,color,width=1) {
  c.strokeStyle=color;
  c.lineWidth=width;
  c.beginPath();
  c.moveTo(x1,y1);
  c.lineTo(x2,y2);
  c.stroke();
}

function axes(c,w,h,values,zero=false) {
  const [low,high]=domain(values,zero);
  const quantum=10**Math.floor(Math.log10((high-low)/4));
  const target=(high-low)/(4*quantum);
  const tick=([1,2,2.5,5,10].find(step=>step>=target)??10)*quantum;
  const bounded=[Math.floor(low/tick)*tick,Math.ceil(high/tick)*tick];
  const left=50,right=w-13, top=12,bottom=h-28;
  const y=v=>bottom-(v-bounded[0])/(bounded[1]-bounded[0])*(bottom-top);
  c.fillStyle=palette.subtle;
  c.textAlign="right";
  const count=Math.round((bounded[1]-bounded[0])/tick);
  const digits=Math.min(5,Math.max(0,Math.ceil(-Math.log10(tick))+(Number.isInteger(tick/quantum)?0:1)));
  for (let i=0;i<=count;i++) {
    const val=bounded[0]+i*tick;
    const height=y(val);
    line(c,left,height,right,height,palette.grid);
    c.fillText(formatNumber(Math.abs(val)<tick/100?0:val,digits),left-7,height+4);
  }
  return {left,right,top,bottom,y,min:bounded[0],max:bounded[1]};
}

function dateTicks(c,points,left,right,bottom) {
  c.fillStyle=palette.subtle;
  const tickCount=Math.min(Math.max(2,Math.floor((right-left)/78)),points.length);
  for (let i=0;i<tickCount;i++) {
    const index=Math.round(i*(points.length-1)/Math.max(1,tickCount-1));
    c.textAlign=i===0?"left":i===tickCount-1?"right":"center";
    const x=points.length===1?left:left+(right-left)*index/(points.length-1);
    c.fillText(dayLabel(points[index].date),x,bottom+19);
  }
}

export function trendChart(lines,{definition,height=230,bars=false,spark=false,onPick}={}) {
  const points=lines[0]?.points ?? [];
  const values=lines.flatMap(item=>item.points.map(p=>p.value).filter(numeric));
  if (!values.length) return element("p","chart-empty","Für diesen Zeitraum fehlen Zahlenwerte.");
  return canvasFrame(definition?.label ?? "Zeitreihe",height,(c,w,h,hover)=>{
    const a=spark?{left:2,right:w-2,top:3,bottom:h-3,y:(v)=>{
      const [lo,hi]=domain(values);
      return h-3-(v-lo)/(hi-lo)*(h-6);
    }}:axes(c,w,h,values,bars);
    const x=i=>points.length===1?(a.left+a.right)/2:a.left+(a.right-a.left)*i/(points.length-1);
    if (!spark) dateTicks(c,points,a.left,a.right,a.bottom);
    const hits=points.map((p,i)=>({id:i,x:x(i),date:p.date,value:p.value,point:p}));
    if (hover!==null && !spark) line(c,x(hover),a.top,x(hover),a.bottom,"#677361");
    for (const [index,entry] of lines.entries()) {
      let previous=null;
      for (const [i,p] of entry.points.entries()) {
        if (!numeric(p.value)) {previous=null; continue;}
        const xp=x(i),yp=a.y(p.value);
        c.fillStyle=entry.color;
        if (bars && index===0) {
          const width=Math.max(1,Math.min(22,(a.right-a.left)/Math.max(1,points.length)*.7));
          const origin=a.y(0);
          c.globalAlpha=i===hover?1:.75;
          c.fillRect(xp-width/2,Math.min(yp,origin),width,Math.max(1,Math.abs(yp-origin)));
          c.globalAlpha=1;
        } else {
          if (previous) line(c,previous.x,previous.y,xp,yp,entry.color,spark?1.5:2);
          if (!spark && (points.length<70 || hover===i) || !previous) {
            c.beginPath(); c.arc(xp,yp,hover===i?4:1.9,0,2*Math.PI); c.fill();
          }
        }
        previous={x:xp,y:yp};
      }
    }
    return hits;
  },spark?null:item=>{
    const fields=lines.map(entry=>[entry.name,entry.points[item.id]?.value])
      .filter(([,value])=>numeric(value)).map(([name,value])=>`${name} ${formatValue(value,definition)}`);
    if (numeric(item.point.count)) fields.push(`${item.point.count}/${item.point.expected} Tage`);
    return `${dayLabel(item.date,{day:"numeric",month:"short",year:"numeric"})}  |  ${fields.join("  |  ") || "Messlücke"}`;
  },onPick);
}

export function histogramChart(bins,color,unit="") {
  if (!bins.length) return element("p","chart-empty","Keine Zahlenwerte für die Verteilung.");
  return canvasFrame("Histogramm der Messwerte",180,(c,w,h,hover)=>{
    const a=axes(c,w,h,bins.map(bin=>bin.count),true);
    const width=(a.right-a.left)/bins.length;
    for (const [i,bin] of bins.entries()) {
      c.fillStyle=color;
      c.globalAlpha=i===hover?1:.68;
      const y=a.y(bin.count);
      c.fillRect(a.left+i*width+2,y,Math.max(1,width-4),a.bottom-y);
      c.globalAlpha=1;
    }
    c.fillStyle=palette.subtle;
    c.textAlign="left"; c.fillText(formatNumber(bins[0].low),a.left,a.bottom+18);
    c.textAlign="right"; c.fillText(formatNumber(bins.at(-1).high),a.right,a.bottom+18);
    return bins.map((bin,i)=>({id:i,x:a.left+(i+.5)*width,bin}));
  },({bin})=>`${formatNumber(bin.low)} bis ${formatNumber(bin.high)} ${unit} | ${bin.count} Messwerte`);
}

export function scatterChart(pairs, fit, xDef, yDef) {
  if (!pairs.length) return element("p","chart-empty","Keine passenden Messpaare für diese Auswahl.");
  return canvasFrame(`${xDef.label} und ${yDef.label}`,225,(c,w,h,hover)=>{
    const a=axes(c,w,h,pairs.map(p=>p.y));
    const [lo,hi]=domain(pairs.map(p=>p.x));
    const x=v=>a.left+(v-lo)/(hi-lo)*(a.right-a.left);
    c.fillStyle=palette.subtle;
    c.textAlign="center";
    for(let i=0;i<=4;i++) {
      const value=lo+(hi-lo)*i/4;
      c.fillText(formatNumber(value,1),x(value),a.bottom+18);
    }
    if (fit) {
      c.save(); c.beginPath(); c.rect(a.left,a.top,a.right-a.left,a.bottom-a.top); c.clip();
      line(c,x(lo),a.y(fit.intercept+fit.slope*lo),x(hi),a.y(fit.intercept+fit.slope*hi),"#f4bb6c",1.5);
      c.restore();
    }
    return pairs.map((p,i)=>{
      const xp=x(p.x),yp=a.y(p.y);
      c.globalAlpha=i===hover?1:.63;
      c.fillStyle=palette.highlight;
      c.beginPath(); c.arc(xp,yp,i===hover?4:2.8,0,2*Math.PI); c.fill();
      c.globalAlpha=1;
      return {id:i,x:xp,y:yp,point:p};
    });
  },({point})=>`${dayLabel(point.date)} / ${dayLabel(point.dateB)} | ${formatValue(point.x,xDef)} × ${formatValue(point.y,yDef)}`);
}

export function stackedStages(days, stages, onPick) {
  const complete=days.filter(day=>day.values.every(value=>numeric(value)&&value>=0));
  if (!complete.length) return element("p","chart-empty","Für den Zeitraum gibt es keinen Tag mit vier erfassten Phasenwerten.");
  return canvasFrame("Schlaf- und Wachphasen im Zeitverlauf",215,(c,w,h,hover)=>{
    const total=day=>day.values.reduce((sum,value)=>sum+value,0);
    const a=axes(c,w,h,complete.map(total),true);
    const x=i=>days.length===1?(a.left+a.right)/2:a.left+(a.right-a.left)*i/(days.length-1);
    const width=Math.max(1,Math.min(25,(a.right-a.left)/Math.max(1,days.length)*.76));
    dateTicks(c,days,a.left,a.right,a.bottom);
    return days.map((day,i)=>{
      let accumulated=0;
      if (day.values.every(value=>numeric(value)&&value>=0)) {
        c.globalAlpha=i===hover?1:.85;
        for (const [j,value] of day.values.entries()) {
          c.fillStyle=stages[j].color;
          c.fillRect(x(i)-width/2,a.y(accumulated+value),width,a.y(accumulated)-a.y(accumulated+value));
          accumulated+=value;
        }
        c.globalAlpha=1;
      }
      return {id:i,x:x(i),date:day.date,day};
    });
  },({day})=>`${dayLabel(day.date)} | ${day.values.map((value,i)=>`${stages[i].name} ${formatValue(value,{unit:"min"})}`).join(" | ")}`,onPick);
}

export function comparisonChart(rows,label,unit="") {
  const values=rows.map(row=>row.value).filter(numeric);
  if (!values.length) return element("p","chart-empty","Keine Zahlenwerte für diesen Vergleich.");
  return canvasFrame(label,178,(c,w,h,hover)=>{
    const a=axes(c,w,h,values,true);
    const width=(a.right-a.left)/rows.length;
    return rows.map((row,i)=>{
      const x=a.left+(i+.5)*width;
      if (numeric(row.value)) {
        const y=a.y(row.value), zero=a.y(0), b=Math.min(42,width*.62);
        c.fillStyle=row.color ?? palette.highlight;
        c.globalAlpha=hover===i?1:.76;
        c.fillRect(x-b/2,Math.min(y,zero),b,Math.max(1,Math.abs(zero-y)));
        c.globalAlpha=1;
      }
      c.fillStyle=palette.subtle;
      c.textAlign="center";
      c.fillText(row.label,x,a.bottom+18);
      return {id:i,x,row};
    });
  },({row})=>`${row.label} | ${formatValue(row.value,{unit})} | ${row.count} Messwerte`);
}

export function sleepRing(stages, duration) {
  const present=stages.filter(s=>numeric(s.value)&&s.value>=0);
  const total=present.reduce((s,p)=>s+p.value,0);
  return canvasFrame("Anteile gemessener Schlaf- und Wachphasen",184,(c,w,h)=>{
    const x=w/2,y=h/2,r=72;
    c.lineCap="butt";
    c.lineWidth=12;
    c.strokeStyle=palette.grid;
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.stroke();
    let angle=-Math.PI/2;
    for (const s of present) {
      if (!s.value || !total) continue;
      const size=2*Math.PI*s.value/total;
      c.strokeStyle=s.color;
      const gap=present.filter(stage=>stage.value>0).length===1?0:Math.min(.035,size/3);
      c.beginPath(); c.arc(x,y,r,angle+gap,angle+size-gap); c.stroke();
      angle+=size;
    }
    c.fillStyle=palette.text;
    c.font="600 23px system-ui";
    c.textAlign="center";
    const rounded=Math.round(duration);
    c.fillText(numeric(duration)?`${Math.floor(rounded/60)}h ${String(rounded%60).padStart(2,"0")}m`:"–",x,y+1);
    c.fillStyle=palette.subtle;
    c.font="11px system-ui";
    c.fillText("Schlafdauer",x,y+20);
  });
}
