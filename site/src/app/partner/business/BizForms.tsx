'use client';
/* v10.31 (W5 · CTR-610) — 회사 · 계정의 입력: 사업자 정보 변경 요청 · 직원 초대 · 회사 관리(브랜드 · 로고 · 소재) · 초대 받아들이기 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/partner/act';
import { uploadFile } from '@/lib/upload';

type Msg = ['ok' | 'err', string] | null;
const MsgP = ({ m }: { m: Msg }) => (m ? <p className={`pt-msg ${m[0]}`} role="status">{m[1]}</p> : null);
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  const run = async (fn: () => Promise<{ note?: string } | unknown>, ok?: string) => {
    setBusy(true); setM(null);
    try { const r = (await fn()) as { note?: string }; setM(['ok', ok ?? r?.note ?? '처리했습니다.']); router.refresh(); return true; }
    catch (e) { setM(['err', (e as Error).message]); return false; } finally { setBusy(false); }
  };
  return { busy, m, run };
}

const FIELDS: Array<[string, string]> = [['ADDRESS', '주소'], ['COMPANY_NAME', '상호'], ['CEO_NAME', '대표자'], ['BIZ_TYPE', '업태'], ['BIZ_ITEM', '종목']];
export function ChangeRequestForm() {
  const { busy, m, run } = useRun();
  const [field, setField] = useState('ADDRESS');
  const [after, setAfter] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="pt-fset" data-biz-change>
      <h3>변경 요청</h3>
      <div className="pt-row">
        <label>항목<select className="pt-input" value={field} onChange={(e) => setField(e.target.value)}>{FIELDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label style={{ flex: 1, minWidth: 200 }}>바꿀 값<input className="pt-input" value={after} onChange={(e) => setAfter(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 200 }}>사유<input className="pt-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 사무실 이전" /></label>
        <button type="button" className="pt-bp" disabled={busy || !after.trim() || reason.trim().length < 2}
                onClick={() => void run(() => api('POST', '/partner/company/change-requests', { field, afterValue: after, reason })).then((ok) => { if (ok) { setAfter(''); setReason(''); } })}>요청</button>
      </div>
      <p className="pt-ls">사업자등록번호는 바꿀 수 없습니다(다른 사업자는 새 입점). 승인은 본사가 하고, 승인되면 바로 반영됩니다.</p>
      <MsgP m={m} />
    </div>
  );
}

export function StaffInviteForm() {
  const { busy, m, run } = useRun();
  const [email, setEmail] = useState('');
  const [settle, setSettle] = useState(false);
  return (
    <div className="pt-fset" data-staff-invite>
      <h3>직원 초대</h3>
      <div className="pt-row">
        <label style={{ flex: 1, minWidth: 220 }}>가입한 회원 이메일<input className="pt-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lee@hanbit.example" /></label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} /> 정산 권한(충전 · 환불)</label>
        <button type="button" className="pt-bp" disabled={busy || !email.includes('@')}
                onClick={() => void run(() => api('POST', '/partner/company/staff', { email, canSettle: settle })).then((ok) => { if (ok) setEmail(''); })}>초대</button>
      </div>
      <MsgP m={m} />
    </div>
  );
}

export function StaffRemove({ accountId }: { accountId: string }) {
  const { busy, m, run } = useRun();
  return (<span><button type="button" className="pt-bo sm" disabled={busy}
    onClick={() => { if (confirm('이 직원 계정을 뺍니다. 파트너센터에 더 들어오지 못합니다.')) void run(() => api('DELETE', `/partner/company/staff/${accountId}`)); }}>빼기</button><MsgP m={m} /></span>);
}

export function BrandForm({ brandName, intro, hasLogo }: { brandName: string | null; intro: string | null; hasLogo: boolean }) {
  const { busy, m, run } = useRun();
  const [name, setName] = useState(brandName ?? '');
  const [text, setText] = useState(intro ?? '');
  const [logo, setLogo] = useState<string | null>(null);
  const [up, setUp] = useState<string | null>(null);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    try { const u = await uploadFile(f, 'PARTNER_MEDIA'); setLogo(u.fileId); setUp(`${u.name} 올림`); } catch (x) { setUp((x as Error).message); }
  }
  return (
    <div className="pt-fset" data-brand-form>
      <h3>브랜드</h3>
      <div className="pt-row">
        <label style={{ minWidth: 200 }}>브랜드명<input className="pt-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 220 }}>소개<input className="pt-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} /></label>
        <label>로고{hasLogo ? ' (등록됨 — 바꾸려면 새로)' : ''}<input type="file" accept="image/jpeg,image/png" onChange={(e) => void pick(e)} /></label>
        <button type="button" className="pt-bp" disabled={busy || !name.trim()} onClick={() => void run(() => api('PUT', '/partner/company/brand', { brandName: name, intro: text || null, logoFileId: logo }), '저장했습니다.')}>저장</button>
      </div>
      {up && <p className="pt-ls">{up}</p>}
      <MsgP m={m} />
    </div>
  );
}

const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
export function SiteForm() {
  const { busy, m, run } = useRun();
  const [name, setName] = useState('');
  const [sido, setSido] = useState('서울');
  const [sgg, setSgg] = useState('');
  return (
    <div className="pt-fset" data-site-form>
      <h3>소재 추가</h3>
      <div className="pt-row">
        <label>이름<input className="pt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 송파점" /></label>
        <label>시 · 도<select className="pt-input" value={sido} onChange={(e) => setSido(e.target.value)}>{SIDO.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>시 · 군 · 구<input className="pt-input" value={sgg} onChange={(e) => setSgg(e.target.value)} placeholder="예: 송파구" /></label>
        <button type="button" className="pt-bp" disabled={busy || !name.trim()} onClick={() => void run(() => api('POST', '/partner/company/sites', { name, sido, sigungu: sgg || null }), '추가했습니다.').then((ok) => { if (ok) { setName(''); setSgg(''); } })}>추가</button>
      </div>
      <p className="pt-ls">시 · 군 · 구까지만 받습니다(상세 주소는 받지 않음).</p>
      <MsgP m={m} />
    </div>
  );
}

export function SiteRemove({ id }: { id: string }) {
  const { busy, m, run } = useRun();
  return <span><button type="button" className="pt-bo sm" disabled={busy} onClick={() => void run(() => api('DELETE', `/partner/company/sites/${id}`), '뺐습니다.')}>빼기</button><MsgP m={m} /></span>;
}

export function InviteAccept({ businessId, company }: { businessId: string; company: string }) {
  const { busy, m, run } = useRun();
  return (
    <div className="pt-crow">
      <div><b>{company}의 직원 초대</b><span className="pt-ls">받아들이면 그 업체의 파트너센터를 함께 씁니다.</span></div>
      <span><button type="button" className="pt-bp" disabled={busy} onClick={() => void run(() => api('POST', `/partner/staff/invitations/${businessId}/accept`))}>받아들이기</button><MsgP m={m} /></span>
    </div>
  );
}
