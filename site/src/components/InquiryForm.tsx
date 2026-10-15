'use client';
/**
 * SB-HOM-ETC-030 문의하기 — v10.31 시안 scCs 의 폼: 문의 유형 칩 5종 · (신고 · 분쟁이면) 분쟁 경로 안내 · (거래 · 정산이면) 관련 거래 ·
 *   제목(60자) · 내용 · 답변받을 이메일(로그인이면 가입 이메일 — 읽기 전용) · 문의 접수하기 → 접수 완료 화면(접수번호 · 답변 예정).
 *   계좌번호 · 주민등록번호는 적지 않게 안내합니다(시안 문구).
 */
import { upload } from '@/components/form/RegParts';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const TYPES: Array<[string, string]> = [['DEAL', '거래 · 매칭'], ['SETTLE', '정산 · 소개비'], ['ACCOUNT', '계정 · 사업자 인증'], ['DISPUTE', '신고 · 분쟁'], ['ETC', '기타']];
export interface MyDeal { id: string; title: string | null; statusLabel?: string | null }

/* v10.31 — ?type=DISPUTE · ?deal= 로 들어오면(1:1 문의 화면의 「신고」) 그 유형 · 거래를 고른 채로 엽니다 */
export function InquiryForm({ email, deals, loggedIn, initialType, initialDeal }: { email: string | null; deals: MyDeal[]; loggedIn: boolean; initialType?: string; initialDeal?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState(TYPES.some(([v]) => v === initialType) ? initialType! : 'DEAL');
  const [dealId, setDealId] = useState(initialDeal && deals.some((d) => d.id === initialDeal) ? initialDeal : '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mail, setMail] = useState(email ?? '');
  const [err, setErr] = useState<string | null>(null);
  /* 시안 「첨부파일 — 이미지 · PDF 10MB까지 (최대 3개)」 — 고르면 바로 올리고(INQUIRY_ATTACHMENT) 접수 때 파일 id 를 붙입니다(로그인한 경우만) */
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  const [upBusy, setUpBusy] = useState(false);
  async function addFile(list: FileList | null) {
    const f = list?.[0]; if (!f) return;
    if (files.length >= 3) { setErr('첨부는 3개까지입니다.'); return; }
    setUpBusy(true); setErr(null);
    try { const id = await upload(f, 'INQUIRY_ATTACHMENT', true); setFiles((x) => [...x, { id, name: f.name }]); }
    catch (e) { setErr(e instanceof Error ? e.message : '올리지 못했습니다.'); }
    setUpBusy(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (type === 'DISPUTE') { setErr('분쟁 조정은 이 창구가 아니라 분쟁 접수에서 신청해 주세요 — 그래야 정산 보류가 걸립니다.'); return; }
    if (title.trim().length < 2) { setErr('제목을 적어 주세요.'); return; }
    if (body.trim().length < 5) { setErr('내용을 5자 이상 적어 주세요.'); return; }
    if (!loggedIn && !/.+@.+\..+/.test(mail)) { setErr('답변받을 이메일을 적어 주세요.'); return; }
    start(async () => {
      const r = await fetch('/api/v1/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: type, title: title.trim(), body: body.trim(),
          email: loggedIn ? undefined : mail.trim(), dealId: (type === 'DEAL' || type === 'SETTLE') && dealId ? dealId : undefined,
          ...(files.length ? { attachmentKeys: files.map((f) => f.id) } : {}),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '접수하지 못했습니다.'); return; }
      const q = new URLSearchParams({ no: d.no ?? '', cat: d.categoryLabel ?? '', due: d.dueAt ?? '', st: d.status ?? 'OPEN' });
      router.push(`/support/done?${q}`);
    });
  }

  return (
    <form className="w1-jp" onSubmit={submit} noValidate id="inquiry">
      <div className="w1-jt">문의하기</div>
      <div className="w1-fld"><span className="lb">문의 유형 <i>*</i></span>
        <div className="w1-cst" role="radiogroup" aria-label="문의 유형">
          {TYPES.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={type === v} className={`w1-ct${type === v ? ' on' : ''}`} onClick={() => setType(v)}>{l}</button>)}
        </div>
      </div>
      {type === 'DISPUTE' && (
        <div className="w1-nt warn" style={{ marginBottom: 14 }}><b>분쟁은 이 창구가 아닙니다</b><br />
          거래 당사자 간 <b>분쟁 조정</b>은 「분쟁 접수」로 신청해 주세요. 접수 즉시 해당 거래의 <b>정산이 보류</b>되며, 여기로 보내면 그 보호를 받지 못합니다.
          <div style={{ marginTop: 9 }}><Link className="w1-bo sm" href="/support/dispute">분쟁 접수로 이동</Link>{' '}<Link className="w1-bo sm" href="/report">신고하기</Link></div></div>
      )}
      {(type === 'DEAL' || type === 'SETTLE') && (
        <div className="w1-fld"><label htmlFor="cs-deal">관련 거래</label>
          <select id="cs-deal" className="w1-in" value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!loggedIn}>
            <option value="">선택 안 함</option>
            {deals.map((d) => <option key={d.id} value={d.id}>#{d.id.slice(0, 4).toUpperCase()} · {d.title ?? '거래'}{d.statusLabel ? ` (${d.statusLabel})` : ''}</option>)}
          </select>
          <div className="w1-fh">{loggedIn ? '거래를 선택하면 담당자가 대화 · 정산 내역을 함께 확인합니다. 답변이 빨라집니다.' : '로그인하면 내 거래를 고를 수 있습니다.'}</div></div>
      )}
      <div className="w1-fld"><label htmlFor="cs-title">제목 <i>*</i></label>
        <input id="cs-title" className="w1-in" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="무엇에 대한 문의인지 한 줄로 적어주세요 (최대 60자)" /></div>
      <div className="w1-fld"><label htmlFor="cs-body">내용 <i>*</i></label>
        <textarea id="cs-body" className="w1-in" rows={6} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="언제 · 어느 화면에서 · 무엇을 하려 했는지 적어주시면 빠르게 확인할 수 있습니다." />
        <div className="w1-fh">계좌번호 · 주민등록번호는 적지 마세요. 필요하면 담당자가 안전한 경로로 따로 요청합니다.</div></div>
      {/* v10.32 — 시안처럼 첨부파일 · 답변받을 이메일을 한 줄 두 칸으로 */}
      <div className="w1-g2">
      <div className="w1-fld"><span className="lb">첨부파일</span>
        {loggedIn ? (
          <>
            <label className={`w1-upl${upBusy || files.length >= 3 ? ' off' : ''}`}>
              <input type="file" accept="image/jpeg,image/png,application/pdf" hidden disabled={upBusy || files.length >= 3}
                onChange={(e) => { void addFile(e.target.files); e.target.value = ''; }} data-inq-file="" />
              📎 {upBusy ? '올리는 중…' : '파일 선택 · 이미지 · PDF 10MB까지 (최대 3개)'}
            </label>
            {files.length > 0 && (
              <ul className="w1-upls">{files.map((f) => (
                <li key={f.id}>{f.name} <button type="button" className="w1-bo sm" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>빼기</button></li>
              ))}</ul>
            )}
          </>
        ) : <><span className="w1-upl off" aria-disabled="true">📎 파일 선택 · 이미지 · PDF 10MB까지 (최대 3개)</span>
          <div className="w1-fh">첨부는 로그인한 뒤에 할 수 있습니다(올린 파일은 본인과 담당자만 봅니다).</div></>}
      </div>
      <div className="w1-fld"><label htmlFor="cs-mail">답변받을 이메일 <i>*</i></label>
        <input id="cs-mail" className="w1-in" type="email" value={mail} readOnly={loggedIn} onChange={(e) => setMail(e.target.value)} placeholder="name@company.com" />
        <div className="w1-fh">{loggedIn ? '가입 시 등록한 이메일입니다. 나의공간 → 설정에서 바꿀 수 있습니다.' : '로그인하지 않으셨습니다 — 답변을 이 이메일로 보내 드립니다.'}</div></div>
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}
      <div className="w1-jsub"><button className="w1-bor" disabled={pending}>{pending ? '접수 중…' : '문의 접수하기'}</button></div>
    </form>
  );
}
