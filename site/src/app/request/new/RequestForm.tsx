'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AddressInput, EMPTY_ADDRESS, type AddressValue } from '@/components/AddressInput';
import { KakaoMap } from '@/components/map/KakaoMap';
import { CategoryBlock, Field, ImagePicker, MoneyInput, type Cat, type Gwan, type Img } from '@/components/form/RegParts';

interface Restriction { code: string; name: string; mode: string; legalBasis: string; gate: string | null; message: string }
interface CheckResult { allowed: boolean; blocked: Restriction[]; gated: Restriction[]; message: string | null }

/**
 * SB-HOM-REQ-010 소개받기 등록하기 — v10.31 시안 scReqNew 그대로 4구역:
 *   1 기본 정보(관 · 업종 · 등급 자동 · 제목 · 대표 이미지 · 상세 이미지) · 2 상세 내용 · 3 계약 조건(예상 소개비 · 문의 가능 시간 · 안내) ·
 *   4 지역 정보(우편번호 검색) · 유의사항 · 입력 지우기 / 등록완료.
 *   시안 소개받기 목록의 안내 띠(「요청마다 공개 범위를 고르게 했고 … 비공개 옵션」)가 뜻하는 칸 — 공개 범위 · 회사명 비공개 · 희망 예산(공개 여부) · 규모 —
 *   을 3구역 안에 둡니다(목록 · 상세 카드에 나오는 값).
 *
 * ── 제한업종을 미리 알려 줍니다(개발에만 있던 것 — 남김) ─────────────
 *   제목 · 내용을 쓰는 동안 서버(POST /restrictions/check)가 판정하고, 걸리면 근거 법령과 함께 보여 줍니다.
 *   검사가 실패(4xx · 네트워크)해도 등록을 막지 않습니다 — 서버가 등록 때 다시 봅니다. v10.30 까지는 4xx 응답을 그대로 넣어 쪽 오류가 났습니다(결함 하).
 */
export function RequestForm({ gwans, cats, gradeLabels, initialGwan }: {
  gwans: Gwan[]; cats: Cat[]; gradeLabels: Record<string, string>; initialGwan?: string;
}) {
  const router = useRouter();
  const t = useTranslations('forms');
  const [pending, start] = useTransition();
  const [gwan, setGwan] = useState(initialGwan ?? '');
  const [cat, setCat] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imgs, setImgs] = useState<Img[]>([]);
  const [fee, setFee] = useState('');
  const [hours, setHours] = useState('');
  const [bmin, setBmin] = useState('');
  const [bmax, setBmax] = useState('');
  const [budgetOpen, setBudgetOpen] = useState(true);
  const [qty, setQty] = useState('');
  const [vis, setVis] = useState<'ALL' | 'MEMBER' | 'VERIFIED'>('ALL');
  const [blind, setBlind] = useState(false);
  const [addr, setAddr] = useState<AddressValue>(EMPTY_ADDRESS);
  const [tried, setTried] = useState(false);
  const [chk, setChk] = useState<CheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const seq = useRef(0);

  /* 판정은 서버가 합니다. 화면에서 규칙을 다시 쓰지 않습니다 */
  useEffect(() => {
    const text = `${title} ${body}`.trim();
    const id = ++seq.current;
    if (text.length < 2 || !gwan) { setChk(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/restrictions/check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gwanCode: gwan, text }),
        });
        const j = await res.json().catch(() => null);
        if (id !== seq.current) return;
        setChk(res.ok && j && Array.isArray(j.blocked) && Array.isArray(j.gated) ? j : null);
      } catch { if (id === seq.current) setChk(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [title, body, gwan]);

  const blocked = !!chk && !chk.allowed;
  /* 빈 필수 칸 표시는 한 번 「등록완료」를 누른 뒤부터, 채우는 대로 사라집니다 */
  const miss = new Set(tried ? need().map((b) => b[0]) : []);
  const filled = [gwan, cat, title, body, fee, hours, addr.road, qty, bmin, bmax].filter((x) => String(x).trim()).length + imgs.length;

  function need(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    if (!gwan) out.push(['gwan', t('common.gwan')]);
    if (!cat) out.push(['cat', t('common.cat')]);
    if (title.trim().length < 5) out.push(['title', t('req.need.title')]);
    if (!body.trim()) out.push(['desc', t('req.desc')]);
    if (!fee) out.push(['fee', t('req.fee')]);
    if (!hours.trim()) out.push(['hours', t('common.hours')]);
    if (!addr.road.trim()) out.push(['addr', t('req.addr')]);
    return out;
  }

  function reset() {
    setGwan(initialGwan ?? ''); setCat(''); setTitle(''); setBody(''); setImgs([]); setFee(''); setHours('');
    setBmin(''); setBmax(''); setBudgetOpen(true); setQty(''); setVis('ALL'); setBlind(false); setAddr(EMPTY_ADDRESS);
    setTried(false); setErr(null); setChk(null);
  }

  async function submit() {
    const bad = need();
    setTried(true);
    if (bad.length) {
      setErr(t('common.missing', { n: String(bad.length), list: bad.slice(0, 3).map((b) => b[1]).join(' · '), more: bad.length > 3 ? t('common.missingMore', { n: String(bad.length - 3) }) : '' }));
      document.querySelector('.fmiss')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (bmin && bmax && Number(bmin) > Number(bmax)) { setErr(t('req.budgetOrder')); return; }
    if (blocked) { setErr(chk?.message ?? t('common.blockedMsg')); return; }
    setErr(null);
    const res = await fetch('/api/v1/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gwanCode: gwan, categoryId: cat, title: title.trim(), body: body.trim(),
        offeredFee: Number(fee), contactHours: hours.trim(),
        ...(bmin ? { budgetMin: Number(bmin) } : {}), ...(bmax ? { budgetMax: Number(bmax) } : {}),
        budgetOpen, companyBlind: blind, visibility: vis,
        ...(qty.trim() ? { quantity: qty.trim() } : {}),
        region: [addr.sido, addr.sigungu].filter(Boolean).join(' ') || undefined,
        address: { zip: addr.zipcode, road: addr.road, detail: addr.detail },
        imageKeys: imgs.map((i) => i.id),
      }),
    });
    const b = await res.json().catch(() => ({}));
    /* v10.31 (합침 · w6 D082) — 등록 일시 정지(422 POSTING_SUSPENDED · 풀리는 날 포함) · 제안 한도(422 PROPOSAL_QUOTA_EXCEEDED)는 서버 문장 그대로 */
    if (!res.ok) { setErr((b.message ?? t('common.regFail')) + (b.code === 'POSTING_SUSPENDED' ? t('common.suspended') : '')); return; }
    /* v10.26 (G-180) — 상세는 공개된 요청만 — 검수 대기면 접수 안내 */
    if (b.status === 'PUBLISHED') { start(() => router.push(`/request/${b.requestId}`)); return; }
    setQueued(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (queued) {
    return (
      <div className="w1-done" data-request-queued="">
        <div className="dic" aria-hidden="true">✓</div>
        <h1>{t('req.queued.title')}</h1>
        <p>{t.rich('req.queued.body', { br: () => <br />, b: (c) => <b>{c}</b> })}</p>
        <div className="w1-dact">
          <Link className="w1-jb p" href="/request">{t('req.queued.list')}</Link>
          <Link className="w1-jb o" href="/my">{t('req.queued.my')}</Link>
        </div>
      </div>
    );
  }

  const m = (k: string) => miss.has(k);
  return (
    <div className="w1-rgw" data-form="reqn">
      <div className="w1-rghd">
        <div><h1>{t('req.title')}</h1>
          <div className="rgs">{t('req.sub')}</div></div>
        <span className="req">{t('common.reqMark')}</span>
      </div>

      <section className="w1-fsec"><h2 className="fh3">{t('common.sec1')}</h2>
        <CategoryBlock gwans={gwans} cats={cats} gwan={gwan} cat={cat} gradeLabels={gradeLabels} miss={miss}
          onGwan={(g) => { setGwan(g); setCat(''); }} onCat={setCat} />
        <Field id="f-title" label={t('req.titleLabel')} req max={60} count={title.length} miss={m('title')}>
          <input id="f-title" className="w1-in" name="title" maxLength={60} placeholder={t('req.titlePh')} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <ImagePicker purpose="REQUEST_IMAGE" value={imgs} onChange={setImgs} kind="request" />
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('req.sec2')}</h2>
        <Field id="f-desc" label={t('req.desc')} req max={3000} count={body.length} miss={m('desc')}>
          <textarea id="f-desc" className="w1-in" name="body" rows={7} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={t('req.descPh')} />
        </Field>
        {blocked && (
          <div className="w1-jc e" data-restricted=""><span className="lb">{t('common.blocked')}</span>
            {chk?.message}{chk?.blocked.map((r) => <div key={r.code} className="w1-ls">{t('common.basis', { basis: r.legalBasis })}</div>)}</div>
        )}
        {chk && chk.allowed && chk.gated.length > 0 && (
          <div className="w1-jc w"><span className="lb">{t('req.gated')}</span>{chk.message}</div>
        )}
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('req.sec3')}</h2>
        <div className="w1-g3">
          <Field id="f-fee" label={t('req.fee')} req unit={t('common.won')} miss={m('fee')} hint={t('req.feeHint')}>
            <MoneyInput id="f-fee" value={fee} onChange={setFee} placeholder={t('common.feePh')} />
          </Field>
          <Field id="f-hours" label={t('common.hours')} req miss={m('hours')} hint={t('req.hoursHint')}>
            <input id="f-hours" className="w1-in" maxLength={60} placeholder={t('common.hoursPh')} value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          <div className="w1-fnote2"><span className="fi3" aria-hidden="true">👤</span><span><b>{t('req.infoTitle')}</b><p>{t('req.infoBody')}</p></span></div>
        </div>
        <div className="w1-g3">
          <Field id="f-bmin" label={t('req.bmin')} unit={t('common.won')}>
            <MoneyInput id="f-bmin" value={bmin} onChange={setBmin} placeholder={t('req.bminPh')} />
          </Field>
          <Field id="f-bmax" label={t('req.bmax')} unit={t('common.won')}>
            <MoneyInput id="f-bmax" value={bmax} onChange={setBmax} placeholder={t('req.bmaxPh')} />
          </Field>
          <Field id="f-qty" label={t('req.qty')} hint={t('req.qtyHint')}>
            <input id="f-qty" className="w1-in" maxLength={60} placeholder={t('req.qtyPh')} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>
        <div className="w1-g3">
          <Field label={t('req.vis')} hint={t('req.visHint')}>
            <div className="w1-seg" role="radiogroup" aria-label={t('req.vis')}>
              {(['ALL', 'MEMBER', 'VERIFIED'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={vis === k} className={vis === k ? 'on' : undefined} onClick={() => setVis(k)}>{t(`req.visOpt.${k}`)}</button>
              ))}
            </div>
          </Field>
          <Field label={t('req.blind')} hint={t('req.blindHint')}>
            <label className="w1-chk"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> {t('req.blindChk')}</label>
          </Field>
          <Field label={t('req.budgetOpen')} hint={t('req.budgetOpenHint')}>
            <label className="w1-chk"><input type="checkbox" checked={budgetOpen} onChange={(e) => setBudgetOpen(e.target.checked)} /> {t('req.budgetOpenChk')}</label>
          </Field>
        </div>
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('common.sec4')}</h2>
        <div className={m('addr') ? 'fmiss' : undefined}>
          <AddressInput value={addr} onChange={setAddr} required label={t('req.addr')} />
          {m('addr') && <div className="fmsg">{t('common.required')}</div>}
        </div>
        {/* v10.46 (docs/96) — 지도 사용이 켜져 있으면 희망 지역(시 · 구) 둘레 원 미리보기 · 저장하지 않음. 아니면 지금 칸 그대로 */}
        <KakaoMap previewAddress={[addr.sido, addr.sigungu].filter(Boolean).join(' ')} previewPrecision="REGION" height={160}
          caption={<>{t.rich('req.mapCaption', { b: (c) => <b>{c}</b>, region: [addr.sido, addr.sigungu].filter(Boolean).join(' ') })}</>}
          fallback={
        <div className="w1-rmap" aria-live="polite">
          <div className="rmc"><span className="pin" aria-hidden="true">📍</span>
            {addr.road ? <><b>{[addr.sido, addr.sigungu].filter(Boolean).join(' ')}</b><br />{t('req.cityOnly')}</>
              : <>{t.rich('req.mapEmpty', { br: () => <br /> })}</>}
          </div>
        </div>} />
        <div className="w1-ls" style={{ marginTop: 6 }}>{t('req.mapNote')}</div>
      </section>

      <div className="w1-fend">
        <div className="fw"><b>{t('common.notice')}</b>
          <span><i>✓</i>{t('req.n1')}</span>
          <span><i>✓</i>{t('common.noFalse')}</span>
          <span><i>✓</i>{t('req.n3')}</span>
          <span className="w1-ls">{t('req.filled', { n: String(filled) })}</span>
        </div>
        <div className="fbtns">
          <button type="button" className="bcan" onClick={reset}>{t('req.reset')}</button>
          <button type="button" className="bok" onClick={() => void submit()} disabled={pending} data-fdone="reqn">{pending ? t('common.submitting') : t('common.done')}</button>
        </div>
      </div>
      {err && <p className="w1-err" role="alert" style={{ textAlign: 'right' }}>{err}</p>}
    </div>
  );
}
