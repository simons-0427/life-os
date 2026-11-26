import {canDelete, editRecord, host, jsonDefaults, mobile} from "./connector.js";
import {definitions, formatValue, parseWeightGoal, shift, weightDeviation, weightGoalText, weightGoalValue} from "./metrics.js";

function el(tag,text="",className="") {
  const node=document.createElement(tag);
  node.textContent=text;
  node.className=className;
  return node;
}

function action(label,handler,className="control") {
  const button=el("button",label,className);
  button.type="button";
  button.addEventListener("click",handler);
  return button;
}

function input(form,label,name,value="",type="text") {
  const wrap=el("label",label);
  const element=el("input");
  element.type=type;
  element.name=name;
  element.value=value;
  element.autocomplete=type==="password"?"new-password":"off";
  wrap.append(element);
  form.append(wrap);
  return element;
}

function select(form,label,name,value,options) {
  const wrap=el("label",label);
  const node=el("select");
  node.name=name;
  for (const [key,title] of options) {
    const option=el("option",title);
    option.value=key;
    node.append(option);
  }
  node.value=value;
  wrap.append(node);
  form.append(wrap);
  return node;
}

const routeLabels={
  readPath:"Lesepfad",readContainer:"Pfad zur Liste im JSON",fromParam:"Abfrageparameter für Start",
  toParam:"Abfrageparameter für Ende",dateField:"Feld für Datum",namespaceField:"Feld für Datenbereich",
  metricField:"Feld für Messwertname",valueField:"Feld für Wert",idField:"Feld für Datensatz-ID",
  versionField:"Feld für Version",defaultNamespace:"Datenbereich falls kein Feld",
  createPath:"Pfad zum Anlegen",createMethod:"HTTP-Methode zum Anlegen",updatePath:"Pfad zum Ändern",
  updateMethod:"HTTP-Methode zum Ändern",deletePath:"Pfad zum Entfernen",deleteMethod:"HTTP-Methode zum Entfernen",
  writeContainer:"Umschließendes JSON-Feld beim Schreiben",
};
const methods=["POST","PATCH","PUT","DELETE"].map(method=>[method,method]);

export function settingsPanel(profile,onSave) {
  const panel=el("section","","panel");
  panel.append(el("h2","API-Verbindung"),el("p","Die URL und Zugangsdaten gelten für dieses Gerät.","footnote"));
  const form=el("form"); 
  const basic=el("div","","form-grid settings-grid");
  const base=input(basic,"API-Basisadresse","baseUrl",profile.baseUrl ?? "","url");
  base.placeholder="https://example.org/api/gymprogress/v1";
  base.required=true;
  const mode=select(basic,"Schnittstelle","protocol",profile.protocol ?? "gymprogress",
    [["gymprogress","GymProgress-kompatibel"],["json","JSON-API mit Feldzuordnung"]]);
  input(basic,"Erstes Abrufdatum","startDate",profile.routes?.startDate ?? shift(new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date()),-365),"date").required=true;
  const read=input(basic,"Leseschlüssel","readToken","","password");
  const write=input(basic,"Schreibschlüssel","writeToken","","password");
  read.placeholder=profile.canRead?"Gespeicherten Schlüssel verwenden":"Optional bei öffentlicher JSON-API";
  write.placeholder=profile.canWrite?"Gespeicherten Schlüssel verwenden":"Schlüssel für Änderungen";
  form.append(basic);
  const advanced=el("details","","configuration");
  advanced.append(el("summary","JSON-Felder und Endpunkte"));
  const fields=el("div","","form-grid");
  input(fields,"Authentifizierungsheader","authHeader",profile.authHeader ?? "Authorization");
  input(fields,"Vorsatz vor dem Schlüssel","authPrefix",profile.authPrefix ?? "Bearer ");
  const routes={...jsonDefaults,...profile.routes};
  for (const [key,label] of Object.entries(routeLabels)) {
    if (key.endsWith("Method")) select(fields,label,key,routes[key],methods);
    else input(fields,label,key,routes[key]);
  }
  advanced.append(el("p","Ein leerer Listenpfad verwendet das gesamte Antwort-Array. Verschachtelte Felder werden mit Punkten angegeben. In Schreibpfaden sind {id}, {date}, {namespace} und {metric} verfügbar.","footnote"),
    el("p","Für öffentliche APIs den Authentifizierungsheader leeren. Ein leerer Löschpfad deaktiviert das Entfernen.","footnote"),fields);
  form.append(advanced);
  const hc=el("label","","check");
  const hcInput=el("input");
  hcInput.type="checkbox";
  hcInput.name="healthUpload";
  hcInput.checked=profile.healthUpload !== false && profile.preset===true || profile.healthUpload===true;
  hc.append(hcInput,"Health Connect für diese Verbindung verwenden");
  hc.title="Health Connect kann bis zu 30 Tage an diese Adresse übertragen.";
  base.addEventListener("input",()=>{if(base.value!==profile.baseUrl)hcInput.checked=false;});
  form.append(hc);
  function showOptions() {
    advanced.hidden=mode.value!=="json";
    hc.hidden=!mobile||mode.value!=="gymprogress";
  }
  mode.addEventListener("change",showOptions);
  showOptions();
  const feedback=el("p","","footnote");
  feedback.setAttribute("role","status");
  const save=el("button","Verbindung speichern und abrufen","refresh");
  save.type="submit";
  const toolbar=el("div","","toolbar configuration");
  toolbar.append(save);
  if (mobile) {
    toolbar.append(action("Health Connect öffnen",()=>host("health").catch(error=>{feedback.textContent=error.message;})));
    if (profile.protocol==="gymprogress"&&(profile.healthUpload||profile.preset)) {
      const pulse=action("Mindestpuls abrufen",async()=>{
        pulse.disabled=true;
        feedback.textContent="Health Connect wird abgefragt …";
        try {
          const count=await host("syncMinimumPulse");
          feedback.textContent=count?`Mindestpuls für ${count} Tage übermittelt.`:"In Health Connect sind für diesen Zeitraum keine Pulsmessungen verfügbar.";
        } catch(error) {
          feedback.textContent=error.message;
        } finally {pulse.disabled=false;}
      });
      toolbar.append(pulse);
    }
  }
  form.append(toolbar,feedback);
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const values=new FormData(form);
    save.disabled=true;
    feedback.textContent="";
    try {
      const updated=await host("saveSettings",{
        baseUrl:values.get("baseUrl"),protocol:values.get("protocol"),
        routes:{...Object.fromEntries(Object.keys(routeLabels).map(key=>[key,values.get(key)])),startDate:values.get("startDate")},
        authHeader:values.get("authHeader"),authPrefix:values.get("authPrefix"),
        healthUpload:mode.value==="gymprogress"&&hcInput.checked,
        ...(read.value?{readToken:read.value}:{}),
        ...(write.value?{writeToken:write.value}:{}),
      });
      feedback.textContent="Verbindung gespeichert.";
      await onSave(updated);
    } catch (error) {feedback.textContent=error.message;}
    finally {save.disabled=false;}
  });
  panel.append(form);
  return panel;
}

const namespaces=["fitness.health","fitness.manual","fitness.gymprogress"];
const manual=new Set(["cycling_km","training","target_phase","current_phase","sleep_score","notes"]);
const trainingChoices=["Im Gym gewesen","Restday","Krank","Geskippt","Urlaub","Homegym"];
const phaseChoices=["Maingaining","Cut","Agressive Cut","Lean Bulk","Bulk","Unsure","Intuitive","Reintroducing"];
const quickFields=[
  {metric:"zielgewicht",label:"Gewichtsziel (kg)",kind:"goal"},
  {metric:"zielkalorien",label:"Kalorienziel (kcal)",kind:"calories"},
  {metric:"cycling_km",label:"Fahrradkilometer",kind:"decimal",max:1000},
  {metric:"sleep_score",label:"Sleep Score",kind:"integer",max:100},
  {metric:"training",label:"Training",choices:trainingChoices},
  {metric:"target_phase",label:"Zielphase",choices:phaseChoices},
  {metric:"current_phase",label:"Aktuelle Phase",choices:phaseChoices},
  {metric:"notes",label:"Sonstiges",kind:"notes"},
];

function quickValue(field,text) {
  const value=text.trim();
  if (field.kind==="goal") {
    const goal=parseWeightGoal(value);
    if (!goal) throw Error("Gib ein Gewichtsziel wie 78 oder 70–72 ein.");
    return weightGoalValue(goal);
  }
  if (field.kind==="calories") {
    const calories=Number(value);
    if (!/^\d+$/.test(value)||!Number.isSafeInteger(calories)||calories<=0) {
      throw Error("Gib ein positives Kalorienziel in ganzen kcal ein.");
    }
    return calories;
  }
  if (field.kind==="notes") {
    if (value.length>1000) throw Error("Sonstiges darf höchstens 1.000 Zeichen enthalten.");
    return value;
  }
  if (!field.kind) return value;
  const format=field.kind==="integer"?/^\d+$/:/^\d+(?:[.,]\d+)?$/;
  const number=Number(value.replace(",","."));
  if (!format.test(value)||!Number.isFinite(number)||number>field.max) {
    const message=field.kind==="integer"?"eine ganze Zahl zwischen 0 und 100":"eine Zahl zwischen 0 und 1.000";
    throw Error(`Für ${field.label} bitte ${message} eingeben.`);
  }
  return number;
}

function versionChanged(original,current) {
  if (!original||!current) return Boolean(original)!==Boolean(current);
  if (original.version!==undefined||current.version!==undefined) return original.version!==current.version;
  return !Object.is(original.value,current.value)||original.updated_at!==current.updated_at||original.id!==current.id;
}

export function quickEntryForm({day,profile,records,goal,calorieGoal,weight,draft,ready,onSaved,onRender,onSettings}) {
  if (!profile?.canWrite) {
    const access=el("div");
    access.append(el("p","Für die Schnelleingabe wird ein Schreibschlüssel benötigt.","footnote"),
      action("API-Einstellungen öffnen",onSettings));
    return access;
  }
  const configured=profile.routes?.defaultNamespace||"records";
  const namespace=profile.protocol==="gymprogress"||records.some(record=>record.namespace==="fitness.manual")
    ?"fitness.manual":configured;
  const goalNamespace=profile.protocol==="gymprogress"?"fitness.gymprogress":configured;
  const fieldNamespace=field=>["goal","calories"].includes(field.kind)?goalNamespace:namespace;
  const current=new Map(quickFields.map(field=>[field.metric,records.find(record=>
    record.namespace===fieldNamespace(field)&&record.metric===field.metric)]));
  const form=el("form","","quick-form");
  form.append(el("p","Speichere mehrere Werte für den gewählten Tag auf einmal. Leere Felder werden übersprungen.","footnote"));
  const fields=el("div","","form-grid quick-grid");
  const controls=new Map();
  const preview=el("span","","quick-goal-hint");
  function updateGoalHint(input) {
    const candidate=parseWeightGoal(input.value);
    const delta=weightDeviation(weight,candidate);
    const origin=goal&&goal.date<day?"Ziel vom Vortag vorausgefüllt.":"";
    preview.textContent=[origin,delta===null?"":`Abweichung ${delta>0?"+":""}${formatValue(delta,{unit:"kg"})}`]
      .filter(Boolean).join(" ")||"Einzelwert oder Zielband eingeben, zum Beispiel 70–72.";
  }
  for (const field of quickFields) {
    const initial=current.get(field.metric);
    const inherited=field.kind==="goal"&&goal?weightGoalText(goal):
      field.kind==="calories"?calorieGoal?.value:undefined;
    const baseline=String(inherited??initial?.value??"");
    const value=draft.edits.get(field.metric)?.text ?? baseline;
    let control;
    if (field.choices) {
      const choices=[...field.choices];
      if (value&&!choices.includes(value)) choices.push(value);
      control=select(fields,field.label,field.metric,value,[["","Auswählen"],...choices.map(choice=>[choice,choice])]);
    } else if (field.kind==="notes") {
      const label=el("label",field.label,"quick-notes");
      control=el("textarea");
      control.name=field.metric;
      control.maxLength=1000;
      control.rows=3;
      control.value=value;
      label.append(control);
      fields.append(label);
    } else if (field.kind==="goal") {
      control=input(fields,field.label,field.metric,value);
      control.parentElement.classList.add("quick-weight-goal");
      control.placeholder="70–72";
      control.parentElement.append(preview);
      preview.id="quick-goal-hint";
      control.setAttribute("aria-describedby",preview.id);
      updateGoalHint(control);
    } else if (field.kind==="calories") {
      control=input(fields,field.label,field.metric,value);
      control.inputMode="numeric";
      control.placeholder="2200";
      if (calorieGoal&&calorieGoal.date<day) {
        const hint=el("span","Ziel vom Vortag vorausgefüllt.","quick-goal-hint");
        hint.id="quick-calorie-goal-hint";
        control.parentElement.append(hint);
        control.setAttribute("aria-describedby",hint.id);
      }
    } else {
      control=input(fields,field.label,field.metric,value);
      control.inputMode=field.kind==="integer"?"numeric":"decimal";
      control.placeholder=field.kind==="integer"?"0–100":"km";
    }
    control.setAttribute("aria-label",field.label);
    controls.set(field.metric,control);
    control.addEventListener("input",()=>{
      const previous=draft.edits.get(field.metric);
      const original=previous?previous.original:initial;
      const text=control.value;
      if (!text.trim()||text===baseline) draft.edits.delete(field.metric);
      else draft.edits.set(field.metric,{text,original});
      if (field.kind==="goal") updateGoalHint(control);
      draft.message="";
      control.removeAttribute("aria-invalid");
      sync();
    });
  }
  const toolbar=el("div","","toolbar");
  const save=el("button","Tageswerte speichern","refresh");
  save.type="submit";
  const reset=action("Entwurf verwerfen",()=>{
    draft.edits.clear();
    draft.message="";
    onRender();
  });
  const status=el("p","","footnote quick-result");
  status.setAttribute("role","status");
  toolbar.append(save,reset);
  form.append(fields,toolbar,status);
  function sync() {
    for (const control of controls.values()) control.disabled=draft.saving;
    save.disabled=draft.saving||!ready||draft.edits.size===0;
    save.textContent=draft.saving?"Speichert …":"Tageswerte speichern";
    reset.hidden=draft.edits.size===0;
    reset.disabled=draft.saving;
    status.textContent=draft.saving?"Tageswerte werden an die API gesendet …":draft.message;
  }
  sync();
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if (save.disabled) return;
    const jobs=[];
    for (const field of quickFields) {
      const entry=draft.edits.get(field.metric);
      if (!entry) continue;
      const control=controls.get(field.metric);
      try {
        const value=quickValue(field,entry.text);
        const latest=current.get(field.metric);
        if (Object.is(latest?.value,value)||(field.kind==="goal"&&goal&&Object.is(weightGoalValue(goal),value))||
          (field.kind==="calories"&&Object.is(calorieGoal?.value,value))) {
          draft.edits.delete(field.metric);
        } else {
          if (versionChanged(entry.original,latest)) throw Error(`${field.label} wurde inzwischen geändert. API-Wert prüfen und den Entwurf verwerfen.`);
          jobs.push({field,record:entry.original??{date:day,namespace:fieldNamespace(field),metric:field.metric},value,update:Boolean(entry.original)});
        }
      } catch(error) {
        draft.message=error.message;
        control.setAttribute("aria-invalid","true");
        sync();
        control.focus();
        return;
      }
    }
    if (!jobs.length) {
      draft.message="Die eingegebenen Werte sind bereits gespeichert.";
      sync();
      return;
    }
    draft.saving=true;
    sync();
    let saved=0;
    const errors=[];
    try {
      for (const {field,record,value,update} of jobs) {
        try {
          await editRecord(profile,update?"update":"create",record,value);
          draft.edits.delete(field.metric);
          saved++;
        } catch(error) {
          errors.push(`${field.label}: ${error.message}`);
        }
      }
      draft.message=[saved===1?"1 Wert gespeichert.":saved>1?`${saved} Werte gespeichert.`:"",
        ...errors].filter(Boolean).join(" ");
      await onSaved();
    } finally {
      draft.saving=false;
      onRender();
    }
  });
  return form;
}

function guessNamespace(key) {
  if (manual.has(key)) return namespaces[1];
  return key.startsWith("ziel")||key.endsWith("_excel")?namespaces[2]:namespaces[0];
}

export function recordDialog({profile,record,day,onFinish,knownRecords=[]}) {
  const dialog=el("dialog","","edit-dialog");
  const operation=record?"update":"create";
  const title=el("h2",record?"API-Wert bearbeiten":"API-Wert hinzufügen");
  const form=el("form");
  const fields=el("div","","form-grid");
  const editDate=input(fields,"Datum","date",record?.date ?? day,"date");
  const ns=input(fields,"Datenbereich","namespace",record?.namespace ?? (profile.protocol==="gymprogress"?
    namespaces[0]:profile.routes?.defaultNamespace ?? "records"));
  const metric=input(fields,"Messwertname in der API","metric",record?.metric ?? "");
  [editDate,ns,metric].forEach(field=>{field.required=true;field.readOnly=Boolean(record);});
  if (!record) {
    const options=new Map(knownRecords.map(row=>[JSON.stringify([row.namespace,row.metric]),row.metric]));
    if (profile.protocol==="gymprogress") {
      for (const key of ["steps","weight_kg","nutrition_kcal","sleep_duration_minutes","resting_heart_rate_bpm",...manual]) {
        options.set(JSON.stringify([guessNamespace(key),key]),definitions[key]?.label??key);
      }
    }
    const picked=select(fields,"Vorhandenes Feld übernehmen","pick","",
      [["","Eigenes Feld"],...[...options].sort((a,b)=>a[1].localeCompare(b[1],"de"))]);
    picked.addEventListener("change",()=>{if(picked.value)[ns.value,metric.value]=JSON.parse(picked.value);});
  }
  const kind=typeof record?.value;
  const type=select(fields,"Datentyp","type",["number","boolean","string"].includes(kind)?kind:"number",
    [["number","Zahl"],["string","Text"],["boolean","Ja / Nein"]]);
  const wrap=el("label","Wert");
  const entry=el("textarea");
  entry.value=record?.value===undefined?"":String(record.value);
  entry.name="value";
  entry.rows=3;
  wrap.append(entry);
  fields.append(wrap);
  const status=el("p","","footnote");
  status.setAttribute("role","status");
  const toolbar=el("div","","toolbar");
  const submit=el("button","In API speichern","refresh");
  submit.type="submit";
  const cancel=action("Schließen",()=>dialog.close());
  toolbar.append(submit,cancel);
  let remove;
  if(record&&canDelete(profile,record)) {
    remove=action("Wert entfernen",async()=>{
      if (remove.dataset.confirm!=="yes") {
        remove.dataset.confirm="yes";
        remove.textContent="Entfernen bestätigen";
        status.textContent=`Der Wert für ${record.date} wird aus der aktiven API-Ansicht entfernt.`;
        return;
      }
      await commit("delete",record);
    },"control danger");
    toolbar.append(remove);
  }
  if(record&&profile.protocol==="gymprogress"&&!record.version) {
    status.textContent="Dieser Server verwendet den bisherigen Schreibendpunkt. Health-Connect-Uploads können diese Änderung überschreiben.";
  }
  async function commit(actionName,target,value) {
    submit.disabled=true;
    cancel.disabled=true;
    if(remove)remove.disabled=true;
    status.textContent="Änderung wird gespeichert …";
    try {
      await editRecord(profile,actionName,target,value);
      dialog.close();
      await onFinish();
    } catch(error) {status.textContent=error.message;}
    finally {
      submit.disabled=false;
      cancel.disabled=false;
      if(remove)remove.disabled=false;
    }
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const raw=entry.value.trim();
    let value=entry.value;
    if (type.value==="number") {
      value=Number(raw.replace(",","."));
      if(!raw||!Number.isFinite(value)) {status.textContent="Gib eine gültige Zahl ein.";return;}
    } else if(type.value==="boolean") {
      if(!/^(ja|nein|true|false)$/i.test(raw)) {status.textContent="Gib Ja oder Nein ein.";return;}
      value=/^(ja|true)$/i.test(raw);
    }
    const target=record ?? {date:editDate.value,namespace:ns.value.trim(),metric:metric.value.trim()};
    if (!target.namespace||!target.metric) {status.textContent="Datenbereich und Messwertname fehlen.";return;}
    await commit(operation,target,value);
  });
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  dialog.addEventListener("cancel",event=>{if(submit.disabled)event.preventDefault();});
  form.append(fields,toolbar,status);
  dialog.append(title,form);
  document.body.append(dialog);
  dialog.showModal();
}
