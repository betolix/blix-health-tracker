import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { Authenticator } from '@aws-amplify/ui-react';

import type { Schema } from '../amplify/data/resource';

import '@aws-amplify/ui-react/styles.css';
import './style.css';

import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

const client = generateClient<Schema>();

type Quality = 'measured' | 'label' | 'estimated';
type Meal = { id: string; name: string; detail: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number; quality: Quality };
type Day = { date: string; meals: Meal[] };
type WeightEntry = { date: string; kg: number };
type BPEntry = { date: string; sys: number; dia: number };
type Store = { days: Record<string, Day>; weights: WeightEntry[]; bp: BPEntry[] };

type ListPage<T> = { data: T[]; nextToken?: string | null; errors?: readonly unknown[];}; 



const targets = { kcal: 2150, protein: 170, carbs: 210, fat: 70, fiber: 30, targetWeight: 77 };
const TODAY = new Date().toLocaleDateString('en-CA');
const emptyStore: Store = {
  days: {},
  weights: [],
  bp: [],
};

const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0;

// ADD THIS ↓

const getDateRange = (start: string, end: string) => {
  const dates: string[] = [];

  const current = new Date(start + 'T12:00:00');
  const last = new Date(end + 'T12:00:00');

  while (current <= last) {
    dates.push(current.toLocaleDateString('en-CA'));
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

const TRACKING_START = '2026-10-03';

/////

function App({ signOut }: { signOut?: () => void }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { const s = localStorage.getItem('health-theme'); return s === 'dark' || s === 'light' ? s : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' });
  const [store, setStore] = useState<Store>(emptyStore);
  const [date, setDate] = useState(TODAY);

  const availableDates = useMemo(
    () => getDateRange(TRACKING_START, TODAY),
    []
  );

  const [showAdd, setShowAdd] = useState(false);
  const [showVitals, setShowVitals] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('health-theme', theme) }, [theme]);
  
  const day = store.days[date] || { date, meals: [] };
  const totals = useMemo(() => day.meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat, fiber: a.fiber + m.fiber }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }), [day]);
  const latestW = store.weights.at(-1); const latestBP = store.bp.at(-1);
  const remaining = { kcal: Math.max(0, targets.kcal - totals.kcal), protein: Math.max(0, targets.protein - totals.protein) };
  
  const update = (fn: (s: Store) => Store) => setStore(s => fn(structuredClone(s)));
  
  /////// const saveFood  

  const saveFood = async (m: Meal): Promise<boolean> => {
  try {
    const { data, errors } = await client.models.FoodEntry.create(
      {
        date,
        name: m.name,
        calories: m.kcal,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        fiber: m.fiber,
        notes: m.detail,
        source: m.quality,
      },
      {
        authMode: 'userPool',
      }
    );

    if (errors?.length || !data) {
      console.error('FoodEntry create errors:', errors);
      alert('The food entry could not be saved to the cloud.');
      return false;
    }

    // Keep a local backup, using the DynamoDB/AppSync record ID.
    update((s) => {
      if (!s.days[date]) {
        s.days[date] = { date, meals: [] };
      }

      s.days[date].meals.push({
        ...m,
        id: data.id,
      });

      return s;
    });

    console.log('Food saved to cloud:', data.id);

    return true;
  } catch (error) {
    console.error('Cloud save failed:', error);
    alert('The food entry could not be saved to the cloud.');
    return false;
  }
};


  const loadFoodFromCloud = async () => {
    try {
      const allFood: Schema['FoodEntry']['type'][] = [];

      let nextToken: string | null = null;

      do {
        const result: ListPage<Schema['FoodEntry']['type']> =
          await client.models.FoodEntry.list({
            authMode: 'userPool',
            limit: 100,
            nextToken,
          });

      if (result.errors?.length) {
        console.error(
          'Could not load cloud food:',
          result.errors
        );
        return;
      }

      allFood.push(...result.data);

      nextToken = result.nextToken ?? null;
    } while (nextToken);

    const cloudDays: Record<string, Day> = {};

    for (const food of allFood) {
      if (!cloudDays[food.date]) {
        cloudDays[food.date] = {
          date: food.date,
          meals: [],
        };
      }

      cloudDays[food.date].meals.push({
        id: food.id,
        name: food.name,
        detail: food.notes ?? '',
        kcal: food.calories,
        protein: food.protein ?? 0,
        carbs: food.carbs ?? 0,
        fat: food.fat ?? 0,
        fiber: food.fiber ?? 0,
        quality: food.source ?? 'estimated',
      });
    }

    setStore((current) => ({
      ...current,

      // Food comes from AWS.
      days: cloudDays,

      // Leave vitals untouched here.
      weights: current.weights,
      bp: current.bp,
    }));

    console.log(
      `Loaded ${allFood.length} food entries from AWS`
    );
  } catch (error) {
    console.error('Cloud food load failed:', error);
  }
};

/////////// 
///////////

  const loadVitalsFromCloud = async () => {
  try {
    const allVitals: Schema['Vital']['type'][] = [];

    let nextToken: string | null = null;

    do {
      const result: ListPage<Schema['Vital']['type']> =
        await client.models.Vital.list({
          authMode: 'userPool',
          limit: 100,
          nextToken,
        });

      if (result.errors?.length) {
        console.error(
          'Could not load cloud vitals:',
          result.errors
        );
        return;
      }

      allVitals.push(...result.data);

      nextToken = result.nextToken ?? null;
    } while (nextToken);

    const weights: WeightEntry[] = [];
    const bp: BPEntry[] = [];

    for (const vital of allVitals) {
      const date = new Date(vital.recordedAt)
        .toLocaleDateString('en-CA');

      if (vital.weightKg != null) {
        weights.push({
          date,
          kg: vital.weightKg,
        });
      }

      if (
        vital.systolic != null &&
        vital.diastolic != null
      ) {
        bp.push({
          date,
          sys: vital.systolic,
          dia: vital.diastolic,
        });
      }
    }

    weights.sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    bp.sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    setStore((current) => ({
      ...current,

      // Food remains untouched here.
      days: current.days,

      // Vitals come from AWS.
      weights,
      bp,
    }));

    console.log(
      `Loaded ${allVitals.length} vital records from AWS`,
      {
        weights: weights.length,
        bloodPressure: bp.length,
      }
    );
  } catch (error) {
    console.error('Cloud vitals load failed:', error);
  }
};
////////////

  const saveVitals = async (
    kg: number,
    sys: number,
    dia: number
  ): Promise<boolean> => {
    try {
      const recordedAt = new Date().toISOString();

      const { data, errors } =
        await client.models.Vital.create(
          {
            recordedAt,

            weightKg: kg > 0 ? kg : undefined,

            systolic:
              sys > 0 && dia > 0 ? sys : undefined,

            diastolic:
              sys > 0 && dia > 0 ? dia : undefined,
          },
          {
            authMode: 'userPool',
          }
        );

      if (errors?.length || !data) {
        console.error('Could not save vitals:', errors);
        alert('The vitals could not be saved to the cloud.');
        return false;
      }

      const localDate = new Date(data.recordedAt)
        .toLocaleDateString('en-CA');

      // Update the UI/local cache only after AWS succeeds.
      update((s) => {
        if (data.weightKg != null) {
          s.weights.push({
            date: localDate,
            kg: data.weightKg,
          });
        }

        if (
          data.systolic != null &&
          data.diastolic != null
        ) {
          s.bp.push({
            date: localDate,
            sys: data.systolic,
            dia: data.diastolic,
          });
        }

        s.weights.sort((a, b) =>
          a.date.localeCompare(b.date)
        );

        s.bp.sort((a, b) =>
          a.date.localeCompare(b.date)
        );

        return s;
      });

      console.log('Vitals saved to AWS:', data.id);

      return true;
    } catch (error) {
      console.error('Cloud vitals save failed:', error);
      alert('The vitals could not be saved to the cloud.');
      return false;
    }
  };



////////////

useEffect(() => {
  loadFoodFromCloud();
  loadVitalsFromCloud();
}, []);

///////////
  const removeMeal = async (id: string) => {
    try {
      const { errors } = await client.models.FoodEntry.delete(
        { id },
        {
          authMode: 'userPool',
        }
      );

      if (errors?.length) {
        console.error('Could not delete food:', errors);
        alert('The food entry could not be deleted.');
        return;
      }

      // Only remove it from the UI/local backup
      // after AWS confirms the deletion.
      update((s) => {
        if (s.days[date]) {
          s.days[date].meals =
            s.days[date].meals.filter((m) => m.id !== id);
        }

        return s;
      });

      console.log('Food deleted from AWS:', id);
    } catch (error) {
      console.error('Cloud delete failed:', error);
      alert('The food entry could not be deleted.');
    }
  };


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

    <nav className="daynav">
      {availableDates.map((d) => (
        <button
          key={d}
          onClick={() => setDate(d)}
          className={date === d ? 'active' : ''}
        >
          {d === TODAY
            ? 'TODAY'
            : new Date(d + 'T12:00:00')
              .toLocaleDateString('en-US', {
                month: 'short',
                day: '2-digit',
              })
              .toUpperCase()}
        </button>
      ))}
    </nav>

    <section className="hero">
      <div><span>LATEST WEIGHT</span><strong>{latestW?.kg.toFixed(1) ?? '—'} <small>kg</small></strong><p>{latestW ? fmtDate(latestW.date) : ''} · {latestW ? (latestW.kg - targets.targetWeight).toFixed(1) : '—'} kg to target</p></div>
      <div><span>TARGET</span><strong>{targets.targetWeight.toFixed(1)} <small>kg</small></strong><p>Fat loss + muscle retention</p></div>
      <div><span>LATEST BP</span><strong>{latestBP ? `${latestBP.sys}/${latestBP.dia}` : '—'}</strong><p>{latestBP ? fmtDate(latestBP.date) : ''} · mmHg</p></div>
    </section>

    <section className="grid">
      <article><div className="sectionHead"><h2>{date === TODAY ? 'Today' : fmtDate(date)}</h2><span>{Math.round(totals.kcal / targets.kcal * 100)}% calories used</span></div>
        <Metric n="Calories" v={totals.kcal} max={targets.kcal} unit="kcal" />
        <Metric n="Protein" v={totals.protein} max={targets.protein} unit="g" />
        <Metric n="Carbs" v={totals.carbs} max={targets.carbs} unit="g" />
        <Metric n="Fat" v={totals.fat} max={targets.fat} unit="g" />
        <Metric n="Fiber" v={totals.fiber} max={targets.fiber} unit="g" />
      </article>
      <article className="remaining"><h2>Remaining</h2><div className="big">{Math.round(remaining.kcal)}<small> kcal</small></div><div className="big">{Math.round(remaining.protein)}<small> g protein</small></div><p>Against your 2,150 kcal / 170 g protein daily plan.</p><div className="status">{totals.protein >= targets.protein ? 'PROTEIN TARGET HIT' : `${Math.round(totals.protein / targets.protein * 100)}% OF PROTEIN TARGET`}</div></article>
    </section>

    <section className="charts"><article><div className="sectionHead"><h2>Weight trend</h2><span>Goal {targets.targetWeight} kg</span></div><Spark data={store.weights.map(x => ({ label: fmtDate(x.date), value: x.kg }))} target={targets.targetWeight} /></article><article><div className="sectionHead"><h2>Blood pressure</h2><span>Recent readings</span></div><BPChart data={store.bp} /></article></section>

    <section className="meals"><div className="sectionHead"><h2>Food log</h2><button className="add" onClick={() => setShowAdd(true)}>+ ADD FOOD</button></div>{day.meals.length === 0 ? <div className="empty">No food logged for this day.</div> : day.meals.map(m => <div className="meal" key={m.id}><div className="mealMain"><b>{m.name}</b><span>{m.detail}</span><em className={`q ${m.quality}`}>{m.quality}</em></div><div className="nums"><b>{Math.round(m.kcal)} kcal</b><span>{Math.round(m.protein)} g protein</span></div><button className="delete" onClick={() => removeMeal(m.id)} aria-label="Delete food">×</button></div>)}</section>
    <footer> Nutrition values can be measured, label-derived or estimated. Data is securely synced with your account. </footer>
    
    ////////// This is important: we no longer close the modal unless AWS confirms that the cloud record was created.

    {showAdd && (
      <FoodModal
        onClose={() => setShowAdd(false)}
        onSave={async (m) => {
          const saved = await saveFood(m);

          if (saved) {
            setShowAdd(false);
          }

          return saved;
        }}
      />
    )}

    //////////

    {showVitals && (
  <VitalsModal
    latestW={latestW?.kg ?? 90.1}
    onClose={() => setShowVitals(false)}
    onSave={async (kg, sys, dia) => {
      const saved = await saveVitals(kg, sys, dia);

      if (saved) {
        setShowVitals(false);
      }
    }}
  />
)}
  
  </main>
}

function Metric({ n, v, max, unit }: { n: string; v: number; max: number; unit: string }) { const pct = Math.min(100, v / max * 100); return <div className="metric"><div><b>{n}</b><span>{Math.round(v)} / {max} {unit}</span></div><div className="bar"><i style={{ width: `${pct}%` }} /></div></div> }
function Spark({ data, target }: { data: { label: string, value: number }[]; target: number }) { if (data.length < 2) return null; const w = 520, h = 150, p = 14, min = Math.min(target, ...data.map(d => d.value)) - 1, max = Math.max(...data.map(d => d.value)) + 1; const pts = data.map((d, i) => `${p + i * (w - 2 * p) / (data.length - 1)},${p + (max - d.value) * (h - 2 * p) / (max - min)}`).join(' '); const ty = p + (max - target) * (h - 2 * p) / (max - min); return <div className="spark"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Weight trend"><line x1={p} y1={ty} x2={w - p} y2={ty} className="goalLine" /><polyline points={pts} />{data.map((d, i) => { const [x, y] = pts.split(' ')[i].split(','); return <circle key={i} cx={x} cy={y} r="4" /> })}</svg><div className="chartLabels"><span>{data[0].label} · {data[0].value.toFixed(1)}</span><b>{data.at(-1)!.value.toFixed(1)} kg</b><span>{data.at(-1)!.label}</span></div></div> }
function BPChart({ data }: { data: BPEntry[] }) { return <div className="bpRows">{data.slice(-4).reverse().map((b, i) => <div key={i}><span>{fmtDate(b.date)}</span><b>{b.sys}/{b.dia}</b><i style={{ width: `${Math.min(100, b.sys / 180 * 100)}%` }} /></div>)}</div> }

///////////. FoodModel Function

function FoodModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (m: Meal) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    name: 'Meal',
    detail: '',
    kcal: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    quality: 'estimated' as Quality,
  });

  const [saving, setSaving] = useState(false);

  const field =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF({
        ...f,
        [k]: e.target.value,
      });

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();

          if (saving) return;

          setSaving(true);

          const saved = await onSave({
            id: uid(),
            name: f.name || 'Meal',
            detail: f.detail,
            kcal: clamp(+f.kcal),
            protein: clamp(+f.protein),
            carbs: clamp(+f.carbs),
            fat: clamp(+f.fat),
            fiber: clamp(+f.fiber),
            quality: f.quality,
          });

          if (!saved) {
            setSaving(false);
          }
        }}
      >
        <div className="modalHead">
          <h2>Add food</h2>

          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <label>
          Category
          <input value={f.name} onChange={field('name')} />
        </label>

        <label>
          Description
          <input
            value={f.detail}
            onChange={field('detail')}
            placeholder="e.g. chicken breast, 180 g"
            autoFocus
          />
        </label>

        <div className="formGrid">
          <label>
            Calories
            <input
              type="number"
              value={f.kcal}
              onChange={field('kcal')}
            />
          </label>

          <label>
            Protein (g)
            <input
              type="number"
              step="0.1"
              value={f.protein}
              onChange={field('protein')}
            />
          </label>

          <label>
            Carbs (g)
            <input
              type="number"
              step="0.1"
              value={f.carbs}
              onChange={field('carbs')}
            />
          </label>

          <label>
            Fat (g)
            <input
              type="number"
              step="0.1"
              value={f.fat}
              onChange={field('fat')}
            />
          </label>

          <label>
            Fiber (g)
            <input
              type="number"
              step="0.1"
              value={f.fiber}
              onChange={field('fiber')}
            />
          </label>

          <label>
            Source
            <select
              value={f.quality}
              onChange={field('quality')}
            >
              <option value="measured">Measured</option>
              <option value="label">Label</option>
              <option value="estimated">Estimated</option>
            </select>
          </label>
        </div>

        <button className="primary" disabled={saving}>
          {saving ? 'SAVING...' : 'SAVE FOOD'}
        </button>
      </form>
    </div>
  );
}

///////////

function VitalsModal({ latestW, onClose, onSave }: { latestW: number; onClose: () => void; onSave: (kg: number, sys: number, dia: number) => Promise<void> }) { const [kg, setKg] = useState(String(latestW)); const [sys, setSys] = useState(''); const [dia, setDia] = useState(''); return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="modal small" onSubmit={e => { e.preventDefault(); onSave(+kg, +sys, +dia) }}><div className="modalHead"><h2>Add today's vitals</h2><button type="button" onClick={onClose}>×</button></div><label>Weight (kg)<input type="number" step="0.1" value={kg} onChange={e => setKg(e.target.value)} /></label><div className="formGrid two"><label>Systolic<input type="number" value={sys} onChange={e => setSys(e.target.value)} placeholder="e.g. 135" /></label><label>Diastolic<input type="number" value={dia} onChange={e => setDia(e.target.value)} placeholder="e.g. 88" /></label></div><button className="primary">SAVE VITALS</button></form></div> }

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Authenticator>
      {({ signOut }) => (
        <App signOut={signOut} />
      )}
    </Authenticator>
  </React.StrictMode>
);
