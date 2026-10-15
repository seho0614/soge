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

const won = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('ko-KR')}원`;
type Msg = ['ok' | 'err', string] | null;
const MsgP = ({ m }: { m: Msg }) => (m ? <p className={`pt-msg ${m[0]}`} role="status">{m[1]}</p> : null);

/* ── 수정 · 노출 중단 · 재개 ─────────────────────────────────────────── */
export function ServiceActions({ id, title, body, target, receiveMode, topFee, referralRate, rebateBonus, baseFee, canEdit, canSuspend, canResume, status }: {
  id: string; title: string; body: string | null; target: string | null; receiveMode: string | null;
  topFee: number | null; referralRate: number | null; rebateBonus: number | null; baseFee: number | null;
  canEdit: boolean; canSuspend: boolean; canResume: boolean; status: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title, body: body ?? '', target: target ?? '', receiveMode: receiveMode ?? '',
    topFee: topFee ?? '', referralPct: referralRate != null ? Math.round(referralRate * 1000) / 10 : '', rebateBonus: rebateBonus ?? '' } as Record<string, string | number>);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    const content = f.title !== title || f.body !== (body ?? '') || f.target !== (target ?? '') || f.receiveMode !== (receiveMode ?? '');
    if (content && status === 'APPROVED' && !confirm('고친 내용은 재검수 대상입니다 — 승인될 때까지 검수중으로 내려가고 그동안 리드가 오지 않습니다. 저장할까요?')) return;
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
    if (kind === 'suspend' && !confirm('노출을 멈추면 신규 리드만 막히고 진행 중 상담은 그대로 갑니다. 멈출까요?')) return;
    setBusy(true); setM(null);
    try { const r = await api<{ note: string }>('POST', `/partner/services/${id}/${kind}`, {}); setM(['ok', r.note]); router.refresh(); }
    catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  return (
    <div data-svc-actions>
      <div className="pt-dact">
        {canEdit && <button type="button" className="pt-bo" onClick={() => setOpen(!open)}>서비스 수정</button>}
        {canSuspend && <button type="button" className="pt-bo" disabled={busy} onClick={() => void act('suspend')}>노출 중단</button>}
        {canResume && <button type="button" className="pt-bp" disabled={busy} onClick={() => void act('resume')}>노출 재개</button>}
      </div>
      {open && (
        <div className="pt-fset">
          <h3>서비스 수정</h3>
          <label className="fld"><span>서비스명</span><input className="pt-input" value={String(f.title)} onChange={set('title')} /></label>
          <label className="fld"><span>설명</span><textarea className="pt-input" rows={5} value={String(f.body)} onChange={set('body')} /></label>
          <label className="fld"><span>주요 타겟</span><input className="pt-input" value={String(f.target)} onChange={set('target')} placeholder="예: 서울 가정 이사 · 사무실 이전" /></label>
          <label className="fld"><span>접수 방식</span>
            <select className="pt-input" value={String(f.receiveMode)} onChange={set('receiveMode')}>
              <option value="">정하지 않음</option><option value="QUOTE">견적 요청</option><option value="CALL">전화 상담</option>
              <option value="VISIT">방문 상담</option><option value="CHAT">채팅 상담</option>
            </select></label>
          <div className="pt-row">
            <label>최고 확인비용(S · 원){baseFee ? ` — 업종 기준 ${won(baseFee)} 이상` : ''}
              <input className="pt-input" type="number" value={String(f.topFee)} onChange={set('topFee')} style={{ width: 130 }} /></label>
            <label>성사 소개비(%) — 5 ~ 12
              <input className="pt-input" type="number" step="0.5" value={String(f.referralPct)} onChange={set('referralPct')} style={{ width: 100 }} /></label>
            <label>재소개 보너스(건당 원)
              <input className="pt-input" type="number" value={String(f.rebateBonus)} onChange={set('rebateBonus')} style={{ width: 130 }} /></label>
          </div>
          <p className="pt-ls">확인비용 · 소개비만 바꾸면 노출은 그대로이고, 이름 · 설명 · 타겟 · 접수 방식을 바꾸면 재검수됩니다.</p>
          <div className="pt-dact"><button type="button" className="pt-bp" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '저장'}</button>
            <button type="button" className="pt-bo" onClick={() => setOpen(false)}>닫기</button></div>
        </div>
      )}
      <MsgP m={m} />
    </div>
  );
}

/* ── 상세페이지 블록 ─────────────────────────────────────────────────── */
export function BlockEditor({ id, kind, label, body, fileId }: { id: string; kind: string; label: string; body: string | null; fileId: string | null }) {
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
      setM(['ok', clear ? '블록을 비웠습니다.' : '저장했습니다.']); setOpen(false); router.refresh();
    } catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setM(null);
    try { const u = await uploadFile(f, 'PARTNER_MEDIA'); setFile(u.fileId); setM(['ok', `${u.name} 올림 — 저장을 누르십시오.`]); }
    catch (x) { setM(['err', (x as Error).message]); } finally { setBusy(false); }
  }
  return (
    <span data-block={kind}>
      {!open ? <button type="button" className="pt-bo sm" onClick={() => setOpen(true)}>{body || fileId ? '고치기' : '채우기'}</button> : (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
          {kind === 'HERO_IMAGE' || kind === 'CASES'
            ? <input type="file" accept="image/jpeg,image/png" onChange={(e) => void pick(e)} disabled={busy} /> : null}
          <textarea className="pt-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${label} — 전화번호는 적지 마십시오`} />
          <span className="pt-row">
            <button type="button" className="pt-bp sm" disabled={busy} onClick={() => void save()}>저장</button>
            {(body || fileId) && <button type="button" className="pt-bo sm" disabled={busy} onClick={() => void save(true)}>비우기</button>}
            <button type="button" className="pt-bo sm" onClick={() => setOpen(false)}>닫기</button>
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
  const router = useRouter();
  const init = useMemo(() => Object.fromEntries(cells.map((c) => [`${c.row}|${c.col}`, String(Math.round(c.amount / 10000))])), [cells]);
  const [v, setV] = useState<Record<string, string>>(init);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  async function save() {
    if (!id) return;
    setBusy(true); setM(null);
    const out = rows.flatMap((r) => cols.map((c) => ({ row: r.key, col: c.key, amount: v[`${r.key}|${c.key}`] ? Math.round(Number(v[`${r.key}|${c.key}`]) * 10000) : null })));
    try { const r = await api<{ cells: number }>('PUT', `/partner/services/${id}/matrix`, { cells: out }); setM(['ok', `${r.cells}칸을 저장했습니다.`]); router.refresh(); }
    catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  if (!rows.length || !cols.length) return <p className="pt-ls">이 업종은 견적 구간(축)이 아직 정해지지 않았습니다 — 업종 마스터는 본사가 정합니다.</p>;
  return (
    <div data-matrix>
      <div className="pt-tw">
        <table className="pt-tb2 pt-mx">
          <thead><tr><th>이사유형 \ 물량</th>{cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><td><b>{r.label}</b></td>
                {cols.map((c) => {
                  const k = `${r.key}|${c.key}`;
                  return <td key={k} className="num">{readOnly ? (v[k] ? `${v[k]}만원` : '—')
                    : <input className="pt-input" type="number" min={0} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder="만원" aria-label={`${r.label} ${c.label} 만원`} />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && id && <div className="pt-dact"><button type="button" className="pt-bp" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '매트릭스 저장'}</button><span className="pt-ls">단위 만원 · 빈 칸은 「견적 문의」로 보입니다</span></div>}
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
        <label className="fld"><span>서비스명</span><input className="pt-input" value={f.title} onChange={set('title')} placeholder={isMatrix ? '예: 한빛 포장이사 · 서울 전지역' : '예: 사무실 입주청소'} /></label>
        <label className="fld"><span>설명</span><textarea className="pt-input" rows={5} value={f.body} onChange={set('body')} placeholder="어떤 일을 하시는지, 어떤 요청을 받고 싶으신지" /></label>
        {!isMatrix && <label className="fld"><span>접수 방식</span>
          <select className="pt-input" value={f.receiveMode} onChange={set('receiveMode')} disabled={!!cat.restrictedCode}>
            <option value="QUOTE">견적 요청</option><option value="CALL">전화 상담</option><option value="VISIT">방문 상담</option><option value="CHAT">채팅 상담</option>
          </select>{cat.restrictedCode ? <span className="pt-ls">규제 업종은 접수 방식이 고정됩니다(보험업법 · 의료법 제27조).</span> : null}</label>}
      </>
    );
    if (/주요 타겟/.test(name)) return <label className="fld"><span>주요 타겟</span><input className="pt-input" value={f.target} onChange={set('target')} placeholder="예: 서울 · 경기 남부 가정 이사, 쓰리룸 이상" /></label>;
    if (/자동 견적/.test(name)) return (
      <><p className="pt-ls">이사유형 × 물량 칸에 기본 견적(만원)을 넣습니다 — 축은 업종 마스터(본사)가 정합니다.</p>
        {cat.rows.length && cat.cols.length ? (
          <div className="pt-tw"><table className="pt-tb2 pt-mx"><thead><tr><th>이사유형 \ 물량</th>{cat.cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
            <tbody>{cat.rows.map((r) => <tr key={r.key}><td><b>{r.label}</b></td>{cat.cols.map((c) => { const k = `${r.key}|${c.key}`; return <td key={k} className="num"><input className="pt-input" type="number" min={0} value={mx[k] ?? ''} onChange={(e) => setMx({ ...mx, [k]: e.target.value })} placeholder="만원" aria-label={`${r.label} ${c.label} 만원`} /></td>; })}</tr>)}</tbody></table></div>
        ) : <p className="pt-ls">이 업종은 견적 구간이 아직 정해지지 않았습니다.</p>}</>
    );
    if (/확인비용/.test(name)) return (
      <><label className="fld"><span>최고 확인비용(S 등급 · 원){cat.baseFee ? ` — 업종 기준 ${won(cat.baseFee)} 이상` : ''}</span>
        <input className="pt-input" type="number" min={cat.baseFee ?? 1} value={f.topFee} onChange={set('topFee')} placeholder={String(cat.baseFee ?? '')} style={{ maxWidth: 200 }} /></label>
        <p className="pt-ls">최고 확인비용 하나만 정하면 8등급이 자동으로 채워집니다.</p>
        <div className="pt-tw"><table className="pt-tb2"><thead><tr><th>등급</th><th className="num">비율</th><th className="num">확인비용</th></tr></thead>
          <tbody>{rates.map((r) => <tr key={r.grade}><td><span className={`pt-gbadge g${r.label.replace(/[+\-]/, '')}`}>{r.label}</span></td><td className="num">{Math.round(r.rate * 100)}%</td><td className="num"><b>{won(Math.round(top * r.rate))}</b></td></tr>)}</tbody></table></div></>
    );
    if (/소개비|리워드/.test(name)) return (
      <div className="pt-row">
        <label>성사 소개비(거래액의 %) — 협의 구간 5 ~ 12<input className="pt-input" type="number" step="0.5" min={5} max={12} value={f.referralPct} onChange={set('referralPct')} style={{ width: 110 }} /></label>
        <label>재소개 보너스(건당 원 · 3개월 내 재계약)<input className="pt-input" type="number" min={0} value={f.rebateBonus} onChange={set('rebateBonus')} style={{ width: 140 }} /></label>
        <p className="pt-ls" style={{ flexBasis: '100%' }}>소개비는 당사자끼리 직접 주고받습니다 — 회사를 거치지 않습니다(이용약관 제3조).</p>
      </div>
    );
    if (/상세 페이지|랜딩|심의 제출|상품정보/.test(name)) return (
      <>{blocks.map((b) => (
        <label key={b.kind} className="fld"><span>{b.label}</span>
          <textarea className="pt-input" rows={2} value={bl[b.kind] ?? ''} onChange={(e) => setBl({ ...bl, [b.kind]: e.target.value })} placeholder="비워 두면 「비어 있음」 — 전화번호는 적지 마십시오" /></label>
      ))}
        {/랜딩/.test(name) && (
          <div className="pt-dsum"><div className="dr"><span>서비스</span><b>{f.title || '—'}</b></div><div className="dr"><span>타겟</span><b>{f.target || '—'}</b></div>
            <div className="dr"><span>최고 확인비용</span><b>{won(top)}</b></div><div className="dr"><span>견적 칸</span><b>{Object.values(mx).filter(Boolean).length}칸</b></div></div>
        )}</>
    );
    return (
      <div className="pt-dsum">
        <div className="dr"><span>업종</span><b>{cat.name}</b></div><div className="dr"><span>등록 방식</span><b>{cat.formLabel}</b></div>
        <div className="dr"><span>서비스명</span><b>{f.title || '— (첫 단계에서 적어 주십시오)'}</b></div>
        <div className="dr"><span>최고 확인비용</span><b>{won(top)}</b></div>
        <div className="dr"><span>다음</span><b>본사 검수 — 승인 전에는 리드가 오지 않습니다</b></div>
      </div>
    );
  })();

  return (
    <div data-svc-wizard>
      <div className="pt-fset">
        <h3>1. 업종 고르기 — 업종이 등록 화면을 정합니다</h3>
        <select className="pt-input" value={catId} onChange={(e) => { setCatId(e.target.value); setStep(0); setM(null); }} style={{ maxWidth: 360 }}>
          <option value="">업종을 고르십시오</option>
          {categories.map((c) => <option key={c.id} value={c.id} disabled={!c.form}>{c.name} — {c.form ? `${c.formLabel} · ${c.steps.length}단계` : '폼 유형 미지정(등록 불가)'}</option>)}
        </select>
      </div>
      {cat && (
        <div className="pt-fset">
          <h3>{cat.formLabel} {steps.length}단계</h3>
          <ol className="pt-steps-wiz">{steps.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : undefined}>{i + 1}. {s}</li>)}</ol>
          {view}
          <div className="pt-dact">
            {step > 0 && <button type="button" className="pt-bo" onClick={() => setStep(step - 1)}>이전</button>}
            {step < steps.length - 1
              ? <button type="button" className="pt-bp" onClick={() => setStep(step + 1)} disabled={step === 0 && (!f.title.trim() || !f.body.trim())}>다음</button>
              : <button type="button" className="pt-bp" disabled={busy || !f.title.trim() || !f.body.trim()} onClick={() => void submit()}>{busy ? '보내는 중…' : '등록 신청(검수 요청)'}</button>}
          </div>
          <MsgP m={m} />
        </div>
      )}
    </div>
  );
}
