'use client';
/**
 * SB-HOM-REG-010 상품/서비스 등록하기 — v10.31 시안 reg() 그대로 5구역:
 *   1 기본 정보(관 · 업종 · 등급 자동 · 상품/서비스명 · 한줄 소개 · 대표 · 상세 이미지)
 *   2 상품/서비스 상세 설명
 *   3 소개 조건(소개비 · 계약 지원 · 문의 가능 시간 · 부담 주체 자동)
 *   4 지역 정보(소재지 주소 — 우편번호 검색)
 *   5 거래 및 운영 정보(매장 · 설비 규모 · 월매출 · 권리금 · 희망조건 · 인수지원 · 기타 지원 사항)
 *   + 유의사항 · 등록취소 / 등록완료.
 * 보내는 곳: POST /listings(검수 큐) — 새 칸(summary · contractSupport · contactHours · address · bizInfo · mediaKeys)은 D046 · D049 의 칸.
 * 부담 주체는 관마다 고정(시안 BEARER) — 서버 값은 업종의 기본값(대개 SELLER).
 * 제한업종 미리 검사는 개발에만 있던 것 — 남깁니다(POST /restrictions/check · 실패해도 막지 않음).
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AddressInput, EMPTY_ADDRESS, type AddressValue } from '@/components/AddressInput';
import { KakaoMap } from '@/components/map/KakaoMap';
import { CategoryBlock, Field, ImagePicker, MoneyInput, type Cat, type Gwan, type Img } from '@/components/form/RegParts';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

/* v10.101 (2-5b) — 고르기 값(서버로 보내는 글자)은 한국어 그대로 · 보이는 글자는 사전 forms.reg.support · wish · handover · bearer */
const SUPPORT = [['계약서 검토 지원', 'contract'], ['세무 · 회계 지원', 'tax'], ['인수 인계 지원', 'handover'], ['교육 지원', 'edu'], ['지원 없음', 'none']] as const;
const WISH = [['즉시 인계 희망', 'now'], ['협의 후 결정', 'nego'], ['3개월 내', 'm3'], ['6개월 내', 'm6'], ['기한 없음', 'none']] as const;
const HANDOVER = [['운영 교육 지원', 'edu'], ['거래처 승계', 'clients'], ['직원 승계', 'staff'], ['설비 · 집기 포함', 'equip'], ['지원 없음', 'none']] as const;
const BEARER = ['MNY', 'MAL', 'BIZ'] as const;
const isBearer = (g: string): g is (typeof BEARER)[number] => (BEARER as readonly string[]).includes(g);

interface CheckResult { allowed: boolean; blocked: Array<{ code: string; legalBasis: string }>; gated: unknown[]; message: string | null }

export function RegisterForm({ gwans, cats, gradeLabels, initialGwan }: {
  gwans: Gwan[]; cats: Cat[]; gradeLabels: Record<string, string>; initialGwan?: string;
}) {
  const router = useRouter();
  const t = useTranslations('forms');
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({
    gwan: initialGwan ?? '', cat: '', title: '', intro: '', desc: '', fee: '', support: '', hours: '',
    size: '', sales: '', premium: '', wish: '', handover: '', etc: '',
  });
  const [imgs, setImgs] = useState<Img[]>([]);
  const [addr, setAddr] = useState<AddressValue>(EMPTY_ADDRESS);
  const [miss, setMiss] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [chk, setChk] = useState<CheckResult | null>(null);
  const seq = useRef(0);
  const set = (k: keyof typeof v) => (x: string) => { setV((o) => ({ ...o, [k]: x })); if (miss.has(k)) setMiss((m) => { const n = new Set(m); n.delete(k); return n; }); };
  const on = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k)(e.target.value);

  useEffect(() => {
    const text = `${v.title} ${v.intro} ${v.desc}`.trim();
    const id = ++seq.current;
    if (text.length < 2 || !v.gwan) { setChk(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/v1/restrictions/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gwanCode: v.gwan, text }) });
        const j = await r.json().catch(() => null);
        if (id === seq.current) setChk(r.ok && j && Array.isArray(j.blocked) ? j : null);
      } catch { if (id === seq.current) setChk(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [v.title, v.intro, v.desc, v.gwan]);

  const NEED: Array<[keyof typeof v | 'addr', string]> = [['gwan', t('common.gwan')], ['cat', t('common.cat')], ['title', t('reg.name')], ['intro', t('reg.intro')],
    ['desc', t('reg.desc')], ['fee', t('reg.fee')], ['support', t('reg.supportLabel')], ['hours', t('common.hours')], ['sales', t('reg.sales')], ['wish', t('reg.wishLabel')], ['addr', t('addr.label')]];

  async function submit() {
    const bad = NEED.filter(([k]) => (k === 'addr' ? !addr.road.trim() : !String(v[k]).trim()));
    if (v.title.trim() && v.title.trim().length < 5 && !bad.some(([k]) => k === 'title')) bad.push(['title', t('reg.need.title')]);
    setMiss(new Set(bad.map((b) => b[0])));
    if (bad.length) {
      setErr(t('common.missing', { n: String(bad.length), list: bad.slice(0, 3).map((b) => b[1]).join(' · '), more: bad.length > 3 ? t('common.missingMore', { n: String(bad.length - 3) }) : '' }));
      setTimeout(() => document.querySelector('.fmiss')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      return;
    }
    if (chk && !chk.allowed) { setErr(chk.message ?? t('common.blockedMsg')); return; }
    setErr(null); setBusy(true);
    const c = cats.find((x) => x.id === v.cat);
    const biz = Object.fromEntries((['size', 'sales', 'premium', 'wish', 'handover', 'etc'] as const).map((k) => [k, v[k].trim()]).filter(([, x]) => x));
    try {
      const r = await fetch('/api/v1/listings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gwanCode: v.gwan, categoryId: v.cat, title: v.title.trim(), summary: v.intro.trim(), body: v.desc.trim(),
          desiredFee: Number(v.fee), feeBearer: c?.feeBearer || 'SELLER', contractSupport: v.support, contactHours: v.hours.trim(),
          address: { zip: addr.zipcode, road: addr.road, detail: addr.detail, sido: addr.sido, sigungu: addr.sigungu },
          bizInfo: biz, mediaKeys: imgs.map((i) => i.id),
        }),
      });
      const d = await r.json().catch(() => ({}));
      /* v10.31 (합침 · w6 D082) — 등록 일시 정지(422 POSTING_SUSPENDED)는 서버 문장(풀리는 날 포함) 그대로 + 고객센터 안내 */
      if (!r.ok) { setErr((d.message ?? t('common.regFail')) + (d.code === 'POSTING_SUSPENDED' ? t('common.suspended') : '')); setBusy(false); return; }
      router.push(d?.autoApproved ? '/my/listings?published=1' : '/my/listings?review=1');
    } catch { setErr(t('common.regFailRetry')); setBusy(false); }
  }

  const m = (k: string) => miss.has(k);
  return (
    <div className="w1-rgw w1-rgw-reg" data-form="reg">{/* v10.32 — 시안 폭(가운데 좁은 폭을 뺌) · 등록완료 주황 · 지도 자리 · 입력 칸 수 띠 */}
      <div className="w1-rghd">
        <div><h1>{t('reg.title')}</h1>
          <div className="rgs">{t('reg.sub')}</div></div>
        <span className="req">{t('common.reqMark')}</span>
      </div>

      <section className="w1-fsec"><h2 className="fh3">{t('common.sec1')}</h2>
        <CategoryBlock gwans={gwans} cats={cats} gwan={v.gwan} cat={v.cat} gradeLabels={gradeLabels} miss={miss}
          onGwan={(g) => setV((o) => ({ ...o, gwan: g, cat: '' }))} onCat={set('cat')} />
        <div className="w1-g2">
          <Field id="f-title" label={t('reg.name')} req max={50} count={v.title.length} miss={m('title')}>
            <input id="f-title" className="w1-in" name="title" maxLength={50} placeholder={t('reg.namePh')} value={v.title} onChange={on('title')} />
          </Field>
          <Field id="f-intro" label={t('reg.intro')} req max={60} count={v.intro.length} miss={m('intro')}>
            <input id="f-intro" className="w1-in" name="summary" maxLength={60} placeholder={t('reg.introPh')} value={v.intro} onChange={on('intro')} />
          </Field>
        </div>
        <ImagePicker purpose="LISTING_IMAGE" value={imgs} onChange={setImgs} />
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('reg.sec2')}</h2>
        <Field id="f-desc" label={t('reg.desc')} req max={3000} count={v.desc.length} miss={m('desc')}
          hint={t('reg.descHint')}>
          <textarea id="f-desc" className="w1-in" name="body" rows={7} maxLength={3000} value={v.desc} onChange={on('desc')}
            placeholder={t('reg.descPh')} />
        </Field>
        {chk && !chk.allowed && (
          <div className="w1-jc e" data-restricted=""><span className="lb">{t('common.blocked')}</span>{chk.message}
            {chk.blocked.map((r) => <div key={r.code} className="w1-ls">{t('common.basis', { basis: r.legalBasis })}</div>)}</div>
        )}
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('reg.sec3')}</h2>
        <div className="w1-g3">
          <Field id="f-fee" label={t('reg.fee')} req unit={t('common.won')} miss={m('fee')}
            hint={<>{withCodes(t.rich('reg.feeHint', { b: (c) => <b>{c}</b> }))}</>}>
            <MoneyInput id="f-fee" value={v.fee} onChange={set('fee')} placeholder={t('common.feePh')} />
          </Field>
          <Field id="f-support" label={t('reg.supportLabel')} req miss={m('support')} hint={<>{t.rich('reg.supportHint', { b: (c) => <b>{c}</b> })}</>}>
            <select id="f-support" className="w1-in" value={v.support} onChange={on('support')}>
              <option value="">{t('reg.pick')}</option>{SUPPORT.map(([x, k]) => <option key={x} value={x}>{t(`reg.support.${k}`)}</option>)}
            </select>
          </Field>
          <Field id="f-hours" label={t('common.hours')} req miss={m('hours')} hint={t('reg.hoursHint')}>
            <input id="f-hours" className="w1-in" maxLength={60} placeholder={t('common.hoursPh')} value={v.hours} onChange={on('hours')} />
          </Field>
        </div>
        <Field label={t('reg.bearerLabel')} auto hint={t('reg.bearerHint')}>
          <div className={`w1-in gradebox${v.gwan ? ' on' : ''}`}>{v.gwan ? (isBearer(v.gwan) ? t(`reg.bearer.${v.gwan}`) : t('reg.bearer.default')) : t('reg.bearerEmpty')}</div>
        </Field>
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('common.sec4')}</h2>
        <div className={m('addr') ? 'fmiss' : undefined}>
          <AddressInput value={addr} onChange={(a) => { setAddr(a); if (miss.has('addr')) setMiss((s) => { const n = new Set(s); n.delete('addr'); return n; }); }} required label={t('reg.addr')} />
          {m('addr') && <div className="fmsg">{t('common.required')}</div>}
        </div>
        <div className="w1-ls" style={{ marginTop: 6 }}>{t('reg.addrNote')}</div>
        {/* v10.46 (docs/96) — 지도 사용이 켜져 있고 키가 있으면 미리보기 핀(브라우저에서만 · 저장하지 않음). 아니면 지금 안내 그대로(fallback) */}
        <KakaoMap previewAddress={addr.road} height={220}
          caption={<>{t('reg.mapCaption', { region: [addr.sido, addr.sigungu].filter(Boolean).join(' ') })}</>}
          fallback={
        <div className="w1-mapph" data-reg-map=""><span aria-hidden="true">📍</span>
          <div>{addr.road ? <><b>{addr.road}</b><br />{t('reg.mapLater')}</> : <>{t.rich('reg.mapEmpty', { br: () => <br /> })}</>}</div></div>} />
      </section>

      <section className="w1-fsec"><h2 className="fh3">{t('reg.sec5')}</h2>
        <div className="w1-g3">
          <Field id="f-size" label={t('reg.size')}><input id="f-size" className="w1-in" maxLength={40} placeholder={t('reg.sizePh')} value={v.size} onChange={on('size')} /></Field>
          <Field id="f-sales" label={t('reg.sales')} req miss={m('sales')}><input id="f-sales" className="w1-in" maxLength={40} placeholder={t('reg.salesPh')} value={v.sales} onChange={on('sales')} /></Field>
          <Field id="f-premium" label={t('reg.premium')}><input id="f-premium" className="w1-in" maxLength={40} placeholder={t('reg.premiumPh')} value={v.premium} onChange={on('premium')} /></Field>
        </div>
        <div className="w1-g3">
          <Field id="f-wish" label={t('reg.wishLabel')} req miss={m('wish')}>
            <select id="f-wish" className="w1-in" value={v.wish} onChange={on('wish')}><option value="">{t('reg.pick')}</option>{WISH.map(([x, k]) => <option key={x} value={x}>{t(`reg.wish.${k}`)}</option>)}</select>
          </Field>
          <Field id="f-handover" label={t('reg.handoverLabel')}>
            <select id="f-handover" className="w1-in" value={v.handover} onChange={on('handover')}><option value="">{t('reg.pick')}</option>{HANDOVER.map(([x, k]) => <option key={x} value={x}>{t(`reg.handover.${k}`)}</option>)}</select>
          </Field>
          <Field id="f-etc" label={t('reg.etc')}><input id="f-etc" className="w1-in" maxLength={60} placeholder={t('reg.etcPh')} value={v.etc} onChange={on('etc')} /></Field>
        </div>
        <div className="w1-ls">{t.rich('reg.sec5Note', { b: (c) => <b>{c}</b> })}</div>
      </section>

      <div className="w1-nt" data-reg-filled="" style={{ margin: '0 0 12px' }}>{t.rich('reg.filled', { b: (c) => <b>{c}</b>, n: String(Object.values(v).filter((x) => x.trim()).length + (addr.road ? 1 : 0) + (imgs.length ? 1 : 0)) })}</div>
      <div className="w1-fend">
        <div className="fw"><b>{t('common.notice')}</b>
          <span><i>✓</i>{t('reg.n1')}</span>
          <span><i>✓</i>{t('common.noFalse')}</span>
          <span><i>✓</i>{t('reg.n3')}</span>
        </div>
        <div className="fbtns">
          <button type="button" className="bcan" onClick={() => router.back()}>{t('reg.cancel')}</button>
          <button type="button" className="bok" disabled={busy} onClick={() => void submit()} data-fdone="reg">{busy ? t('common.submitting') : t('common.done')}</button>
        </div>
      </div>
      {err && <p className="w1-err" role="alert" style={{ textAlign: 'right' }}>{err}</p>}
    </div>
  );
}
