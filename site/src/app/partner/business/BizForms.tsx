'use client';
/* v10.31 (W5 · CTR-610) — 회사 · 계정의 입력: 사업자 정보 변경 요청 · 직원 초대 · 회사 관리(브랜드 · 로고 · 소재) · 초대 받아들이기 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/components/partner/act';
import { uploadFile } from '@/lib/upload';

type Msg = ['ok' | 'err', string] | null;
const MsgP = ({ m }: { m: Msg }) => (m ? <p className={`pt-msg ${m[0]}`} role="status">{m[1]}</p> : null);
function useRun() {
  const router = useRouter();
  const tc = useTranslations('partner.common');
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  const run = async (fn: () => Promise<{ note?: string } | unknown>, ok?: string) => {
    setBusy(true); setM(null);
    try { const r = (await fn()) as { note?: string }; setM(['ok', ok ?? r?.note ?? tc('done')]); router.refresh(); return true; }
    catch (e) { setM(['err', (e as Error).message]); return false; } finally { setBusy(false); }
  };
  return { busy, m, run };
}

/* v10.100 (다국어 2-5a) — 항목 이름은 사전 partner.bizForm.fields.<코드> */
const FIELDS = ['ADDRESS', 'COMPANY_NAME', 'CEO_NAME', 'BIZ_TYPE', 'BIZ_ITEM'] as const;
export function ChangeRequestForm() {
  const { busy, m, run } = useRun();
  const t = useTranslations('partner.bizForm');
  const [field, setField] = useState('ADDRESS');
  const [after, setAfter] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="pt-fset" data-biz-change>
      <h3>{t('changeReq')}</h3>
      <div className="pt-row">
        <label>{t('item')}<select className="pt-input" value={field} onChange={(e) => setField(e.target.value)}>{FIELDS.map((k) => <option key={k} value={k}>{t(`fields.${k}`)}</option>)}</select></label>
        <label style={{ flex: 1, minWidth: 200 }}>{t('newValue')}<input className="pt-input" value={after} onChange={(e) => setAfter(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 200 }}>{t('reason')}<input className="pt-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPh')} /></label>
        <button type="button" className="pt-bp" disabled={busy || !after.trim() || reason.trim().length < 2}
                onClick={() => void run(() => api('POST', '/partner/company/change-requests', { field, afterValue: after, reason })).then((ok) => { if (ok) { setAfter(''); setReason(''); } })}>{t('request')}</button>
      </div>
      <p className="pt-ls">{t('changeNote')}</p>
      <MsgP m={m} />
    </div>
  );
}

export function StaffInviteForm() {
  const { busy, m, run } = useRun();
  const [email, setEmail] = useState('');
  const [settle, setSettle] = useState(false);
  const t = useTranslations('partner.bizForm');
  return (
    <div className="pt-fset" data-staff-invite>
      <h3>{t('invite')}</h3>
      <div className="pt-row">
        <label style={{ flex: 1, minWidth: 220 }}>{t('memberEmail')}<input className="pt-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lee@hanbit.example" /></label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} /> {t('settleRight')}</label>
        <button type="button" className="pt-bp" disabled={busy || !email.includes('@')}
                onClick={() => void run(() => api('POST', '/partner/company/staff', { email, canSettle: settle })).then((ok) => { if (ok) setEmail(''); })}>{t('inviteBtn')}</button>
      </div>
      <MsgP m={m} />
    </div>
  );
}

export function StaffRemove({ accountId }: { accountId: string }) {
  const { busy, m, run } = useRun();
  const t = useTranslations('partner.bizForm');
  return (<span><button type="button" className="pt-bo sm" disabled={busy}
    onClick={() => { if (confirm(t('removeAsk'))) void run(() => api('DELETE', `/partner/company/staff/${accountId}`)); }}>{t('remove')}</button><MsgP m={m} /></span>);
}

export function BrandForm({ brandName, intro, hasLogo }: { brandName: string | null; intro: string | null; hasLogo: boolean }) {
  const { busy, m, run } = useRun();
  const [name, setName] = useState(brandName ?? '');
  const [text, setText] = useState(intro ?? '');
  const [logo, setLogo] = useState<string | null>(null);
  const [up, setUp] = useState<string | null>(null);
  const t = useTranslations('partner.bizForm');
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    try { const u = await uploadFile(f, 'PARTNER_MEDIA'); setLogo(u.fileId); setUp(t('uploaded', { name: u.name })); } catch (x) { setUp((x as Error).message); }
  }
  return (
    <div className="pt-fset" data-brand-form>
      <h3>{t('brand')}</h3>
      <div className="pt-row">
        <label style={{ minWidth: 200 }}>{t('brandName')}<input className="pt-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 220 }}>{t('intro')}<input className="pt-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} /></label>
        <label>{t('logo')}{hasLogo ? t('logoHas') : ''}<input type="file" accept="image/jpeg,image/png" onChange={(e) => void pick(e)} /></label>
        <button type="button" className="pt-bp" disabled={busy || !name.trim()} onClick={() => void run(() => api('PUT', '/partner/company/brand', { brandName: name, intro: text || null, logoFileId: logo }), t('saved'))}>{t('save')}</button>
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
  const t = useTranslations('partner.bizForm');
  return (
    <div className="pt-fset" data-site-form>
      <h3>{t('addSite')}</h3>
      <div className="pt-row">
        <label>{t('name')}<input className="pt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePh')} /></label>
        <label>{t('sido')}<select className="pt-input" value={sido} onChange={(e) => setSido(e.target.value)}>{SIDO.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>{t('sgg')}<input className="pt-input" value={sgg} onChange={(e) => setSgg(e.target.value)} placeholder={t('sggPh')} /></label>
        <button type="button" className="pt-bp" disabled={busy || !name.trim()} onClick={() => void run(() => api('POST', '/partner/company/sites', { name, sido, sigungu: sgg || null }), t('added')).then((ok) => { if (ok) { setName(''); setSgg(''); } })}>{t('add')}</button>
      </div>
      <p className="pt-ls">{t('siteNote')}</p>
      <MsgP m={m} />
    </div>
  );
}

export function SiteRemove({ id }: { id: string }) {
  const { busy, m, run } = useRun();
  const t = useTranslations('partner.bizForm');
  return <span><button type="button" className="pt-bo sm" disabled={busy} onClick={() => void run(() => api('DELETE', `/partner/company/sites/${id}`), t('removed'))}>{t('remove')}</button><MsgP m={m} /></span>;
}

export function InviteAccept({ businessId, company }: { businessId: string; company: string }) {
  const { busy, m, run } = useRun();
  const t = useTranslations('partner.bizForm');
  return (
    <div className="pt-crow">
      <div><b>{t('inviteFrom', { company })}</b><span className="pt-ls">{t('inviteNote')}</span></div>
      <span><button type="button" className="pt-bp" disabled={busy} onClick={() => void run(() => api('POST', `/partner/staff/invitations/${businessId}/accept`))}>{t('accept')}</button><MsgP m={m} /></span>
    </div>
  );
}
