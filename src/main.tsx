import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { Authenticator } from '@aws-amplify/ui-react';

import type { Schema } from '../amplify/data/resource';

import '@aws-amplify/ui-react/styles.css';
import './style.css';
import { LanguageProvider, LanguageSelector, useLanguage } from './language';
import { locales, type TranslationKey } from './i18n';

import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

const client = generateClient<Schema>();

type Quality = 'measured' | 'label' | 'estimated';
type Meal = { id: string; name: string; detail: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number; quality: Quality };
type Day = { date: string; meals: Meal[] };
type WeightEntry = { date: string; kg: number };
type BPEntry = { date: string; sys: number; dia: number };
type Store = { days: Record<string, Day>; weights: WeightEntry[]; bp: BPEntry[] };

type ListPage<T> = { data: T[]; nextToken?: string | null; errors?: readonly unknown[]; };



const targets = { kcal: 2150, protein: 170, carbs: 210, fat: 70, fiber: 30, targetWeight: 77 };
const TODAY = new Date().toLocaleDateString('en-CA');
const emptyStore: Store = {
  days: {},
  weights: [],
  bp: [],
};

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


function App({ signOut }: { signOut?: () => void }) {
  const { language, t, fmtDate } = useLanguage();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { const s = localStorage.getItem('health-theme'); return s === 'dark' || s === 'light' ? s : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' });
  const [store, setStore] = useState<Store>(emptyStore);
  const [date, setDate] = useState(TODAY);

  const availableDates = useMemo(
    () => getDateRange(TRACKING_START, TODAY),
    []
  );

  const [showAdd, setShowAdd] = useState(false);
  const [showVitals, setShowVitals] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

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
        alert(t('foodSaveError'));
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
      alert(t('foodSaveError'));
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
        alert(t('vitalsSaveError'));
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
      alert(t('vitalsSaveError'));
      return false;
    }
  };



  ////////////

  useEffect(() => {
    loadFoodFromCloud();
    loadVitalsFromCloud();
  }, []);


  useEffect(() => {
    const activeDate = document.querySelector(
      '.daynav button.active'
    );

    activeDate?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [date]);

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
        alert(t('foodDeleteError'));
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
      alert(t('foodDeleteError'));
    }
  };


  return <main>
    <header>
      <div>
        <span className="eyebrow">ALBERTO // {t('health')}</span>
        <h1>{t('dashboard')}</h1>
      </div>

      <div className="headerRight">
        <button className="ghost" onClick={() => setShowVitals(true)}>
          {t('vitals')}
        </button>

        <button
          className="themeToggle"
          aria-label={theme === 'dark' ? t('light') : t('dark')}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <span>{theme === 'dark' ? '☀' : '☾'}</span>
          <b>{theme === 'dark' ? t('light') : t('dark')}</b>
        </button>

        <div className="mobileActions">
          <button
            className="mobileMenuButton"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label={t('openMenu')}
            aria-expanded={showMobileMenu}
          >
            •••
          </button>

          {showMobileMenu && (
            <div className="mobileMenu">
              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  setShowVitals(true);
                }}
              >
                {t('vitals')}
              </button>

              {signOut && (
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    signOut();
                  }}
                >
                  {t('signOut')}
                </button>
              )}
            </div>
          )}
        </div>

        {signOut && (
          <button className="ghost" onClick={signOut}>
            {t('signOut')}
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
            ? t('today').toLocaleUpperCase(locales[language])
            : new Date(d + 'T12:00:00')
              .toLocaleDateString(locales[language], {
                month: 'short',
                day: '2-digit',
              })
              .toUpperCase()}
        </button>
      ))}
    </nav>

    <section className="hero">
      <div><span>{t('latestWeight')}</span><strong>{latestW?.kg.toFixed(1) ?? '—'} <small>kg</small></strong><p>{latestW ? fmtDate(latestW.date) : ''} · {latestW ? (latestW.kg - targets.targetWeight).toFixed(1) : '—'} {t('toTarget')}</p></div>
      <div><span>{t('target')}</span><strong>{targets.targetWeight.toFixed(1)} <small>kg</small></strong><p>{t('fatLoss')}</p></div>
      <div><span>{t('latestBP')}</span><strong>{latestBP ? `${latestBP.sys}/${latestBP.dia}` : '—'}</strong><p>{latestBP ? fmtDate(latestBP.date) : ''} · mmHg</p></div>
    </section>

    <section className="grid">
      <article><div className="sectionHead"><h2>{date === TODAY ? t('today') : fmtDate(date)}</h2><span>{Math.round(totals.kcal / targets.kcal * 100)}% {t('caloriesUsed')}</span></div>
        <Metric n={t('calories')} v={totals.kcal} max={targets.kcal} unit="kcal" />
        <Metric n={t('protein')} v={totals.protein} max={targets.protein} unit="g" />
        <Metric n={t('carbs')} v={totals.carbs} max={targets.carbs} unit="g" />
        <Metric n={t('fat')} v={totals.fat} max={targets.fat} unit="g" />
        <Metric n={t('fiber')} v={totals.fiber} max={targets.fiber} unit="g" />
      </article>
      <article className="remaining"><h2>{t('remaining')}</h2><div className="big">{Math.round(remaining.kcal)}<small> kcal</small></div><div className="big">{Math.round(remaining.protein)}<small> {t('proteinUnit')}</small></div><p>{t('dailyPlan')}</p><div className="status">{totals.protein >= targets.protein ? t('proteinHit') : `${Math.round(totals.protein / targets.protein * 100)}% ${t('proteinTarget')}`}</div></article>
    </section>

    <section className="charts"><article><div className="sectionHead"><h2>{t('weightTrend')}</h2><span>{t('goal')} {targets.targetWeight} kg</span></div><Spark data={store.weights.map(x => ({ label: fmtDate(x.date), value: x.kg }))} target={targets.targetWeight} /></article><article><div className="sectionHead"><h2>{t('bloodPressure')}</h2><span>{t('recentReadings')}</span></div><BPChart data={store.bp} /></article></section>

    <section className="meals"><div className="sectionHead"><h2>{t('foodLog')}</h2><button className="add" onClick={() => setShowAdd(true)}>+ {t('addFood').toLocaleUpperCase(locales[language])}</button></div>{day.meals.length === 0 ? <div className="empty">{t('emptyFood')}</div> : day.meals.map(m => <div className="meal" key={m.id}><div className="mealMain"><b>{m.name}</b><span>{m.detail}</span><em className={`q ${m.quality}`}>{t(m.quality)}</em></div><div className="nums"><b>{Math.round(m.kcal)} kcal</b><span>{Math.round(m.protein)} {t('proteinUnit')}</span></div><button className="delete" onClick={() => removeMeal(m.id)} aria-label={t('deleteFood')}>×</button></div>)}</section>
    <footer>{t('footer')}</footer>

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

function OwnershipProbeRunner({ signOut }: { signOut?: () => void }) {
  const { t } = useLanguage();
  type Probe = Schema['OwnershipProbe']['type'];

  const [probes, setProbes] = useState<Probe[]>([]);
  const [probeId, setProbeId] = useState('');
  const [statusDetail, setStatusDetail] = useState('');
  const [readResult, setReadResult] = useState<TranslationKey>('notTested');
  const [directResult, setDirectResult] = useState<string | null>(null);
  const [status, setStatus] = useState<TranslationKey>('ready');

  const createProbe = async () => {
    setStatus('creatingProbe'); setStatusDetail('');

    const { data, errors } = await client.models.OwnershipProbe.create(
      { label: 'synthetic-ownership-probe' },
      { authMode: 'userPool' }
    );

    if (errors?.length || !data) {
      console.error('OwnershipProbe create failed:', errors);
      setStatus('createFailed'); setStatusDetail('');
      return;
    }

    setProbeId(data.id);
    setStatus('createdProbe'); setStatusDetail(data.id);
  };

  const listVisibleProbes = async () => {
    setStatus('listingProbes'); setStatusDetail('');

    const { data, errors } = await client.models.OwnershipProbe.list({
      authMode: 'userPool',
      limit: 100,
    });

    if (errors?.length) {
      console.error('OwnershipProbe list failed:', errors);
      setStatus('listFailed'); setStatusDetail('');
      return;
    }

    setProbes(data);
    setStatus('visibleProbes'); setStatusDetail(String(data.length));
  };

  const getProbeById = async () => {
    if (!probeId.trim()) {
      setReadResult('enterProbe'); setDirectResult(null);
      return;
    }

    setStatus('testingRead'); setStatusDetail('');

    const { data, errors } = await client.models.OwnershipProbe.get(
      { id: probeId.trim() },
      { authMode: 'userPool' }
    );

    if (errors?.length) {
      console.error('OwnershipProbe direct read errors:', errors);
      setReadResult('denied'); setDirectResult(null);
      setStatus('readCompleted'); setStatusDetail('');
      return;
    }

    if (!data) {
      setReadResult('denied'); setDirectResult(null);
      setStatus('readCompleted'); setStatusDetail('');
      return;
    }

    setReadResult('visible');
    setDirectResult(
      `id=${data.id} | label=${data.label} | owner=${data.owner ?? '—'}`
    );
    setStatus('readCompleted'); setStatusDetail('');
  };

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
      <h1>{t('probeTitle')}</h1>

      <p>
        {t('probeNotice')}
      </p>

      <p><strong>{t('status')}:</strong> {t(status)}{statusDetail ? `: ${statusDetail}` : ''}</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <button onClick={createProbe}>{t('createProbe')}</button>
        <button onClick={listVisibleProbes}>{t('listProbes')}</button>
        {signOut && <button onClick={signOut}>{t('signOut')}</button>}
      </div>

      <h2>{t('visibleProbes')}</h2>

      {probes.length === 0 ? (
        <p>{t('noneLoaded')}</p>
      ) : (
        <ul>
          {probes.map((probe) => (
            <li key={probe.id}>
              <strong>ID:</strong> {probe.id}
              <br />
              <strong>{t('probeLabel')}:</strong> {probe.label}
              <br />
              <strong>{t('owner')}:</strong> {probe.owner ?? '—'}
            </li>
          ))}
        </ul>
      )}

      <hr style={{ margin: '32px 0' }} />

      <h2>{t('directTest')}</h2>

      <p>
        {t('probeInstructions')}
      </p>

      <input
        value={probeId}
        onChange={(e) => setProbeId(e.target.value)}
        aria-label={t('probeId')} placeholder={t('probeId')}
        style={{ width: '100%', padding: 10, marginBottom: 12 }}
      />

      <button onClick={getProbeById}>{t('testRead')}</button>

      <p>
        <strong>{t('result')}:</strong> {t(readResult)} {directResult}
      </p>
    </main>
  );
}

function Metric({ n, v, max, unit }: { n: string; v: number; max: number; unit: string }) { const pct = Math.min(100, v / max * 100); return <div className="metric"><div><b>{n}</b><span>{Math.round(v)} / {max} {unit}</span></div><div className="bar"><i style={{ width: `${pct}%` }} /></div></div> }
function Spark({ data, target }: { data: { label: string, value: number }[]; target: number }) { const { t } = useLanguage(); if (data.length < 2) return null; const w = 520, h = 150, p = 14, min = Math.min(target, ...data.map(d => d.value)) - 1, max = Math.max(...data.map(d => d.value)) + 1; const pts = data.map((d, i) => `${p + i * (w - 2 * p) / (data.length - 1)},${p + (max - d.value) * (h - 2 * p) / (max - min)}`).join(' '); const ty = p + (max - target) * (h - 2 * p) / (max - min); return <div className="spark"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('weightTrend')}><line x1={p} y1={ty} x2={w - p} y2={ty} className="goalLine" /><polyline points={pts} />{data.map((d, i) => { const [x, y] = pts.split(' ')[i].split(','); return <circle key={i} cx={x} cy={y} r="4" /> })}</svg><div className="chartLabels"><span>{data[0].label} · {data[0].value.toFixed(1)}</span><b>{data.at(-1)!.value.toFixed(1)} kg</b><span>{data.at(-1)!.label}</span></div></div> }
function BPChart({ data }: { data: BPEntry[] }) { const { fmtDate } = useLanguage(); return <div className="bpRows">{data.slice(-4).reverse().map((b, i) => <div key={i}><span>{fmtDate(b.date)}</span><b>{b.sys}/{b.dia}</b><i style={{ width: `${Math.min(100, b.sys / 180 * 100)}%` }} /></div>)}</div> }

///////////. FoodModel Function

function FoodModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (m: Meal) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [f, setF] = useState({
    name: '',
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
            name: f.name || t('meal'),
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
          <h2>{t('addFood')}</h2>

          <button type="button" aria-label={t('close')} onClick={onClose}>
            ×
          </button>
        </div>

        <label>
          {t('category')}
          <input placeholder={t('meal')} value={f.name} onChange={field('name')} />
        </label>

        <label>
          {t('description')}
          <input
            value={f.detail}
            onChange={field('detail')}
            placeholder={t('foodExample')}
            autoFocus
          />
        </label>

        <div className="formGrid">
          <label>
            {t('calories')}
            <input
              type="number"
              value={f.kcal}
              onChange={field('kcal')}
            />
          </label>

          <label>
            {t('protein')} (g)
            <input
              type="number"
              step="0.1"
              value={f.protein}
              onChange={field('protein')}
            />
          </label>

          <label>
            {t('carbs')} (g)
            <input
              type="number"
              step="0.1"
              value={f.carbs}
              onChange={field('carbs')}
            />
          </label>

          <label>
            {t('fat')} (g)
            <input
              type="number"
              step="0.1"
              value={f.fat}
              onChange={field('fat')}
            />
          </label>

          <label>
            {t('fiber')} (g)
            <input
              type="number"
              step="0.1"
              value={f.fiber}
              onChange={field('fiber')}
            />
          </label>

          <label>
            {t('source')}
            <select
              value={f.quality}
              onChange={field('quality')}
            >
              <option value="measured">{t('measured')}</option>
              <option value="label">{t('label')}</option>
              <option value="estimated">{t('estimated')}</option>
            </select>
          </label>
        </div>

        <button className="primary" disabled={saving}>
          {saving ? t('saving') : t('saveFood')}
        </button>
      </form>
    </div>
  );
}

///////////

function VitalsModal({ latestW, onClose, onSave }: { latestW: number; onClose: () => void; onSave: (kg: number, sys: number, dia: number) => Promise<void> }) { const { t } = useLanguage(); const [kg, setKg] = useState(String(latestW)); const [sys, setSys] = useState(''); const [dia, setDia] = useState(''); return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="modal small" onSubmit={e => { e.preventDefault(); onSave(+kg, +sys, +dia) }}><div className="modalHead"><h2>{t('addVitals')}</h2><button type="button" aria-label={t('close')} onClick={onClose}>×</button></div><label>{t('weight')} (kg)<input type="number" step="0.1" value={kg} onChange={e => setKg(e.target.value)} /></label><div className="formGrid two"><label>{t('systolic')}<input type="number" value={sys} onChange={e => setSys(e.target.value)} placeholder={t('sysExample')} /></label><label>{t('diastolic')}<input type="number" value={dia} onChange={e => setDia(e.target.value)} placeholder={t('diaExample')} /></label></div><button className="primary">{t('saveVitals')}</button></form></div> }

const ownershipProbeMode =
  new URLSearchParams(window.location.search).get('ownership-probe') === '1';

// Subscribe the authentication UI too, so its built-in vocabulary refreshes
// without remounting the form or clearing a signed-in dashboard.
function LocalizedAuthenticator() {
  useLanguage();
  return <Authenticator>
    {({ signOut }) => ownershipProbeMode
      ? <OwnershipProbeRunner signOut={signOut} />
      : <App signOut={signOut} />}
  </Authenticator>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <LanguageSelector />
      <LocalizedAuthenticator />
    </LanguageProvider>
  </React.StrictMode>
);
