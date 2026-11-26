import {shift} from "./metrics.js";

const pending=new Map();
let sequence=0;
export const mobile=Boolean(window.LiveOsNative);
window.receiveLiveOs=(id,result)=>{
  const call=pending.get(id);
  if (!call) return;
  pending.delete(id);
  call(result);
};

export const jsonDefaults = {
  readPath:"observations", readContainer:"records", fromParam:"from", toParam:"to",
  dateField:"date", namespaceField:"namespace", metricField:"metric", valueField:"value",
  idField:"id", versionField:"version", defaultNamespace:"records",
  createPath:"observations", createMethod:"POST", updatePath:"observations/{id}", updateMethod:"PATCH",
  deletePath:"observations/{id}", deleteMethod:"DELETE", writeContainer:"",
};

export async function host(action,value={}) {
  let result;
  if (mobile) {
    const id=String(++sequence);
    result=await new Promise((resolve,reject)=>{
      pending.set(id,resolve);
      setTimeout(()=>{if(pending.delete(id))reject(new Error("Die API antwortet nicht rechtzeitig."));},90000);
      window.LiveOsNative.send(id,action,JSON.stringify(value));
    });
  } else {
    const response=await fetch("bridge",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action,value}),cache:"no-store"});
    if(!response.ok)throw new Error("Der lokale Live-OS-Dienst ist nicht erreichbar.");
    result=await response.json();
  }
  if (!result.ok) {
    const error=new Error(result.error);
    error.status=result.status;
    throw error;
  }
  return result.data;
}

const identifier=(text,limit)=>typeof text==="string"&&text.length>0&&text.length<=limit;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const scalar=value=>typeof value==="string"||typeof value==="boolean"||Number.isFinite(value);
const field=(item,path)=>path?path.split(".").reduce((object,key)=>object!=null&&Object.hasOwn(object,key)?object[key]:undefined,item):item;
const ratioFields=new Set(["schlaf_effizienz","tiefschlaf","leichtschlaf","rem","wach"]);
const multiplier=record=>record.namespace==="fitness.gymprogress"&&ratioFields.has(record.metric)?100:1;

function gymRecord(raw) {
  const record={...raw};
  const scale=multiplier(raw);
  if (scale!==1 && typeof raw.value==="number") {
    record.rawValue=raw.value;
    record.value=raw.value*scale;
  }
  return record;
}

function request(profile,role,method,path,query,body) {
  return host("call",{role,method,path,query,body,baseUrl:profile.baseUrl,protocol:profile.protocol});
}

function matches(records) {
  const result=new Map();
  for (const record of records) {
    if (!datePattern.test(record.date)||!Number.isFinite(Date.parse(record.date+"T00:00:00Z"))||
        !identifier(record.namespace,120)||!identifier(record.metric,120)||!scalar(record.value)) {
      throw new Error("Ein API-Eintrag enthält ein ungültiges Datum oder Feld.");
    }
    const key=JSON.stringify([record.date,record.namespace,record.metric]);
    if (result.has(key)) throw new Error("Ein API-Eintrag ist für denselben Tag und Messwert doppelt vorhanden.");
    result.set(key,record);
  }
  return [...result.values()];
}

export async function loadRecords(profile,today) {
  const config={...jsonDefaults,...profile.routes};
  if (profile.protocol==="json") {
    const query=Object.fromEntries([[config.fromParam,config.startDate || shift(today,-365)],[config.toParam,today]].filter(([key])=>key));
    const raw=await request(profile,"read","GET",config.readPath,query);
    const list=field(raw,config.readContainer);
    if (!Array.isArray(list)) throw new Error("Der konfigurierte Listenpfad liefert kein JSON-Array.");
    return matches(list.map(value=>({
      date:String(field(value,config.dateField) ?? "").slice(0,10),
      namespace:String(field(value,config.namespaceField) ?? config.defaultNamespace),
      metric:String(field(value,config.metricField) ?? ""),
      value:field(value,config.valueField), id:field(value,config.idField), version:field(value,config.versionField),
      source:"configured-api",
    })));
  }
  const start=config.startDate || shift(today,-365);
  const ranges=[];
  let cursor=shift(today,2);
  while (cursor>=start) {
    const from=[start,shift(cursor,-366)].sort().at(-1);
    ranges.push([from,cursor]);
    cursor=shift(from,-1);
    if (ranges.length>70) throw new Error("Der konfigurierte Zeitraum ist zu lang.");
  }
  const records=[];
  for (const [from,to] of ranges) {
    const raw=await request(profile,"read","GET","data.php",{from,to});
    if (raw?.schema_version!==1||!Array.isArray(raw.records)||raw.from!==from||raw.to!==to) {
      throw new Error("Die API liefert keine GymProgress-Daten für den angefragten Zeitraum.");
    }
    records.push(...raw.records.map(gymRecord));
  }
  return matches(records);
}

const insertable=/^[A-Za-z0-9_.~-]+$/;
function fillRoute(template,record) {
  return template.replace(/\{(id|date|namespace|metric)\}/g,(_,key)=>{
    const value=String(record[key] ?? "");
    if(!insertable.test(value)) throw new Error(`Für den API-Pfad fehlt ein unterstütztes Feld (${key}).`);
    return value;
  });
}

function property(object,path,value) {
  if(!path) return;
  const keys=path.split(".");
  if (keys.some(key=>!key||["__proto__","constructor","prototype"].includes(key))) {
    throw new Error("Ein konfigurierte Feldpfad ist ungültig.");
  }
  for(const key of keys.slice(0,-1)) object=object[key] ??= {};
  object[keys.at(-1)]=value;
}

export function canDelete(profile,record) {
  return profile.canWrite&&(profile.protocol==="gymprogress"?/^[a-f0-9]{64}$/.test(record?.version ?? ""):
    Boolean(({...jsonDefaults,...profile.routes}).deletePath));
}

async function legacySave(profile,operation,original,record) {
  const day=original.date;
  const data=await request(profile,"read","GET","data.php",{from:day,to:day});
  if(data?.schema_version!==1||data.from!==day||data.to!==day||!Array.isArray(data.records)) {
    throw new Error("Die API hat den aktuellen Datensatz nicht bestätigt.");
  }
  const current=data.records.find(row=>row.namespace===original.namespace&&row.metric===original.metric);
  if(operation==="create"?current:
    !current || current.value!==(original.rawValue ?? original.value) ||
    current.updated_at!==original.updated_at || current.source!==original.source) {
    throw new Error("Der Wert existiert bereits oder hat sich geändert. Lade die Daten neu.");
  }
  if(current?.version) throw new Error("Die API unterstützt jetzt versionierte Änderungen. Lade die Daten neu.");
  const result=await request(profile,"write","POST","ingest.php",undefined,
    {schema_version:1,records:[{...record,source:"live-os"}]});
  if(result?.accepted!==1) throw new Error("Die API hat die Änderung nicht bestätigt.");
}

export async function editRecord(profile,operation,original,value) {
  if (!profile.canWrite) throw new Error("Hinterlege zuerst eine schreibberechtigte API-Verbindung.");
  if (profile.protocol==="gymprogress") {
    const record={date:original.date,namespace:original.namespace,metric:original.metric,
      value:typeof value==="number"?value/multiplier(original):value};
    if(operation==="update"&&!original.version) return legacySave(profile,operation,original,record);
    if(operation==="delete"&&!canDelete(profile,original)) throw new Error("Dieser Server unterstützt das Entfernen noch nicht.");
    let result;
    try {
      result=await request(profile,"write","POST","edit.php",undefined,{
        record,operation:operation==="delete"?"delete":"save",expected:operation==="create"?null:original.version
      });
    } catch(error) {
      if(operation==="create"&&error.status===404) return legacySave(profile,operation,original,record);
      throw error;
    }
    if (!result?.saved) throw new Error("Die API hat die Änderung nicht bestätigt.");
    return;
  }
  const config={...jsonDefaults,...profile.routes};
  const route=config[operation+"Path"];
  if(!route)throw new Error("Diese Aktion ist für den JSON-Adapter nicht konfiguriert.");
  let body;
  if(operation!=="delete") {
    const mapped=Object.create(null);
    property(mapped,config.dateField,original.date);
    property(mapped,config.namespaceField,original.namespace);
    property(mapped,config.metricField,original.metric);
    property(mapped,config.valueField,value);
    if(original.version!==undefined) property(mapped,config.versionField,original.version);
    body=mapped;
    if(config.writeContainer) {
      body=Object.create(null);
      property(body,config.writeContainer,mapped);
    }
  }
  await request(profile,"write",config[operation+"Method"],fillRoute(route,original),undefined,body);
}
