import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';

import '@aws-amplify/ui-react/styles.css';
import './style.css';

import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

type Quality='measured'|'label'|'estimated';
type Meal={id:string;name:string;detail:string;kcal:number;protein:number;carbs:number;fat:number;fiber:number;quality:Quality};
type Day={date:string;meals:Meal[]};
type WeightEntry={date:string;kg:number};
type BPEntry={date:string;sys:number;dia:number};
type Store={days:Record<string,Day>;weights:WeightEntry[];bp:BPEntry[]};

const targets={kcal:2150,protein:170,carbs:210,fat:70,fiber:30,targetWeight:77};
const TODAY='2026-10-04';
const seed:Store={
  days:{
    '2026-10-03':{date:'2026-10-03',meals:[
      {id:'1',name:'Breakfast',detail:'2 whole eggs + 200 g egg whites',kcal:249,protein:34,carbs:1,fat:10,fiber:0,quality:'label'},
      {id:'2',name:'Coffee',detail:'2 × 16 oz decaf 2% lattes',kcal:380,protein:25,carbs:30,fat:16,fiber:0,quality:'estimated'},
      {id:'3',name:'Lunch',detail:'T-bone steak, ~191 g consumed',kcal:500,protein:53,carbs:0,fat:32,fiber:0,quality:'estimated'},
      {id:'4',name:'Potatoes',detail:'103 g baby potatoes + 2 small potatoes',kcal:143,protein:3.5,carbs:33,fat:0.2,fiber:3,quality:'estimated'},
      {id:'5',name:'Snack',detail:'1 banana',kcal:105,protein:1.3,carbs:27,fat:0.3,fiber:3.1,quality:'estimated'},
      {id:'6',name:'Snack',detail:'170 g Siggi’s skyr',kcal:120,protein:18,carbs:13,fat:0,fiber:0,quality:'label'}
    ]},
    '2026-10-04':{date:'2026-10-04',meals:[
      {id:'7',name:'Breakfast',detail:'2 whole eggs + 226 g egg whites',kcal:263,protein:37,carbs:1,fat:10,fiber:0,quality:'label'}
    ]}
  },
  weights:[{date:'2026-09-23',kg:90.9},{date:'2026-09-24',kg:90.5},{date:'2026-09-25',kg:90.0},{date:'2026-09-26',kg:90.2},{date:'2026-09-27',kg:90.9},{date:'2026-09-28',kg:89.8},{date:'2026-10-02',kg:90.2},{date:'2026-10-03',kg:90.1}],
  bp:[{date:'2026-09-28',sys:135,dia:98},{date:'2026-10-02',sys:142,dia:96},{date:'2026-10-03',sys:138,dia:92}]
};

const fmtDate=(d:string)=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const clamp=(n:number)=>Number.isFinite(n)?Math.max(0,n):0;

function App({ signOut }: { signOut?: () => void }) {
  const [theme,setTheme]=useState<'dark'|'light'>(()=>{const s=localStorage.getItem('health-theme');return s==='dark'||s==='light'?s:window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'});
  const [store,setStore]=useState<Store>(()=>{try{const s=localStorage.getItem('alberto-health-v2');return s?JSON.parse(s):seed}catch{return seed}});
  const [date,setDate]=useState(TODAY);
  const [showAdd,setShowAdd]=useState(false);
  const [showVitals,setShowVitals]=useState(false);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('health-theme',theme)},[theme]);
  useEffect(()=>localStorage.setItem('alberto-health-v2',JSON.stringify(store)),[store]);
  const day=store.days[date]||{date,meals:[]};
  const totals=useMemo(()=>day.meals.reduce((a,m)=>({kcal:a.kcal+m.kcal,protein:a.protein+m.protein,carbs:a.carbs+m.carbs,fat:a.fat+m.fat,fiber:a.fiber+m.fiber}),{kcal:0,protein:0,carbs:0,fat:0,fiber:0}),[day]);
  const latestW=store.weights.at(-1); const latestBP=store.bp.at(-1);
  const remaining={kcal:Math.max(0,targets.kcal-totals.kcal),protein:Math.max(0,targets.protein-totals.protein)};
  const update=(fn:(s:Store)=>Store)=>setStore(s=>fn(structuredClone(s)));
  const removeMeal=(id:string)=>update(s=>{s.days[date].meals=s.days[date].meals.filter(m=>m.id!==id);return s});
  return <main>
    <header>
      <div>
        <span className="eyebrow">ALBERTO // HEALTH</span>
        <h1>Daily dashboard</h1>
      </div>

      <div className="headerRight">
        <button className="ghost" onClick={() => setShowVitals(true)}>
          + VITALS
        </button>

        <button
          className="themeToggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <span>{theme === 'dark' ? '☀' : '☾'}</span>
          <b>{theme === 'dark' ? 'LIGHT' : 'DARK'}</b>
        </button>

        {signOut && (
          <button className="ghost" onClick={signOut}>
            SIGN OUT
          </button>
        )}
      </div>
    </header>

    <nav className="daynav"><button onClick={()=>setDate('2026-10-03')} className={date==='2026-10-03'?'active':''}>OCT 03</button><button onClick={()=>setDate('2026-10-04')} className={date==='2026-10-04'?'active':''}>OCT 04</button></nav>

    <section className="hero">
      <div><span>LATEST WEIGHT</span><strong>{latestW?.kg.toFixed(1)??'—'} <small>kg</small></strong><p>{latestW?fmtDate(latestW.date):''} · {latestW?(latestW.kg-targets.targetWeight).toFixed(1):'—'} kg to target</p></div>
      <div><span>TARGET</span><strong>{targets.targetWeight.toFixed(1)} <small>kg</small></strong><p>Fat loss + muscle retention</p></div>
      <div><span>LATEST BP</span><strong>{latestBP?`${latestBP.sys}/${latestBP.dia}`:'—'}</strong><p>{latestBP?fmtDate(latestBP.date):''} · mmHg</p></div>
    </section>

    <section className="grid">
      <article><div className="sectionHead"><h2>{date===TODAY?'Today':fmtDate(date)}</h2><span>{Math.round(totals.kcal/targets.kcal*100)}% calories used</span></div>
        <Metric n="Calories" v={totals.kcal} max={targets.kcal} unit="kcal"/>
        <Metric n="Protein" v={totals.protein} max={targets.protein} unit="g"/>
        <Metric n="Carbs" v={totals.carbs} max={targets.carbs} unit="g"/>
        <Metric n="Fat" v={totals.fat} max={targets.fat} unit="g"/>
        <Metric n="Fiber" v={totals.fiber} max={targets.fiber} unit="g"/>
      </article>
      <article className="remaining"><h2>Remaining</h2><div className="big">{Math.round(remaining.kcal)}<small> kcal</small></div><div className="big">{Math.round(remaining.protein)}<small> g protein</small></div><p>Against your 2,150 kcal / 170 g protein daily plan.</p><div className="status">{totals.protein>=targets.protein?'PROTEIN TARGET HIT':`${Math.round(totals.protein/targets.protein*100)}% OF PROTEIN TARGET`}</div></article>
    </section>

    <section className="charts"><article><div className="sectionHead"><h2>Weight trend</h2><span>Goal {targets.targetWeight} kg</span></div><Spark data={store.weights.map(x=>({label:fmtDate(x.date),value:x.kg}))} target={targets.targetWeight}/></article><article><div className="sectionHead"><h2>Blood pressure</h2><span>Recent readings</span></div><BPChart data={store.bp}/></article></section>

    <section className="meals"><div className="sectionHead"><h2>Food log</h2><button className="add" onClick={()=>setShowAdd(true)}>+ ADD FOOD</button></div>{day.meals.length===0?<div className="empty">No food logged for this day.</div>:day.meals.map(m=><div className="meal" key={m.id}><div className="mealMain"><b>{m.name}</b><span>{m.detail}</span><em className={`q ${m.quality}`}>{m.quality}</em></div><div className="nums"><b>{Math.round(m.kcal)} kcal</b><span>{Math.round(m.protein)} g protein</span></div><button className="delete" onClick={()=>removeMeal(m.id)} aria-label="Delete food">×</button></div>)}</section>
    <footer>Nutrition values can be measured, label-derived or estimated. Data is stored locally in this browser in v2.</footer>
    {showAdd&&<FoodModal onClose={()=>setShowAdd(false)} onSave={m=>{update(s=>{if(!s.days[date])s.days[date]={date,meals:[]};s.days[date].meals.push(m);return s});setShowAdd(false)}}/>}
    {showVitals&&<VitalsModal latestW={latestW?.kg??90.1} onClose={()=>setShowVitals(false)} onSave={(kg,sys,dia)=>{update(s=>{if(kg>0)s.weights.push({date:TODAY,kg});if(sys>0&&dia>0)s.bp.push({date:TODAY,sys,dia});return s});setShowVitals(false)}}/>}
  </main>
}

function Metric({n,v,max,unit}:{n:string;v:number;max:number;unit:string}){const pct=Math.min(100,v/max*100);return <div className="metric"><div><b>{n}</b><span>{Math.round(v)} / {max} {unit}</span></div><div className="bar"><i style={{width:`${pct}%`}}/></div></div>}
function Spark({data,target}:{data:{label:string,value:number}[];target:number}){if(data.length<2)return null;const w=520,h=150,p=14,min=Math.min(target,...data.map(d=>d.value))-1,max=Math.max(...data.map(d=>d.value))+1;const pts=data.map((d,i)=>`${p+i*(w-2*p)/(data.length-1)},${p+(max-d.value)*(h-2*p)/(max-min)}`).join(' ');const ty=p+(max-target)*(h-2*p)/(max-min);return <div className="spark"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Weight trend"><line x1={p} y1={ty} x2={w-p} y2={ty} className="goalLine"/><polyline points={pts}/>{data.map((d,i)=>{const [x,y]=pts.split(' ')[i].split(',');return <circle key={i} cx={x} cy={y} r="4"/>})}</svg><div className="chartLabels"><span>{data[0].label} · {data[0].value.toFixed(1)}</span><b>{data.at(-1)!.value.toFixed(1)} kg</b><span>{data.at(-1)!.label}</span></div></div>}
function BPChart({data}:{data:BPEntry[]}){return <div className="bpRows">{data.slice(-4).reverse().map((b,i)=><div key={i}><span>{fmtDate(b.date)}</span><b>{b.sys}/{b.dia}</b><i style={{width:`${Math.min(100,b.sys/180*100)}%`}}/></div>)}</div>}

function FoodModal({onClose,onSave}:{onClose:()=>void;onSave:(m:Meal)=>void}){const [f,setF]=useState({name:'Meal',detail:'',kcal:'',protein:'',carbs:'',fat:'',fiber:'',quality:'estimated' as Quality});const field=(k:keyof typeof f)=>(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>setF({...f,[k]:e.target.value});return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={e=>{e.preventDefault();onSave({id:uid(),name:f.name||'Meal',detail:f.detail,kcal:clamp(+f.kcal),protein:clamp(+f.protein),carbs:clamp(+f.carbs),fat:clamp(+f.fat),fiber:clamp(+f.fiber),quality:f.quality})}}><div className="modalHead"><h2>Add food</h2><button type="button" onClick={onClose}>×</button></div><label>Category<input value={f.name} onChange={field('name')}/></label><label>Description<input value={f.detail} onChange={field('detail')} placeholder="e.g. chicken breast, 180 g" autoFocus/></label><div className="formGrid"><label>Calories<input type="number" value={f.kcal} onChange={field('kcal')}/></label><label>Protein (g)<input type="number" step="0.1" value={f.protein} onChange={field('protein')}/></label><label>Carbs (g)<input type="number" step="0.1" value={f.carbs} onChange={field('carbs')}/></label><label>Fat (g)<input type="number" step="0.1" value={f.fat} onChange={field('fat')}/></label><label>Fiber (g)<input type="number" step="0.1" value={f.fiber} onChange={field('fiber')}/></label><label>Source<select value={f.quality} onChange={field('quality')}><option value="measured">Measured</option><option value="label">Label</option><option value="estimated">Estimated</option></select></label></div><button className="primary">SAVE FOOD</button></form></div>}
function VitalsModal({latestW,onClose,onSave}:{latestW:number;onClose:()=>void;onSave:(kg:number,sys:number,dia:number)=>void}){const [kg,setKg]=useState(String(latestW));const [sys,setSys]=useState('');const [dia,setDia]=useState('');return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal small" onSubmit={e=>{e.preventDefault();onSave(+kg,+sys,+dia)}}><div className="modalHead"><h2>Add today's vitals</h2><button type="button" onClick={onClose}>×</button></div><label>Weight (kg)<input type="number" step="0.1" value={kg} onChange={e=>setKg(e.target.value)}/></label><div className="formGrid two"><label>Systolic<input type="number" value={sys} onChange={e=>setSys(e.target.value)} placeholder="e.g. 135"/></label><label>Diastolic<input type="number" value={dia} onChange={e=>setDia(e.target.value)} placeholder="e.g. 88"/></label></div><button className="primary">SAVE VITALS</button></form></div>}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Authenticator>
      {({ signOut }) => (
        <App signOut={signOut} />
      )}
    </Authenticator>
  </React.StrictMode>
);
