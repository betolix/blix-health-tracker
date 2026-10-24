import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchUserAttributes, updateUserAttributes } from 'aws-amplify/auth';
import { useLanguage } from './language';
import { locales } from './i18n';
import { MAX_DISPLAY_NAME_LENGTH, isValidDisplayName, loadDisplayName, saveDisplayName, type ProfileAuth } from './display-name';

const cognitoProfile: ProfileAuth = { fetchUserAttributes, updateUserAttributes };

// App is keyed by userId, so a different account always mounts a fresh copy.
export function DisplayNameEyebrow({ userId, auth = cognitoProfile }: { userId: string; auth?: ProfileAuth }) {
  const { language, t } = useLanguage();
  const [display, setDisplay] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    loadDisplayName(auth).then((profile) => {
      if (!active) return;
      setDisplay(profile.display);
      setSaved(profile.saved);
    }).catch(() => {
      // Show the generic label rather than another user's or a stale name.
      if (active) setDisplay(null);
    }).finally(() => {
      if (active) setStatus('ready');
    });
    return () => { active = false; };
  }, [auth, userId]);

  const label = status === 'loading' ? '…' : (display ?? t('you')).toLocaleUpperCase(locales[language]);

  return <>
    <span className="eyebrow">
      <button type="button" className="nameButton" aria-label={t('editName')} title={t('editName')}
        disabled={status === 'loading'} onClick={() => setEditing(true)}>
        {label}
      </button> // {t('health')}
    </span>
    {editing && createPortal(<DisplayNameEditor
      name={saved}
      onClose={() => setEditing(false)}
      onSave={async (value) => {
        const name = await saveDisplayName(auth, value);
        setSaved(name);
        setDisplay(name);
        setEditing(false);
      }}
    />, document.body)}
  </>;
}

function DisplayNameEditor({ name, onClose, onSave }: {
  name: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'nameInvalid' | 'nameSaveError' | null>(null);

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);

  return <dialog ref={dialog} className="modal small weightGoalDialog" aria-labelledby="display-name-title"
    onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (saving) return;
      if (!isValidDisplayName(value)) { setError('nameInvalid'); return; }
      setSaving(true);
      setError(null);
      try { await onSave(value); }
      catch { setError('nameSaveError'); setSaving(false); }
    }}>
      <div className="modalHead">
        <h2 id="display-name-title">{t('editName')}</h2>
        <button type="button" aria-label={t('close')} disabled={saving} onClick={onClose}>×</button>
      </div>
      <label htmlFor="display-name-input">{t('yourName')}</label>
      <input id="display-name-input" type="text" autoComplete="name" maxLength={MAX_DISPLAY_NAME_LENGTH} required
        autoFocus value={value} disabled={saving}
        aria-invalid={error === 'nameInvalid'} aria-describedby={error ? 'display-name-error' : 'display-name-help'}
        onChange={(e) => { setValue(e.target.value); setError(null); }} />
      <p id="display-name-help">{t('nameHelp')}</p>
      {error && <p id="display-name-error" className="formError" role="alert">{t(error)}</p>}
      <button className="primary" disabled={saving}>{saving ? t('saving') : t('saveName')}</button>
    </form>
  </dialog>;
}
