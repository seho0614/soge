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
import { AddressInput, EMPTY_ADDRESS, type AddressValue } from '@/components/AddressInput';
import { KakaoMap } from '@/components/map/KakaoMap';
import { CategoryBlock, Field, ImagePicker, MoneyInput, type Cat, type Gwan, type Img } from '@/components/form/RegParts';

const SUPPORT = ['계약서 검토 지원', '세무 · 회계 지원', '인수 인계 지원', '교육 지원', '지원 없음'];
const WISH = ['즉시 인계 희망', '협의 후 결정', '3개월 내', '6개월 내', '기한 없음'];
const HANDOVER = ['운영 교육 지원', '거래처 승계', '직원 승계', '설비 · 집기 포함', '지원 없음'];
const BEARER: Record<string, string> = { MNY: '공급 기업 부담', MAL: '양도인 · 매도인 부담', BIZ: '양도인 · 본사 부담' };

interface CheckResult { allowed: boolean; blocked: Array<{ code: string; legalBasis: string }>; gated: unknown[]; message: string | null }

export function RegisterForm({ gwans, cats, gradeLabels, initialGwan }: {
  gwans: Gwan[]; cats: Cat[]; gradeLabels: Record<string, string>; initialGwan?: string;
}) {
  const router = useRouter();
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

  const NEED: Array<[keyof typeof v | 'addr', string]> = [['gwan', '관'], ['cat', '업종'], ['title', '상품/서비스명'], ['intro', '한줄 소개'],
    ['desc', '상세 설명'], ['fee', '소개비'], ['support', '계약 지원'], ['hours', '문의 가능 시간'], ['sales', '월매출'], ['wish', '희망조건'], ['addr', '주소']];

  async function submit() {
    const bad = NEED.filter(([k]) => (k === 'addr' ? !addr.road.trim() : !String(v[k]).trim()));
    if (v.title.trim() && v.title.trim().length < 5 && !bad.some(([k]) => k === 'title')) bad.push(['title', '상품/서비스명(5자 이상)']);
    setMiss(new Set(bad.map((b) => b[0])));
    if (bad.length) {
      setErr(`아직 비어 있는 필수 항목이 ${bad.length}개 있습니다 — ${bad.slice(0, 3).map((b) => b[1]).join(' · ')}${bad.length > 3 ? ` 외 ${bad.length - 3}개` : ''}`);
      setTimeout(() => document.querySelector('.fmiss')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      return;
    }
    if (chk && !chk.allowed) { setErr(chk.message ?? '이 분야는 등록하실 수 없습니다.'); return; }
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
      if (!r.ok) { setErr((d.message ?? '등록하지 못했습니다.') + (d.code === 'POSTING_SUSPENDED' ? ' — 풀리는 날 전에 등록하려면 고객센터로 문의해 주십시오.' : '')); setBusy(false); return; }
      router.push(d?.autoApproved ? '/my/listings?published=1' : '/my/listings?review=1');
    } catch { setErr('등록하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); setBusy(false); }
  }

  const m = (k: string) => miss.has(k);
  return (
    <div className="w1-rgw w1-rgw-reg" data-form="reg">{/* v10.32 — 시안 폭(가운데 좁은 폭을 뺌) · 등록완료 주황 · 지도 자리 · 입력 칸 수 띠 */}
      <div className="w1-rghd">
        <div><h1>상품/서비스 등록하기</h1>
          <div className="rgs">소개할 상품/서비스의 정보를 정확하게 입력해주세요.</div></div>
        <span className="req">* 필수 입력 항목</span>
      </div>

      <section className="w1-fsec"><h2 className="fh3">1. 기본 정보</h2>
        <CategoryBlock gwans={gwans} cats={cats} gwan={v.gwan} cat={v.cat} gradeLabels={gradeLabels} miss={miss}
          onGwan={(g) => setV((o) => ({ ...o, gwan: g, cat: '' }))} onCat={set('cat')} />
        <div className="w1-g2">
          <Field id="f-title" label="상품/서비스명" req max={50} count={v.title.length} miss={m('title')}>
            <input id="f-title" className="w1-in" name="title" maxLength={50} placeholder="상품/서비스명을 입력해주세요" value={v.title} onChange={on('title')} />
          </Field>
          <Field id="f-intro" label="한줄 소개" req max={60} count={v.intro.length} miss={m('intro')}>
            <input id="f-intro" className="w1-in" name="summary" maxLength={60} placeholder="상품/서비스를 한 줄로 소개해주세요" value={v.intro} onChange={on('intro')} />
          </Field>
        </div>
        <ImagePicker purpose="LISTING_IMAGE" value={imgs} onChange={setImgs} />
      </section>

      <section className="w1-fsec"><h2 className="fh3">2. 상품/서비스 상세 설명</h2>
        <Field id="f-desc" label="상세 설명" req max={3000} count={v.desc.length} miss={m('desc')}
          hint="30자 이상이면 자동검수를 거칠 수 있습니다 — 짧으면 사람이 봅니다.">
          <textarea id="f-desc" className="w1-in" name="body" rows={7} maxLength={3000} value={v.desc} onChange={on('desc')}
            placeholder="상품/서비스의 특징, 장점, 제공 내용 등을 자세히 적어 주세요." />
        </Field>
        {chk && !chk.allowed && (
          <div className="w1-jc e" data-restricted=""><span className="lb">이 분야는 등록하실 수 없습니다</span>{chk.message}
            {chk.blocked.map((r) => <div key={r.code} className="w1-ls">근거: {r.legalBasis}</div>)}</div>
        )}
      </section>

      <section className="w1-fsec"><h2 className="fh3">3. 소개 조건</h2>
        <div className="w1-g3">
          <Field id="f-fee" label="소개비" req unit="원" miss={m('fee')}
            hint={<><b>소개비는 요율표로 산정하지 않습니다 (A-12).</b> 여기 적은 금액을 기준으로 1:1 대화에서 <b>당사자끼리 협의해</b> 최종 확정합니다.</>}>
            <MoneyInput id="f-fee" value={v.fee} onChange={set('fee')} placeholder="예) 500,000" />
          </Field>
          <Field id="f-support" label="계약 지원" req miss={m('support')} hint={<>플랫폼은 <b>양식만 제공</b>하고 계약 당사자가 아닙니다.</>}>
            <select id="f-support" className="w1-in" value={v.support} onChange={on('support')}>
              <option value="">선택하세요</option>{SUPPORT.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field id="f-hours" label="문의 가능 시간" req miss={m('hours')} hint="이 시간 밖 문의에는 자동 안내가 나갑니다.">
            <input id="f-hours" className="w1-in" maxLength={60} placeholder="예) 평일 10:00 ~ 18:00" value={v.hours} onChange={on('hours')} />
          </Field>
        </div>
        <Field label="부담 주체" auto hint="관마다 고정입니다 — 소개장터는 공급 기업, 안심소개는 양도인 · 매도인, 소개창업은 양도인 · 본사.">
          <div className={`w1-in gradebox${v.gwan ? ' on' : ''}`}>{v.gwan ? (BEARER[v.gwan] ?? '판매 쪽 부담') : '관을 고르면 정해집니다'}</div>
        </Field>
      </section>

      <section className="w1-fsec"><h2 className="fh3">4. 지역 정보</h2>
        <div className={m('addr') ? 'fmiss' : undefined}>
          <AddressInput value={addr} onChange={(a) => { setAddr(a); if (miss.has('addr')) setMiss((s) => { const n = new Set(s); n.delete('addr'); return n; }); }} required label="소재지 주소" />
          {m('addr') && <div className="fmsg">필수 항목입니다.</div>}
        </div>
        <div className="w1-ls" style={{ marginTop: 6 }}>목록 · 상세에는 시 · 구까지만 보입니다 — 상세주소는 등록자 본인과 운영만 봅니다.</div>
        {/* v10.46 (docs/96) — 지도 사용이 켜져 있고 키가 있으면 미리보기 핀(브라우저에서만 · 저장하지 않음). 아니면 지금 안내 그대로(fallback) */}
        <KakaoMap previewAddress={addr.road} height={220}
          caption={<>ⓘ 다른 회원에게는 「{[addr.sido, addr.sigungu].filter(Boolean).join(' ')}」 둘레 원으로만 보입니다.</>}
          fallback={
        <div className="w1-mapph" data-reg-map=""><span aria-hidden="true">📍</span>
          <div>{addr.road ? <><b>{addr.road}</b><br />이 주소의 지도는 좌표 연동 뒤에 이 자리에 들어갑니다.</> : <>주소를 고르면 이 자리에 지도가 들어갑니다.<br />주소 검색만으로는 좌표가 나오지 않습니다.</>}</div></div>} />
      </section>

      <section className="w1-fsec"><h2 className="fh3">5. 거래 및 운영 정보</h2>
        <div className="w1-g3">
          <Field id="f-size" label="매장 · 설비 규모"><input id="f-size" className="w1-in" maxLength={40} placeholder="예) 99.2m² (약 30평)" value={v.size} onChange={on('size')} /></Field>
          <Field id="f-sales" label="월매출" req miss={m('sales')}><input id="f-sales" className="w1-in" maxLength={40} placeholder="예) 8,000만원 내외" value={v.sales} onChange={on('sales')} /></Field>
          <Field id="f-premium" label="권리금"><input id="f-premium" className="w1-in" maxLength={40} placeholder="예) 협의 가능" value={v.premium} onChange={on('premium')} /></Field>
        </div>
        <div className="w1-g3">
          <Field id="f-wish" label="희망조건" req miss={m('wish')}>
            <select id="f-wish" className="w1-in" value={v.wish} onChange={on('wish')}><option value="">선택하세요</option>{WISH.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <Field id="f-handover" label="인수지원">
            <select id="f-handover" className="w1-in" value={v.handover} onChange={on('handover')}><option value="">선택하세요</option>{HANDOVER.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <Field id="f-etc" label="기타 지원 사항"><input id="f-etc" className="w1-in" maxLength={60} placeholder="예) 운영 노하우 전수" value={v.etc} onChange={on('etc')} /></Field>
        </div>
        <div className="w1-ls">이 섹션은 <b>관 · 업종에 따라 항목이 달라집니다</b>. 지금은 세 관이 같은 칸을 씁니다.</div>
      </section>

      <div className="w1-nt" data-reg-filled="" style={{ margin: '0 0 12px' }}><b>지금까지 {Object.values(v).filter((x) => x.trim()).length + (addr.road ? 1 : 0) + (imgs.length ? 1 : 0)}칸 입력했습니다.</b> 등록완료를 누르면 <b>내 등록 리스팅</b>에 검수대기로 한 건이 추가됩니다.</div>
      <div className="w1-fend">
        <div className="fw"><b>⊙ 유의사항</b>
          <span><i>✓</i>등록된 정보는 검수 후 공개됩니다(검수 대기 · SLA 24시간).</span>
          <span><i>✓</i>허위 정보 등록 시 서비스 이용이 제한될 수 있습니다.</span>
          <span><i>✓</i>등록 후 「내 등록 리스팅」에서 수정할 수 있습니다 — 수정하면 다시 검수합니다.</span>
        </div>
        <div className="fbtns">
          <button type="button" className="bcan" onClick={() => router.back()}>등록취소</button>
          <button type="button" className="bok" disabled={busy} onClick={() => void submit()} data-fdone="reg">{busy ? '등록 중…' : '등록완료'}</button>
        </div>
      </div>
      {err && <p className="w1-err" role="alert" style={{ textAlign: 'right' }}>{err}</p>}
    </div>
  );
}
