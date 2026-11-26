import {daysBetween, iso, numeric, shift, stamp} from "./metrics.js";

export function series(model, metric, from, to) {
  return Array.from({length:Math.max(0,daysBetween(from,to))}, (_,i) => {
    const date = iso(stamp(from)+i);
    const sample = model.dates.get(date)?.get(metric);
    return {date, value:numeric(sample?.value) ? sample.value : null};
  });
}

export const mean = values => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const index = (sorted.length-1)*q;
  const lower = Math.floor(index);
  return sorted[lower]+(sorted[Math.ceil(index)]-sorted[lower])*(index-lower);
}

export function regression(pairs) {
  if (pairs.length < 2) return null;
  const averageX = mean(pairs.map(point=>point.x)), averageY = mean(pairs.map(point=>point.y));
  let xx = 0, yy = 0, xy = 0;
  for (const {x,y} of pairs) {
    xx += (x-averageX)**2;
    yy += (y-averageY)**2;
    xy += (x-averageX)*(y-averageY);
  }
  if (!xx) return null;
  const slope = xy/xx;
  const r = yy ? Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))) : null;
  return {slope, intercept:averageY-slope*averageX, r, r2:r === null ? null : r*r, n:pairs.length};
}

export function detailedStats(points) {
  const measured = points.filter(point=>numeric(point.value));
  const values = measured.map(point=>point.value).sort((a,b)=>a-b);
  if (!values.length) return {n:0, expected:points.length};
  const avg = mean(values), q1 = quantile(values,.25), q3 = quantile(values,.75);
  const first = measured[0], last = measured.at(-1);
  const variance = values.length < 2 ? null : values.reduce((sum,n)=>sum+(n-avg)**2,0)/(values.length-1);
  const iqr = q3-q1;
  const trend = regression(measured.map(point=>({x:stamp(point.date)-stamp(first.date),y:point.value})));
  return {n:values.length, expected:points.length, sum:values.reduce((sum,n)=>sum+n,0), avg, median:quantile(values,.5),
    q1,q3,p10:quantile(values,.1),p90:quantile(values,.9),iqr,variance,sd:variance===null?null:Math.sqrt(variance),
    min:values[0],max:values.at(-1),first,last,delta:values.length>1?last.value-first.value:null,
    slope:trend?.slope ?? null,r2:trend?.r2 ?? null,
    outliers:measured.filter(point=>point.value<q1-1.5*iqr || point.value>q3+1.5*iqr)};
}

export function moving(points,size) {
  return points.map((point,index)=>{
    const window = points.slice(Math.max(0,index-size+1),index+1).map(p=>p.value).filter(numeric);
    return {...point,value:index>=size-1 && window.length>=Math.ceil(size/2)?mean(window):null};
  });
}

export function buckets(points, mode, additive=false) {
  const windows = new Map();
  for (const point of points) {
    const key = mode === "month" ? `${point.date.slice(0,7)}-01`
      : shift(point.date,-((stamp(point.date)+3)%7));
    if (!windows.has(key)) windows.set(key,[]);
    windows.get(key).push(point);
  }
  return [...windows].map(([date,window])=>{
    const data=window.map(point=>point.value).filter(numeric);
    const value = !data.length ? null : additive ? data.reduce((a,b)=>a+b,0) : mean(data);
    return {date,value,count:data.length,expected:window.length};
  });
}

export function histogram(points) {
  const data = points.map(p=>p.value).filter(numeric).sort((a,b)=>a-b);
  if (!data.length) return [];
  const min=data[0],max=data.at(-1);
  if (min===max) return [{low:min,high:max,count:data.length}];
  const width=2*(quantile(data,.75)-quantile(data,.25))/Math.cbrt(data.length);
  const count=Math.max(3,Math.min(20,width>0?Math.ceil((max-min)/width):Math.ceil(Math.sqrt(data.length))));
  const step=(max-min)/count;
  const bins=Array.from({length:count},(_,i)=>({low:min+i*step,high:min+(i+1)*step,count:0}));
  for (const value of data) bins[Math.min(count-1,Math.floor((value-min)/step))].count++;
  return bins;
}

export function pairSeries(a,b,lag=0) {
  const values=new Map(b.map(p=>[p.date,p.value]));
  return a.flatMap(p=>{
    const dateB=shift(p.date,lag), y=values.get(dateB);
    return numeric(p.value)&&numeric(y)?[{x:p.value,y,date:p.date,dateB}]:[];
  });
}

export function sleepEstimate({duration,latency,sound,restlessness,interruptions,awakenings}) {
  const inputs=[duration,latency,sound,restlessness,interruptions,awakenings];
  if (!inputs.every(v=>numeric(v)&&v>=0) || duration<=0 || sound>duration ||
      restlessness>duration || interruptions>duration || !Number.isInteger(awakenings)) return null;
  const clamp=n=>Math.max(0,Math.min(100,n));
  const components=[
    ["Schlafdauer",.6,clamp(duration/480*100)],
    ["Zeit bis stabiler Schlaf",.1,clamp(100-2*Math.max(0,latency-10))],
    ["Stabiler Schlaf",.15,clamp(sound/(.35*duration)*100)],
    ["Unruhe",.07,clamp(100-(restlessness/duration-.02)/.13*100)],
    ["Unterbrechungen",.05,clamp(100-2*interruptions)],
    ["Vollständiges Erwachen",.03,clamp(105-15*awakenings)],
  ].map(([name,weight,score])=>({name,weight,score,points:weight*score}));
  const value=components.reduce((sum,component)=>sum+component.points,0);
  return {value, rounded:Math.round(value), components};
}
