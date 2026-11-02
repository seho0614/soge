'use client';
/**
 * v10.177 (D166 · docs/275) — 회원 투표 만들기 폼. POST /community/my-polls
 * 보기 수는 종류마다(궁금해요 2 ~ 8 · 써본 의견 2 ~ 5) — 서버(DB)도 같은 규칙으로 막습니다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface PollReady {
  open: boolean; login: boolean; ready: boolean; reason: 'OFF' | 'LOGIN' | 'NEW' | 'LIMIT' | null;
  dailyLimit: number; left: number | null; minAgeHours: number; newUntil: string | null; maxDays: number;
}

const MAX = { ASK: 8, USED: 5 } as const;
const DAYS = [1, 3, 7, 14];

export function PollCreateForm({ ready }: { ready: PollReady }) {
  const t = useTranslations('plaza.pollNew');
  const router = useRouter();
  const [kind, setKind] = useState<'ASK' | 'USED'>('ASK');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const max = MAX[kind];
  const filled = opts.map((o) => o.trim()).filter(Boolean);
  const okForm = title.trim().length >= 4 && filled.length >= 2 && filled.length <= max;

  async function submit() {
    if (filled.length < 2) { setErr(t('needOptions')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/community/my-polls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title: title.trim(), description: desc.trim() || undefined, options: filled.map((label) => ({ label })), days }),
      });
      const b = await r.json().catch(() => null) as { message?: string } | null;
      if (!r.ok) { setErr(b?.message ?? t('fail')); setBusy(false); return; }
      router.push('/community/polls/mine?made=1');
    } catch { setErr(t('fail')); setBusy(false); }
  }

  return (
    <div className="card poll-form" style={{ padding: '18px 20px' }} data-poll-form="">
      <div className="fld">
        <span>{t('kind')}</span>
        <div className="opts">
          {(['ASK', 'USED'] as const).map((k) => (
            <button key={k} type="button" className={`opt ${kind === k ? 'on' : ''}`} data-kind={k}
              onClick={() => { setKind(k); setOpts((o) => o.slice(0, MAX[k])); }}>{k === 'ASK' ? t('kindASK') : t('kindUSED')}</button>
          ))}
        </div>
      </div>
      <label className="fld"><span>{t('titleLabel')}</span>
        <input className="inp" name="title" value={title} maxLength={80} placeholder={t('titlePh')} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="fld"><span>{t('desc')}</span>
        <textarea className="inp" name="description" rows={2} value={desc} maxLength={200} placeholder={t('descPh')} onChange={(e) => setDesc(e.target.value)} /></label>
      <div className="fld">
        <span>{t('options')}</span>
        {opts.map((o, i) => (
          <div className="opt-row" key={i}>
            <input className="inp" name={`option${i + 1}`} value={o} maxLength={40} placeholder={t('optionPh', { n: String(i + 1) })}
              onChange={(e) => setOpts((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
            {opts.length > 2 && <button type="button" className="btn-sm" onClick={() => setOpts((a) => a.filter((_, j) => j !== i))}>{t('removeOption')}</button>}
          </div>
        ))}
        {opts.length < max && <button type="button" className="btn-sm" data-add-option="" onClick={() => setOpts((a) => [...a, ''])}>{t('addOption')}</button>}
      </div>
      <div className="fld">
        <span>{t('days')}</span>
        <div className="opts">
          {DAYS.filter((d) => d <= ready.maxDays).map((d) => (
            <button key={d} type="button" className={`opt ${days === d ? 'on' : ''}`} data-days={d} onClick={() => setDays(d)}>{t('daysUnit', { n: String(d) })}</button>
          ))}
        </div>
      </div>
      <p className="dim">{t('rules')}</p>
      {ready.left != null && <p className="dim" data-poll-left={ready.left}>{t('left', { n: String(ready.left) })}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="button" className="btn-primary" disabled={!okForm || busy} onClick={() => void submit()} data-poll-submit="">{busy ? t('sending') : t('submit')}</button>
    </div>
  );
}
