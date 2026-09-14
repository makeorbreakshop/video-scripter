'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StatedAudience } from '@/lib/app/audience/profile';
import styles from './page.module.css';

const fields: { key: keyof StatedAudience; label: string; long?: boolean }[] = [
  { key: 'name', label: 'Audience name' },
  { key: 'income', label: 'Income' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'before', label: 'Before', long: true },
  { key: 'after', label: 'After', long: true },
  { key: 'core_beliefs', label: 'Core beliefs — replacement lines', long: true },
  { key: 'emotional_drivers', label: 'Emotional drivers — replacement lines', long: true },
  { key: 'specific_interests', label: 'Specific interests — replacement lines', long: true },
  { key: 'content_buckets', label: 'Content buckets — name | winning video URL | optional second URL', long: true },
];

export function AudienceControls({ stated, hasProfile = true }: { stated: StatedAudience; hasProfile?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'rebuild' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState(stated);

  async function submit(kind: 'rebuild' | 'save') {
    setBusy(kind); setError('');
    try {
      const res = await fetch(kind === 'rebuild' ? '/api/app/audience/rebuild' : '/api/app/audience/stated', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(kind === 'save' ? answers : {}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!hasProfile) return <section className={styles.editor} aria-label="Build audience profile">
    <button className="cs-btn" data-variant="primary" type="button" onClick={() => submit('rebuild')} disabled={!!busy}>
      {busy === 'rebuild' ? 'Building…' : 'Build audience profile'}
    </button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;

  return <details id="owner-edits" className={styles.editor}>
    <summary>Edit profile</summary>
    <div className={styles.editorHead}>
      <button className="cs-btn" type="button" onClick={() => submit('rebuild')} disabled={!!busy}>
        {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild from channel'}
      </button>
    </div>
    <div className={styles.formGrid}>
      {fields.map(({ key, label, long }) => <label key={key} className={long ? styles.wide : undefined}>
        <span>{label}</span>
        {long ? <textarea value={answers[key] ?? ''} onChange={(e) => setAnswers({ ...answers, [key]: e.target.value })} rows={3} />
          : <input value={answers[key] ?? ''} onChange={(e) => setAnswers({ ...answers, [key]: e.target.value })} />}
      </label>)}
    </div>
    <button className="cs-btn" data-variant="primary" type="button" onClick={() => submit('save')} disabled={!!busy}>
      {busy === 'save' ? 'Saving…' : 'Save edits'}
    </button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </details>;
}
