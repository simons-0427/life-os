export const groups = {
  body: {label: "Körper", color: "#f4bb6c"},
  activity: {label: "Aktivität", color: "#c8f587"},
  sleep: {label: "Schlaf", color: "#a6abff"},
  heart: {label: "Herz", color: "#f99ca9"},
  nutrition: {label: "Ernährung", color: "#7ae2cd"},
  journal: {label: "Training & Notizen", color: "#f5c3ed"},
  other: {label: "Weitere Daten", color: "#a4b6c9"},
};

const registry = [
  ["weight_kg","Gewicht","kg","body"],
  ["zielgewicht","Gewichtsziel","kg","body"],
  ["zielgewicht_min","Zielgewicht | Untergrenze","kg","body"],
  ["zielgewicht_max","Zielgewicht | Obergrenze","kg","body"],
  ["weight_deviation","Abweichung vom Gewichtsziel","kg","body",false,"Ohne neues Ziel gilt das bisherige weiter. Die Abweichung beträgt im Zielband null, außerhalb den Abstand zur nächsten Bandgrenze mit Vorzeichen."],
  ["weight_gap_excel","Gewichtsabweichung aus Excel","kg","body"],
  ["steps","Schritte","Schritte","activity",true],
  ["cycling_km","Radstrecke","km","activity",true],
  ["nutrition_kcal","Kalorienaufnahme","kcal","nutrition",true],
  ["zielkalorien","Kalorienziel","kcal","nutrition",true],
  ["calorie_deviation","Abweichung vom Kalorienziel","kcal","nutrition",true,"Kalorienaufnahme minus geplante Kalorien am gleichen Tag. Der Energieverbrauch geht hier nicht ein."],
  ["calorie_gap_excel","Kalorienabweichung aus Excel","kcal","nutrition",true],
  ["sleep_duration_minutes","Schlafdauer","min","sleep"],
  ["sleep_score","Erfasster Sleep Score","/ 100","sleep"],
  ["deep_sleep_minutes","Tiefschlaf","min","sleep"],
  ["light_sleep_minutes","Leichtschlaf","min","sleep"],
  ["rem_sleep_minutes","REM-Schlaf","min","sleep"],
  ["awake_minutes","Wachzeit, erfasst","min","sleep"],
  ["deep_sleep_phases","Tiefschlafphasen","Phasen","sleep"],
  ["light_sleep_phases","Leichtschlafphasen","Phasen","sleep"],
  ["rem_sleep_phases","REM-Phasen","Phasen","sleep"],
  ["awake_phases","Wachphasen","Phasen","sleep"],
  ["recorded_sleep_stages","Schlafphasen zusammen","min","sleep",false,"Tiefschlaf + Leichtschlaf + REM. Alle drei Phasen müssen vorliegen."],
  ["stage_efficiency","Schlafeffizienz","%","sleep",false,"100 × Summe aus Tiefschlaf, Leichtschlaf und REM ÷ dieselbe Summe plus erfasste Wachminuten."],
  ["deep_share","Tiefschlafanteil aus Phasen","%","sleep",false,"100 × Tiefschlaf ÷ Summe der drei Schlafphasen."],
  ["light_share","Leichtschlafanteil aus Phasen","%","sleep",false,"100 × Leichtschlaf ÷ Summe der drei Schlafphasen."],
  ["rem_share","REM-Anteil aus Phasen","%","sleep",false,"100 × REM ÷ Summe der drei Schlafphasen."],
  ["awake_share","Wachanteil aus Phasen","%","sleep",false,"100 × Wachminuten ÷ Summe aus Schlafphasen und Wachminuten."],
  ["wachzeit_min","Wachzeit aus Excel","min","sleep"],
  ["schlaf_effizienz","Schlafeffizienz aus Excel","%","sleep"],
  ["tiefschlaf","Tiefschlafanteil aus Excel","%","sleep"],
  ["leichtschlaf","Leichtschlafanteil aus Excel","%","sleep"],
  ["rem","REM-Anteil aus Excel","%","sleep"],
  ["wach","Wachanteil aus Excel","%","sleep"],
  ["resting_heart_rate_bpm","Ruhepuls","bpm","heart"],
  ["min_heart_rate_bpm","Mindestpuls","bpm","heart",false,"Niedrigster aufgezeichneter Puls des Kalendertags aus Health Connect."],
  ["sleep_heart_rate_bpm","Schlafpuls","bpm","heart"],
  ["heart_rate_gap","Abstand Ruhepuls zu Schlafpuls","bpm","heart",false,"Ruhepuls minus Schlafpuls am gleichen Tag."],
  ["training","Training","","journal"],
  ["target_phase","Geplante Phase","","journal"],
  ["current_phase","Aktuelle Phase","","journal"],
  ["notes","Sonstiges","","journal"],
];
export const definitions = Object.fromEntries(registry.map(([id,label,unit,group,additive,method]) =>
  [id,{id,label,unit,group,additive:!!additive,method}]));
export const numeric = value => typeof value === "number" && Number.isFinite(value);
export const observed = value => value !== null && value !== undefined && value !== "";
const goalPattern=/^(\d+(?:[.,]\d+)?)(?:\s*(?:[-–—]|bis)\s*(\d+(?:[.,]\d+)?))?\s*(?:kg)?$/i;

export function parseWeightGoal(value) {
  if (!numeric(value)&&typeof value!=="string") return null;
  const parts=String(value).trim().match(goalPattern);
  if (!parts) return null;
  const low=Number(parts[1].replace(",","."));
  const high=Number((parts[2]??parts[1]).replace(",","."));
  return numeric(low)&&numeric(high)&&low>0&&high>=low?{low,high}:null;
}

export const weightGoalValue = ({low,high}) => low===high?low:`${low}–${high}`;
export const weightGoalText = goal => String(weightGoalValue(goal)).replaceAll(".",",");
export const weightGoalAt = (model,day) => model.goals.findLast(goal=>goal.date<=day);
export const calorieGoalAt = (model,day) => model.calorieGoals.findLast(goal=>goal.date<=day);

export function weightDeviation(weight,goal) {
  if (!numeric(weight)||!goal) return null;
  const {low,high}=goal;
  return weight<low?weight-low:weight>high?weight-high:0;
}
const knownNamespaces = ["fitness.health", "fitness.manual", "fitness.gymprogress", "records"];
const aliases = {abweichung_col_e:"weight_gap_excel", abweichung_col_f:"weight_gap_excel",
  abweichung_col_h:"calorie_gap_excel", abweichung_col_i:"calorie_gap_excel"};
const archiveOnly = new Set(["weight_gap_excel","calorie_gap_excel","schlaf_effizienz",
  "wachzeit_min","tiefschlaf","leichtschlaf","rem","wach"]);
const sourcePriority = record => record.source==="gymprogress-derived"?3:
  record.namespace==="fitness.health"?2:record.namespace==="fitness.manual"?1:0;

function metricId(record) {
  const cleaned = record.namespace === "fitness.gymprogress" && Object.hasOwn(aliases, record.metric)
    ? aliases[record.metric] : record.metric;
  return knownNamespaces.includes(record.namespace) && Object.hasOwn(definitions, cleaned)
    ? cleaned : `${record.namespace}:${cleaned}`;
}

export function buildModel(records = []) {
  const dates = new Map();
  const metrics = new Map();
  for (const record of records) {
    const id = metricId(record);
    const definition = definitions[id] ?? {id, label:record.label ?? record.metric.replaceAll("_"," "), unit:record.unit ?? "", group:"other"};
    if (!archiveOnly.has(id)) metrics.set(id, definition);
    if (!dates.has(record.date)) dates.set(record.date, new Map());
    const day = dates.get(record.date);
    if (!day.has(id)) day.set(id,{source:"api",value:record.value,id,records:[]});
    const entry=day.get(id);
    if (entry.records.length===0||sourcePriority(record)>sourcePriority(entry.records[0])) {
      entry.value=record.value;
      entry.records.unshift(record);
    } else {
      entry.records.push(record);
    }
  }
  const goals=[];
  const calorieGoals=[];
  let effective, effectiveCalories;
  for (const [date,day] of [...dates].sort(([left],[right])=>left.localeCompare(right))) {
    for (const id of ["weight_deviation","calorie_deviation","stage_efficiency"]) {
      const entry=day.get(id);
      if (entry?.records[0]?.source==="gymprogress-history-derived") entry.value=null;
    }
    const stored=parseWeightGoal(day.get("zielgewicht")?.value);
    const low=day.get("zielgewicht_min")?.value, high=day.get("zielgewicht_max")?.value;
    const bounds=numeric(low)&&numeric(high)&&low>0&&high>=low?{low,high}:null;
    const goal=stored??bounds;
    if (goal) {
      effective={date,...goal};
      goals.push(effective);
    }
    const target=day.get("zielkalorien")?.value;
    if (numeric(target)&&target>0) {
      effectiveCalories={date,value:target};
      calorieGoals.push(effectiveCalories);
    }
    addDerived(day,metrics,effective,effectiveCalories?.value);
  }
  return {dates, metrics, goals, calorieGoals};
}

function addDerived(day, metrics, goal, calorieGoal) {
  const get = key => day.get(key)?.value;
  const set = (id, value) => {
    if (!numeric(value)) return;
    const entry=day.get(id);
    if (entry) {
      if (entry.records[0]?.source==="gymprogress-history-derived") entry.value=value;
      return;
    }
    day.set(id,{value, source:"derived", id, records:[]});
    metrics.set(id, definitions[id]);
  };
  const difference = (id, left, right) => {
    const a = get(left), b = get(right);
    if (numeric(a) && numeric(b)) set(id,a-b);
  };
  difference("heart_rate_gap", "resting_heart_rate_bpm", "sleep_heart_rate_bpm");
  set("zielkalorien",calorieGoal);
  if (numeric(get("nutrition_kcal"))&&numeric(calorieGoal)) {
    set("calorie_deviation",get("nutrition_kcal")-calorieGoal);
  }
  set("weight_deviation",weightDeviation(get("weight_kg"),goal));
  const total = ["deep_sleep_minutes","light_sleep_minutes","rem_sleep_minutes"].map(get);
  if (!total.every(value => numeric(value) && value >= 0)) return;
  const [deep, light, rem] = total;
  const asleep = deep+light+rem;
  set("recorded_sleep_stages",asleep);
  if (asleep <= 0) return;
  set("deep_share",100*deep/asleep);
  set("light_share",100*light/asleep);
  set("rem_share",100*rem/asleep);
  const wake = get("awake_minutes");
  if (numeric(wake) && wake >= 0) {
    set("stage_efficiency",100*asleep/(asleep+wake));
    set("awake_share",100*wake/(asleep+wake));
  }
}

export const stamp = day => Date.parse(`${day}T00:00:00Z`)/86400000;
export const iso = day => new Date(day*86400000).toISOString().slice(0,10);
export const shift = (day, n) => iso(stamp(day)+n);
export const daysBetween = (from,to) => stamp(to)-stamp(from)+1;
export const formatNumber = (number, digits=2) => new Intl.NumberFormat("de-DE",
  {maximumFractionDigits:digits}).format(number);
export function formatValue(value, definition, withUnit=true) {
  if (!observed(value)) return "–";
  if (definition?.id==="zielgewicht") {
    const goal=parseWeightGoal(value);
    if (goal) return weightGoalText(goal)+(withUnit?" kg":"");
  }
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (!numeric(value)) return String(value);
  if (withUnit && definition?.id === "sleep_duration_minutes") {
    const mins = Math.round(value);
    return `${Math.floor(mins/60)} h ${String(mins%60).padStart(2,"0")} min`;
  }
  return formatNumber(value) + (withUnit && definition?.unit ? ` ${definition.unit}` : "");
}
export const dayLabel = (day, options={day:"2-digit",month:"short"}) =>
  new Intl.DateTimeFormat("de-DE",{...options,timeZone:"UTC"}).format(new Date(stamp(day)*86400000));
