'use client';
/**
 * v10.31 (W5 · SB-PTC-CTR-201 · 210) — 서비스 상세의 동작(수정 = 재검수 · 노출 중단 · 재개) · 상세페이지 블록 · 견적 매트릭스,
 * 그리고 서비스 등록 위자드(업종이 등록 방식을 정함 — 매트릭스 견적 7단계 · 그 밖 3단계).
 * 규칙(금칙어 · 업종의 등록 방식 · 매트릭스 구간 · 최고 확인비용 하한 · 전화번호 금지)은 서버(DB)가 봅니다 — 여기서는 서버 사유를 그대로 보입니다.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './act';
import { uploadFile } from '@/lib/upload';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';

/** v10.102 (2-5c) — 화면 언어에 묶은 원 표기(ko 「1,000원」 · en 「₩1,000」) */
const useWon = () => { const fm = useFmt(); return (n: number | null | undefined) => fm.won(n ?? 0); };
type Msg = ['ok' | 'err', string] | null;
const MsgP = ({ m }: { m: Msg }) => (m ? <p className={`pt-msg ${m[0]}`} role="status">{m[1]}</p> : null);

/* ── 수정 · 노출 중단 · 재개 ─────────────────────────────────────────── */
export function ServiceActions({ id, title, body, target, receiveMode, topFee, referralRate, rebateBonus, baseFee, canEdit, canSuspend, canResume, status }: {
  id: string; title: string; body: string | null; target: string | null; receiveMode: string | null;
  topFee: number | null; referralRate: number | null; rebateBonus: number | null; baseFee: number | null;
  canEdit: boolean; canSuspend: boolean; canResume: boolean; status: string;
}) {
  const t = useTranslations('partnerOps.tools');
  const won = useWon();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title, body: body ?? '', target: target ?? '', receiveMode: receiveMode ?? '',
    topFee: topFee ?? '', referralPct: referralRate != null ? Math.round(referralRate * 1000) / 10 : '', rebateBonus: rebateBonus ?? '' } as Record<string, string | number>);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    const content = f.title !== title || f.body !== (body ?? '') || f.target !== (target ?? '') || f.receiveMode !== (receiveMode ?? '');
    if (content && status === 'APPROVED' && !confirm(t('editConfirm'))) return;
    setBusy(true); setM(null);
    const dto: Record<string, unknown> = {};
    if (f.title !== title) dto.title = String(f.title);
    if (f.body !== (body ?? '')) dto.body = String(f.body);
    if (f.target !== (target ?? '')) dto.target = String(f.target) || null;
    if (f.receiveMode !== (receiveMode ?? '')) dto.receiveMode = f.receiveMode || null;
    if (String(f.topFee) !== String(topFee ?? '')) dto.topFee = f.topFee === '' ? null : Number(f.topFee);
    const rp = referralRate != null ? Math.round(referralRate * 1000) / 10 : '';
    if (String(f.referralPct) !== String(rp)) dto.referralRate = f.referralPct === '' ? null : Math.round(Number(f.referralPct) * 10) / 1000;
    if (String(f.rebateBonus) !== String(rebateBonus ?? '')) dto.rebateBonus = f.rebateBonus === '' ? null : Number(f.rebateBonus);
    try { const r = await api<{ note: string }>('PATCH', `/partner/services/${id}`, dto); setM(['ok', r.note]); setOpen(false); router.refresh(); }
    catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  async function act(kind: 'suspend' | 'resume') {
    if (kind === 'suspend' && !confirm(t('suspendConfirm'))) return;
    setBusy(true); setM(null);
    try { const r = await api<{ note: string }>('POST', `/partner/services/${id}/${kind}`, {}); setM(['ok', r.note]); router.refresh(); }
    catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  return (
    <div data-svc-actions>
      <div className="pt-dact">
        {canEdit && <button type="button" className="pt-bo" onClick={() => setOpen(!open)}>{t('edit')}</button>}
        {canSuspend && <button type="button" className="pt-bo" disabled={busy} onClick={() => void act('suspend')}>{t('suspend')}</button>}
        {canResume && <button type="button" className="pt-bp" disabled={busy} onClick={() => void act('resume')}>{t('resume')}</button>}
      </div>
      {open && (
        <div className="pt-fset">
          <h3>{t('edit')}</h3>
          <label className="fld"><span>{t('name')}</span><input className="pt-input" value={String(f.title)} onChange={set('title')} /></label>
          <label className="fld"><span>{t('desc')}</span><textarea className="pt-input" rows={5} value={String(f.body)} onChange={set('body')} /></label>
          <label className="fld"><span>{t('target')}</span><input className="pt-input" value={String(f.target)} onChange={set('target')} placeholder={t('targetPh1')} /></label>
          <label className="fld"><span>{t('receive')}</span>
            <select className="pt-input" value={String(f.receiveMode)} onChange={set('receiveMode')}>
              <option value="">{t('rm.none')}</option><option value="QUOTE">{t('rm.QUOTE')}</option><option value="CALL">{t('rm.CALL')}</option>
              <option value="VISIT">{t('rm.VISIT')}</option><option value="CHAT">{t('rm.CHAT')}</option>
            </select></label>
          <div className="pt-row">
            <label>{t('topFeeLbl')}{baseFee ? ` — ${t('minBase', { amt: won(baseFee) })}` : ''}
              <input className="pt-input" type="number" value={String(f.topFee)} onChange={set('topFee')} style={{ width: 130 }} /></label>
            <label>{t('refPctLbl')}
              <input className="pt-input" type="number" step="0.5" value={String(f.referralPct)} onChange={set('referralPct')} style={{ width: 100 }} /></label>
            <label>{t('rebateLbl')}
              <input className="pt-input" type="number" value={String(f.rebateBonus)} onChange={set('rebateBonus')} style={{ width: 130 }} /></label>
          </div>
          <p className="pt-ls">{t('editHint')}</p>
          <div className="pt-dact"><button type="button" className="pt-bp" disabled={busy} onClick={() => void save()}>{busy ? t('saving') : t('save')}</button>
            <button type="button" className="pt-bo" onClick={() => setOpen(false)}>{t('close')}</button></div>
        </div>
      )}
      <MsgP m={m} />
    </div>
  );
}

/* ── 상세페이지 블록 ─────────────────────────────────────────────────── */
export function BlockEditor({ id, kind, label, body, fileId }: { id: string; kind: string; label: string; body: string | null; fileId: string | null }) {
  const t = useTranslations('partnerOps.tools');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(body ?? '');
  const [file, setFile] = useState<string | null>(fileId);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  async function save(clear = false) {
    setBusy(true); setM(null);
    try {
      await api('PUT', `/partner/services/${id}/blocks/${kind}`, clear ? { body: null, fileId: null } : { body: text || null, fileId: file });
      setM(['ok', clear ? t('cleared') : t('saved')]); setOpen(false); router.refresh();
    } catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setM(null);
    try { const u = await uploadFile(f, 'PARTNER_MEDIA'); setFile(u.fileId); setM(['ok', t('uploaded', { name: u.name })]); }
    catch (x) { setM(['err', (x as Error).message]); } finally { setBusy(false); }
  }
  return (
    <span data-block={kind}>
      {!open ? <button type="button" className="pt-bo sm" onClick={() => setOpen(true)}>{body || fileId ? t('fix') : t('fill')}</button> : (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
          {kind === 'HERO_IMAGE' || kind === 'CASES'
            ? <input type="file" accept="image/jpeg,image/png" onChange={(e) => void pick(e)} disabled={busy} /> : null}
          <textarea className="pt-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('blockPh', { label })} />
          <span className="pt-row">
            <button type="button" className="pt-bp sm" disabled={busy} onClick={() => void save()}>{t('save')}</button>
            {(body || fileId) && <button type="button" className="pt-bo sm" disabled={busy} onClick={() => void save(true)}>{t('clear')}</button>}
            <button type="button" className="pt-bo sm" onClick={() => setOpen(false)}>{t('close')}</button>
          </span>
        </span>
      )}
      <MsgP m={m} />
    </span>
  );
}

/* ── 견적 매트릭스 ───────────────────────────────────────────────────── */
type Ax = { key: string; label: string };
export function MatrixEditor({ id, rows, cols, cells, readOnly }: { id?: string; rows: Ax[]; cols: Ax[]; cells: Array<{ row: string; col: string; amount: number }>; readOnly?: boolean }) {
  const t = useTranslations('partnerOps.tools');
  const fm = useFmt();
  const router = useRouter();
  const init = useMemo(() => Object.fromEntries(cells.map((c) => [`${c.row}|${c.col}`, String(Math.round(c.amount / 10000))])), [cells]);
  const [v, setV] = useState<Record<string, string>>(init);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  async function save() {
    if (!id) return;
    setBusy(true); setM(null);
    const out = rows.flatMap((r) => cols.map((c) => ({ row: r.key, col: c.key, amount: v[`${r.key}|${c.key}`] ? Math.round(Number(v[`${r.key}|${c.key}`]) * 10000) : null })));
    try { const r = await api<{ cells: number }>('PUT', `/partner/services/${id}/matrix`, { cells: out }); setM(['ok', t('cellsSaved', { n: String(r.cells) })]); router.refresh(); }
    catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  if (!rows.length || !cols.length) return <p className="pt-ls">{t('noAxis')}</p>;
  return (
    <div data-matrix>
      <div className="pt-tw">
        <table className="pt-tb2 pt-mx">
          <thead><tr><th>{t('mxCorner')}</th>{cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><td><b>{r.label}</b></td>
                {cols.map((c) => {
                  const k = `${r.key}|${c.key}`;
                  return <td key={k} className="num">{readOnly ? (v[k] ? fm.manwon(v[k]) : '—')
                    : <input className="pt-input" type="number" min={0} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder={t('manPh')} aria-label={t('manAria', { row: r.label, col: c.label })} />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && id && <div className="pt-dact"><button type="button" className="pt-bp" disabled={busy} onClick={() => void save()}>{busy ? t('saving') : t('mxSave')}</button><span className="pt-ls">{t('mxUnit')}</span></div>}
      <MsgP m={m} />
    </div>
  );
}

/* ── 서비스 등록 위자드 ───────────────────────────────────────────────── */
export interface WizCategory {
  id: string; name: string; form: string | null; formLabel: string; steps: string[]; baseFee: number | null;
  restrictedCode: string | null; rows: Ax[]; cols: Ax[];
}
export function ServiceWizard({ categories, rates, blocks }: {
  categories: WizCategory[]; rates: Array<{ grade: string; label: string; rate: number }>; blocks: Array<{ kind: string; label: string }>;
}) {
  const t = useTranslations('partnerOps.tools');
  const won = useWon();
  const router = useRouter();
  const [catId, setCatId] = useState('');
  const cat = categories.find((c) => c.id === catId) ?? null;
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ title: '', body: '', target: '', receiveMode: 'QUOTE', topFee: '', referralPct: '', rebateBonus: '' });
  const [mx, setMx] = useState<Record<string, string>>({});
  const [bl, setBl] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const steps = cat?.steps ?? [];
  const isMatrix = cat?.form === 'MATRIX';
  const top = Number(f.topFee || cat?.baseFee || 0);

  async function submit() {
    if (!cat) return;
    setBusy(true); setM(null);
    const matrix = isMatrix ? cat.rows.flatMap((r) => cat.cols.map((c) => ({ row: r.key, col: c.key, amount: mx[`${r.key}|${c.key}`] ? Math.round(Number(mx[`${r.key}|${c.key}`]) * 10000) : 0 }))).filter((x) => x.amount > 0) : [];
    try {
      const r = await api<{ id: string; note: string }>('POST', '/partner/services', {
        title: f.title, body: f.body, categoryId: cat.id, wizard: true,
        target: f.target || undefined, receiveMode: f.receiveMode || undefined,
        topFee: f.topFee ? Number(f.topFee) : undefined,
        referralRate: f.referralPct ? Math.round(Number(f.referralPct) * 10) / 1000 : undefined,
        rebateBonus: f.rebateBonus ? Number(f.rebateBonus) : undefined,
        matrix, blocks: Object.entries(bl).filter(([, v]) => v.trim()).map(([kind, body]) => ({ kind, body })),
      });
      setM(['ok', r.note]);
      router.push(`/partner/services/${r.id}`);
    } catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }

  /* 단계 화면 — 매트릭스 견적 7단계(제공 서비스 · 주요 타겟 · 자동 견적 구간 · 상담 확인비용 · 소개비 · 랜딩 미리보기 · 등록 신청), 그 밖 3단계 */
  const name = steps[step] ?? '';
  const view = (() => {
    if (!cat) return null;
    if (/제공 서비스|접수 방식|시술 선택|상품 정의/.test(name)) return (
      <>
        <label className="fld"><span>{t('name')}</span><input className="pt-input" value={f.title} onChange={set('title')} placeholder={isMatrix ? t('namePhMx') : t('namePh')} /></label>
        <label className="fld"><span>{t('desc')}</span><textarea className="pt-input" rows={5} value={f.body} onChange={set('body')} placeholder={t('descPh')} /></label>
        {!isMatrix && <label className="fld"><span>{t('receive')}</span>
          <select className="pt-input" value={f.receiveMode} onChange={set('receiveMode')} disabled={!!cat.restrictedCode}>
            <option value="QUOTE">{t('rm.QUOTE')}</option><option value="CALL">{t('rm.CALL')}</option><option value="VISIT">{t('rm.VISIT')}</option><option value="CHAT">{t('rm.CHAT')}</option>
          </select>{cat.restrictedCode ? <span className="pt-ls">{t('fixedReceive')}</span> : null}</label>}
      </>
    );
    if (/주요 타겟/.test(name)) return <label className="fld"><span>{t('target')}</span><input className="pt-input" value={f.target} onChange={set('target')} placeholder={t('targetPh2')} /></label>;
    if (/자동 견적/.test(name)) return (
      <><p className="pt-ls">{t('mxHint')}</p>
        {cat.rows.length && cat.cols.length ? (
          <div className="pt-tw"><table className="pt-tb2 pt-mx"><thead><tr><th>{t('mxCorner')}</th>{cat.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
            <tbody>{cat.rows.map((r) => <tr key={r.key}><td><b>{r.label}</b></td>{cat.cols.map((c) => { const k = `${r.key}|${c.key}`; return <td key={k} className="num"><input className="pt-input" type="number" min={0} value={mx[k] ?? ''} onChange={(e) => setMx({ ...mx, [k]: e.target.value })} placeholder={t('manPh')} aria-label={t('manAria', { row: r.label, col: c.label })} /></td>; })}</tr>)}</tbody></table></div>
        ) : <p className="pt-ls">{t('noAxisShort')}</p>}</>
    );
    if (/확인비용/.test(name)) return (
      <><label className="fld"><span>{t('topFeeLblWiz')}{cat.baseFee ? ` — ${t('minBase', { amt: won(cat.baseFee) })}` : ''}</span>
        <input className="pt-input" type="number" min={cat.baseFee ?? 1} value={f.topFee} onChange={set('topFee')} placeholder={String(cat.baseFee ?? '')} style={{ maxWidth: 200 }} /></label>
        <p className="pt-ls">{t('topHint')}</p>
        <div className="pt-tw"><table className="pt-tb2"><thead><tr><th>{t('th.grade')}</th><th className="num">{t('th.rate')}</th><th className="num">{t('th.fee')}</th></tr></thead>
          <tbody>{rates.map((r) => <tr key={r.grade}><td><span className={`pt-gbadge g${r.label.replace(/[+\-]/, '')}`}>{r.label}</span></td><td className="num">{Math.round(r.rate * 100)}%</td><td className="num"><b>{won(Math.round(top * r.rate))}</b></td></tr>)}</tbody></table></div></>
    );
    if (/소개비|리워드/.test(name)) return (
      <div className="pt-row">
        <label>{t('refPctLblWiz')}<input className="pt-input" type="number" step="0.5" min={5} max={12} value={f.referralPct} onChange={set('referralPct')} style={{ width: 110 }} /></label>
        <label>{t('rebateLblWiz')}<input className="pt-input" type="number" min={0} value={f.rebateBonus} onChange={set('rebateBonus')} style={{ width: 140 }} /></label>
        <p className="pt-ls" style={{ flexBasis: '100%' }}>{t('refDirect')}</p>
      </div>
    );
    if (/상세 페이지|랜딩|심의 제출|상품정보/.test(name)) return (
      <>{blocks.map((b) => (
        <label key={b.kind} className="fld"><span>{b.label}</span>
          <textarea className="pt-input" rows={2} value={bl[b.kind] ?? ''} onChange={(e) => setBl({ ...bl, [b.kind]: e.target.value })} placeholder={t('blockPhWiz')} /></label>
      ))}
        {/랜딩/.test(name) && (
          <div className="pt-dsum"><div className="dr"><span>{t('svc')}</span><b>{f.title || '—'}</b></div><div className="dr"><span>{t('targetShort')}</span><b>{f.target || '—'}</b></div>
            <div className="dr"><span>{t('topFee')}</span><b>{won(top)}</b></div><div className="dr"><span>{t('mxCells')}</span><b>{t('cellsN', { n: String(Object.values(mx).filter(Boolean).length) })}</b></div></div>
        )}</>
    );
    return (
      <div className="pt-dsum">
        <div className="dr"><span>{t('cat')}</span><b>{cat.name}</b></div><div className="dr"><span>{t('form')}</span><b>{cat.formLabel}</b></div>
        <div className="dr"><span>{t('name')}</span><b>{f.title || t('titleMissing')}</b></div>
        <div className="dr"><span>{t('topFee')}</span><b>{won(top)}</b></div>
        <div className="dr"><span>{t('next')}</span><b>{t('nextVal')}</b></div>
      </div>
    );
  })();

  return (
    <div data-svc-wizard>
      <div className="pt-fset">
        <h3>{t('pickH')}</h3>
        <select className="pt-input" value={catId} onChange={(e) => { setCatId(e.target.value); setStep(0); setM(null); }} style={{ maxWidth: 360 }}>
          <option value="">{t('pickPh')}</option>
          {categories.map((c) => <option key={c.id} value={c.id} disabled={!c.form}>{c.name} — {c.form ? `${c.formLabel} · ${t('stepsN', { n: String(c.steps.length) })}` : t('noForm')}</option>)}
        </select>
      </div>
      {cat && (
        <div className="pt-fset">
          <h3>{cat.formLabel} {t('stepsN', { n: String(steps.length) })}</h3>
          <ol className="pt-steps-wiz">{steps.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : undefined}>{i + 1}. {s}</li>)}</ol>
          {view}
          <div className="pt-dact">
            {step > 0 && <button type="button" className="pt-bo" onClick={() => setStep(step - 1)}>{t('prev')}</button>}
            {step < steps.length - 1
              ? <button type="button" className="pt-bp" onClick={() => setStep(step + 1)} disabled={step === 0 && (!f.title.trim() || !f.body.trim())}>{t('nextBtn')}</button>
              : <button type="button" className="pt-bp" disabled={busy || !f.title.trim() || !f.body.trim()} onClick={() => void submit()}>{busy ? t('sending') : t('submit')}</button>}
          </div>
          <MsgP m={m} />
        </div>
      )}
    </div>
  );
}
