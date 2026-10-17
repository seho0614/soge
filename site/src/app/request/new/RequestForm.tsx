'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
    if (!gwan) out.push(['gwan', '관']);
    if (!cat) out.push(['cat', '업종']);
    if (title.trim().length < 5) out.push(['title', '제목(5자 이상)']);
    if (!body.trim()) out.push(['desc', '상세 내용']);
    if (!fee) out.push(['fee', '예상 소개비']);
    if (!hours.trim()) out.push(['hours', '문의 가능 시간']);
    if (!addr.road.trim()) out.push(['addr', '희망 지역 주소']);
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
      setErr(`아직 비어 있는 필수 항목이 ${bad.length}개 있습니다 — ${bad.slice(0, 3).map((b) => b[1]).join(' · ')}${bad.length > 3 ? ` 외 ${bad.length - 3}개` : ''}`);
      document.querySelector('.fmiss')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (bmin && bmax && Number(bmin) > Number(bmax)) { setErr('희망 예산의 최소가 최대보다 큽니다.'); return; }
    if (blocked) { setErr(chk?.message ?? '이 분야는 등록하실 수 없습니다.'); return; }
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
    if (!res.ok) { setErr((b.message ?? '등록하지 못했습니다.') + (b.code === 'POSTING_SUSPENDED' ? ' — 풀리는 날 전에 등록하려면 고객센터로 문의해 주십시오.' : '')); return; }
    /* v10.26 (G-180) — 상세는 공개된 요청만 — 검수 대기면 접수 안내 */
    if (b.status === 'PUBLISHED') { start(() => router.push(`/request/${b.requestId}`)); return; }
    setQueued(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (queued) {
    return (
      <div className="w1-done" data-request-queued="">
        <div className="dic" aria-hidden="true">✓</div>
        <h1>요청을 접수했습니다</h1>
        <p>확인(검수)이 끝나면 「소개받기」 목록에 공개됩니다. 보통 24시간 안에 끝납니다.<br />등록 후 <b>30일</b>이 지나면 자동으로 닫힙니다.</p>
        <div className="w1-dact">
          <Link className="w1-jb p" href="/request">소개받기 목록</Link>
          <Link className="w1-jb o" href="/my">나의공간</Link>
        </div>
      </div>
    );
  }

  const m = (k: string) => miss.has(k);
  return (
    <div className="w1-rgw" data-form="reqn">
      <div className="w1-rghd">
        <div><h1>소개받기 등록하기</h1>
          <div className="rgs">원하는 상품/서비스 정보를 입력해주세요. 소개뱅크 회원들이 연결해 드립니다.</div></div>
        <span className="req">* 필수 입력 항목</span>
      </div>

      <section className="w1-fsec"><h2 className="fh3">1. 기본 정보</h2>
        <CategoryBlock gwans={gwans} cats={cats} gwan={gwan} cat={cat} gradeLabels={gradeLabels} miss={miss}
          onGwan={(g) => { setGwan(g); setCat(''); }} onCat={setCat} />
        <Field id="f-title" label="소개받을 제목" req max={60} count={title.length} miss={m('title')}>
          <input id="f-title" className="w1-in" name="title" maxLength={60} placeholder="제목을 입력해주세요" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <ImagePicker purpose="REQUEST_IMAGE" value={imgs} onChange={setImgs} what="원하는 상품/서비스" />
      </section>

      <section className="w1-fsec"><h2 className="fh3">2. 소개받기 상세 내용</h2>
        <Field id="f-desc" label="상세 내용" req max={3000} count={body.length} miss={m('desc')}>
          <textarea id="f-desc" className="w1-in" name="body" rows={7} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="소개받고 싶은 상품/서비스에 대해 자세하게 적어 주세요." />
        </Field>
        {blocked && (
          <div className="w1-jc e" data-restricted=""><span className="lb">이 분야는 등록하실 수 없습니다</span>
            {chk?.message}{chk?.blocked.map((r) => <div key={r.code} className="w1-ls">근거: {r.legalBasis}</div>)}</div>
        )}
        {chk && chk.allowed && chk.gated.length > 0 && (
          <div className="w1-jc w"><span className="lb">자격 확인이 필요한 분야입니다</span>{chk.message}</div>
        )}
      </section>

      <section className="w1-fsec"><h2 className="fh3">3. 계약 조건</h2>
        <div className="w1-g3">
          <Field id="f-fee" label="예상 소개비" req unit="원" miss={m('fee')} hint="소개 성사 시 지급 가능한 예상 소개비를 적어 주세요.">
            <MoneyInput id="f-fee" value={fee} onChange={setFee} placeholder="예) 500,000" />
          </Field>
          <Field id="f-hours" label="문의 가능 시간" req miss={m('hours')} hint="문의 및 연락이 가능한 시간대를 적어 주세요.">
            <input id="f-hours" className="w1-in" maxLength={60} placeholder="예) 평일 10:00 ~ 18:00" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          <div className="w1-fnote2"><span className="fi3" aria-hidden="true">👤</span><span><b>안내사항</b><p>정확한 조건 입력은 빠른 매칭에 도움이 됩니다.</p></span></div>
        </div>
        <div className="w1-g3">
          <Field id="f-bmin" label="희망 예산 (최소)" unit="원">
            <MoneyInput id="f-bmin" value={bmin} onChange={setBmin} placeholder="예) 10,000,000" />
          </Field>
          <Field id="f-bmax" label="희망 예산 (최대)" unit="원">
            <MoneyInput id="f-bmax" value={bmax} onChange={setBmax} placeholder="예) 20,000,000" />
          </Field>
          <Field id="f-qty" label="규모 · 수량" hint="예산을 비우면 「협의」로 보입니다.">
            <input id="f-qty" className="w1-in" maxLength={60} placeholder="예) 주 5회 · 1,200평" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>
        <div className="w1-g3">
          <Field label="공개 범위" hint="누가 이 요청의 내용을 볼 수 있는지 정합니다.">
            <div className="w1-seg" role="radiogroup" aria-label="공개 범위">
              {([['ALL', '전체'], ['MEMBER', '회원'], ['VERIFIED', '인증 회원']] as const).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={vis === k} className={vis === k ? 'on' : undefined} onClick={() => setVis(k)}>{t}</button>
              ))}
            </div>
          </Field>
          <Field label="회사명 비공개" hint="켜면 회사명을 가리고 업종 · 규모만 보입니다.">
            <label className="w1-chk"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> 회사명을 가립니다</label>
          </Field>
          <Field label="예산 공개" hint="끄면 예산은 요청자 본인만 봅니다.">
            <label className="w1-chk"><input type="checkbox" checked={budgetOpen} onChange={(e) => setBudgetOpen(e.target.checked)} /> 희망 예산을 공개합니다</label>
          </Field>
        </div>
      </section>

      <section className="w1-fsec"><h2 className="fh3">4. 지역 정보</h2>
        <div className={m('addr') ? 'fmiss' : undefined}>
          <AddressInput value={addr} onChange={setAddr} required label="희망 지역 주소" />
          {m('addr') && <div className="fmsg">필수 항목입니다.</div>}
        </div>
        {/* v10.46 (docs/96) — 지도 사용이 켜져 있으면 희망 지역(시 · 구) 둘레 원 미리보기 · 저장하지 않음. 아니면 지금 칸 그대로 */}
        <KakaoMap previewAddress={[addr.sido, addr.sigungu].filter(Boolean).join(' ')} previewPrecision="REGION" height={160}
          caption={<><b>{[addr.sido, addr.sigungu].filter(Boolean).join(' ')}</b> — 목록 · 상세에는 시 · 구까지만 보입니다.</>}
          fallback={
        <div className="w1-rmap" aria-live="polite">
          <div className="rmc"><span className="pin" aria-hidden="true">📍</span>
            {addr.road ? <><b>{[addr.sido, addr.sigungu].filter(Boolean).join(' ')}</b><br />목록 · 상세에는 시 · 구까지만 보입니다.</>
              : <>우편번호 검색으로 주소를 고르면<br />지역(시 · 구)이 정해집니다.</>}
          </div>
        </div>} />
        <div className="w1-ls" style={{ marginTop: 6 }}>지도는 좌표 연동 전이라 그리지 않습니다 — 상세주소는 요청자 본인과 운영만 봅니다.</div>
      </section>

      <div className="w1-fend">
        <div className="fw"><b>⊙ 유의사항</b>
          <span><i>✓</i>등록된 정보는 검수 후 공개됩니다.</span>
          <span><i>✓</i>허위 정보 등록 시 서비스 이용이 제한될 수 있습니다.</span>
          <span><i>✓</i>등록 후 관리 페이지에서 수정 및 삭제가 가능합니다.</span>
          <span className="w1-ls">지금까지 {filled}칸 입력했습니다. 등록 후 30일이 지나면 자동으로 닫힙니다.</span>
        </div>
        <div className="fbtns">
          <button type="button" className="bcan" onClick={reset}>입력 지우기</button>
          <button type="button" className="bok" onClick={() => void submit()} disabled={pending} data-fdone="reqn">{pending ? '등록 중…' : '등록완료'}</button>
        </div>
      </div>
      {err && <p className="w1-err" role="alert" style={{ textAlign: 'right' }}>{err}</p>}
    </div>
  );
}
