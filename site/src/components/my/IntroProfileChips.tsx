'use client';
/**
 * v10.31 (시안 소개자 홈 「내 소개 분야」 칩 + 「+ 분야 추가 · + 지역 추가」).
 *   분야 = 승인된 업종(GET /me/introducer/profile/options) · 지역 = 시 · 도 + 시 · 군 · 구(예: 서울 금천구).
 *   저장은 PATCH /me/introducer/profile — 처음이면 소개자 프로필(새싹 소개자)이 만들어지고, 맞춤 요청은 분야로 거릅니다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type C = { code: string; name: string };

export function IntroProfileChips({ categories, regions }: { categories: C[]; regions: C[] }) {
  const router = useRouter();
  const t = useTranslations('myDeal');
  const [cats, setCats] = useState(categories);
  const [regs, setRegs] = useState(regions);
  const [open, setOpen] = useState<'cat' | 'reg' | null>(null);
  const [opts, setOpts] = useState<{ categories: (C & { gwan: string })[]; sido: string[] } | null>(null);
  const [pick, setPick] = useState('');
  const [sido, setSido] = useState('서울');
  const [sg, setSg] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function load(k: 'cat' | 'reg') {
    setOpen(open === k ? null : k); setMsg(null);
    if (!opts) {
      const r = await fetch('/api/v1/me/introducer/profile/options').catch(() => null);
      if (r?.ok) setOpts(await r.json());
    }
  }
  async function save(nextCats: C[], nextRegs: C[]) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/v1/me/introducer/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: nextCats.map((x) => x.code), regions: nextRegs.map((x) => x.code) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setMsg({ ok: false, t: j?.message ?? t('chips.saveFail') }); return; }
      setCats(j.categories ?? nextCats); setRegs(j.regions ?? nextRegs);
      setMsg({ ok: true, t: j.note ?? t('chips.saved') }); setOpen(null); setPick(''); setSg('');
      router.refresh();
    } catch { setMsg({ ok: false, t: t('netErr') }); }
    finally { setBusy(false); }
  }

  return (
    <div data-intro-profile="">
      <div className="my-chips" data-intro-cats="">
        {cats.map((c) => (
          <span key={c.code} className="my-chip on">{c.name}
            <button type="button" className="x" aria-label={t('chips.remove', { name: c.name })} disabled={busy} onClick={() => save(cats.filter((x) => x.code !== c.code), regs)}>×</button>
          </span>
        ))}
        <button type="button" className="my-chip my-chip-btn" onClick={() => load('cat')} aria-expanded={open === 'cat'} title={t('chips.catTitle')}>{t('chips.addCat')}</button>
      </div>
      {open === 'cat' && (
        <div className="my-addf">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('chips.catLabel')}>
            <option value="">{t('chips.catPick')}</option>
            {(opts?.categories ?? []).filter((o) => !cats.some((c) => c.code === o.code)).map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
          <button type="button" className="my-bp sm" disabled={!pick || busy}
            onClick={() => { const o = opts?.categories.find((x) => x.code === pick); if (o) void save([...cats, { code: o.code, name: o.name }], regs); }}>{t('chips.add')}</button>
        </div>
      )}
      <div className="my-chips" data-intro-regs="">
        {regs.map((c) => (
          <span key={c.code} className="my-chip on">{c.name}
            <button type="button" className="x" aria-label={t('chips.remove', { name: c.name })} disabled={busy} onClick={() => save(cats, regs.filter((x) => x.code !== c.code))}>×</button>
          </span>
        ))}
        <button type="button" className="my-chip my-chip-btn" onClick={() => load('reg')} aria-expanded={open === 'reg'} title={t('chips.regTitle')}>{t('chips.addReg')}</button>
      </div>
      {open === 'reg' && (
        <div className="my-addf">
          <select value={sido} onChange={(e) => setSido(e.target.value)} aria-label={t('chips.sido')}>
            {(opts?.sido ?? ['서울']).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={sg} onChange={(e) => setSg(e.target.value)} maxLength={20} placeholder={t('chips.sgPh')} aria-label={t('chips.sg')} />
          <button type="button" className="my-bp sm" disabled={!sg.trim() || busy}
            onClick={() => { const v = `${sido} ${sg.trim()}`; if (!regs.some((r) => r.code === v)) void save(cats, [...regs, { code: v, name: v }]); }}>{t('chips.add')}</button>
        </div>
      )}
      {msg && <p className={`my-ls ${msg.ok ? '' : 'warnx'}`} role="status">{msg.t}</p>}
    </div>
  );
}
