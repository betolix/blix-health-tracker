import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './language';
import { isValidTargetWeight, loadWeightGoal, saveWeightGoal, type WeightGoalModel } from './weight-goal';

export function WeightGoalCard({ userId, model, onChange }: {
  userId: string;
  model: WeightGoalModel;
  onChange: (target: number | null) => void;
}) {
  const { t } = useLanguage();
  const [target, setTarget] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    setTarget(null);
    onChange(null);
    setStatus('loading');
    loadWeightGoal(model, userId).then((goal) => {
      if (!active) return;
      const value = goal?.targetWeightKg ?? null;
      setTarget(value);
      onChange(value);
      setStatus('ready');
    }).catch(() => {
      if (active) setStatus('error');
    });
    return () => { active = false; };
  }, [model, userId, onChange, retry]);

  return <div className="weightGoalCard" aria-busy={status === 'loading'}>
    <span>{t('target')}</span>
    <strong>{target === null ? '—' : target.toFixed(1)} {target !== null && <small>kg</small>}</strong>
    <p role={status === 'error' ? 'alert' : 'status'}>
      {status === 'loading' ? t('goalLoading') : status === 'error' ? t('goalLoadError') : target === null ? t('goalUnset') : t('personalWeightGoal')}
    </p>
    {status === 'error'
      ? <button className="ghost goalAction" onClick={() => setRetry(n => n + 1)}>{t('retry')}</button>
      : <button className="ghost goalAction" disabled={status === 'loading'} onClick={() => setEditing(true)}>
        {target === null ? t('setWeightGoal') : t('editWeightGoal')}
      </button>}
    {editing && createPortal(<WeightGoalEditor
      target={target}
      onClose={() => setEditing(false)}
      onSave={async (value) => {
        const saved = await saveWeightGoal(model, userId, value);
        setTarget(saved.targetWeightKg);
        onChange(saved.targetWeightKg);
        setEditing(false);
      }}
    />, document.body)}
  </div>;
}

function WeightGoalEditor({ target, onClose, onSave }: {
  target: number | null;
  onClose: () => void;
  onSave: (value: number) => Promise<void>;
}) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(target === null ? '' : String(target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'goalInvalid' | 'goalSaveError' | null>(null);

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);

  return <dialog ref={dialog} className="modal small weightGoalDialog" aria-labelledby="weight-goal-title"
    onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (saving) return;
      const kg = Number(value);
      if (!value.trim() || !isValidTargetWeight(kg)) { setError('goalInvalid'); return; }
      setSaving(true);
      setError(null);
      try { await onSave(kg); }
      catch { setError('goalSaveError'); setSaving(false); }
    }}>
      <div className="modalHead">
        <h2 id="weight-goal-title">{t('editWeightGoal')}</h2>
        <button type="button" aria-label={t('close')} disabled={saving} onClick={onClose}>×</button>
      </div>
      <label htmlFor="weight-goal-input">{t('targetWeightKg')}</label>
      <input id="weight-goal-input" type="number" inputMode="decimal" step="0.1" min="0.1" required
        autoFocus value={value} disabled={saving}
        aria-invalid={error === 'goalInvalid'} aria-describedby={error ? 'weight-goal-error' : 'weight-goal-help'}
        onChange={(e) => { setValue(e.target.value); setError(null); }} />
      <p id="weight-goal-help">{t('goalHelp')}</p>
      {error && <p id="weight-goal-error" className="formError" role="alert">{t(error)}</p>}
      <button className="primary" disabled={saving}>{saving ? t('saving') : t('saveWeightGoal')}</button>
    </form>
  </dialog>;
}
