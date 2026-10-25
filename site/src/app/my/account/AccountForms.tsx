'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Res = { ok?: boolean; note?: string; message?: string; code?: string } | null;

/** v10.99 — 저장 결과 문구(사전 my.accForm.*) */
type PatchMsgs = { relogin: string; failed: string; failedShort: string; saved: string };
function usePatchMsgs(): PatchMsgs {
  const t = useTranslations('my.accForm');
  return { relogin: t('relogin'), failed: t('saveFailed'), failedShort: t('saveFailedShort'), saved: t('saved') };
}

async function patch(url: string, body: unknown, m: PatchMsgs): Promise<{ ok: boolean; msg: string }> {
  const r = await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => null)) as Res;
  if (r.status === 401) return { ok: false, msg: m.relogin };
  if (!r.ok) return { ok: false, msg: d?.message ?? m.failed };
  if (d?.ok === false) return { ok: false, msg: d.note ?? m.failedShort };
  return { ok: true, msg: d?.note ?? m.saved };
}

/**
 * 회원 정보 — PATCH /me/account (이름 2~40자 · 연락처 형식 0XX-XXXX-XXXX)
 * ★ 이메일은 로그인 수단이라 여기서 바꾸지 않습니다(서버도 받지 않습니다).
 */
export function ProfileForm({ name, phone, email }: { name: string; phone: string | null; email: string }) {
  const router = useRouter();
  const t = useTranslations('my.accForm');
  const pm = usePatchMsgs();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const n = String(fd.get('name') ?? '').trim();
    const ph = String(fd.get('phone') ?? '').trim();
    setMsg(null);
    if (n.length < 2) { setMsg({ ok: false, msg: t('nameShort') }); return; }
    if (ph && !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(ph)) {
      setMsg({ ok: false, msg: t('phoneBad') }); return;
    }
    start(async () => {
      const r = await patch('/api/v1/me/account', { name: n, phone: ph || undefined }, pm);
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>{t('name')}</span><input name="name" defaultValue={name} maxLength={40} required /></label>
      <label className="fld"><span>{t('phone')}</span><input name="phone" type="tel" defaultValue={phone ?? ''} placeholder="010-1234-5678" /></label>
      <div className="fld"><span>{t('email')} <span className="dim">{t('emailLocked')}</span></span><div className="masked">{email}</div></div>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('saving') : t('save')}</button></div>
    </form>
  );
}

/**
 * 공개 설정 — 누적수익 공개 (v10.21 · D023 · PATCH /me/account)
 *
 * 내 매물 상세의 「소개자 실적」에는 총 소개 · 성사 · 성사율이 나옵니다. **누적수익(정산받은 소개비 합계)은 기본으로 숨깁니다** —
 * 로그인하지 않은 사람도 보는 화면이고 개인의 수입 정보이기 때문입니다. 본인이 여기서 켠 경우에만 4번째 칸으로 나옵니다.
 * 이름은 바꾸지 않고 함께 보냅니다(서버가 이름을 필수로 받습니다 · 같은 이름이면 본인인증은 그대로입니다).
 */
export function EarningsForm({ name, on }: { name: string; on: boolean }) {
  const router = useRouter();
  const t = useTranslations('my.accForm');
  const pm = usePatchMsgs();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = (e.currentTarget.elements.namedItem('earningsPublic') as HTMLInputElement).checked;
    setMsg(null);
    start(async () => {
      const r = await patch('/api/v1/me/account', { name, earningsPublic: checked }, pm);
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="chk">
        <input type="checkbox" name="earningsPublic" defaultChecked={on} />
        <span><b>{t('earnB')}</b>{t('earnText')}</span>
      </label>
      <p className="hint">{t('earnHint')}</p>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('saving') : t('savePublic')}</button></div>
    </form>
  );
}

/**
 * 사업자 정보 — PATCH /me/business
 * ★ 인증 전에만 고칠 수 있습니다. 사업자등록번호는 여기서 바꾸지 않습니다(다른 사업자가 되는 것).
 */
export function BusinessForm({ biz }: {
  biz: { companyName: string | null; ceoName: string | null; bizType: string | null; bizItem: string | null; address: string | null };
}) {
  const router = useRouter();
  const t = useTranslations('my.accForm');
  const pm = usePatchMsgs();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? '').trim() || undefined;
    setMsg(null);
    start(async () => {
      const r = await patch('/api/v1/me/business', {
        companyName: v('companyName'), ceoName: v('ceoName'),
        bizType: v('bizType'), bizItem: v('bizItem'), address: v('address'),
      }, pm);
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>{t('company')}</span><input name="companyName" defaultValue={biz.companyName ?? ''} maxLength={60} /></label>
      <label className="fld"><span>{t('ceo')}</span><input name="ceoName" defaultValue={biz.ceoName ?? ''} maxLength={40} /></label>
      <label className="fld"><span>{t('bizType')}</span><input name="bizType" defaultValue={biz.bizType ?? ''} maxLength={60} /></label>
      <label className="fld"><span>{t('bizItem')}</span><input name="bizItem" defaultValue={biz.bizItem ?? ''} maxLength={60} /></label>
      <label className="fld"><span>{t('address')}</span><input name="address" defaultValue={biz.address ?? ''} maxLength={200} /></label>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('saving') : t('saveBiz')}</button></div>
    </form>
  );
}

type Act = { ok: true; note?: string } | { ok: false; code: string; message: string };

/**
 * v10.48 (D102) — 비밀번호 변경 (서버 액션 changePassword → PATCH /me/password)
 *   지금 비밀번호가 틀리면 로그인 실패와 같이 셉니다(5번 → 30분 잠금). 바꾸면 이 기기는 새 로그인으로 이어지고 다른 기기는 끊깁니다.
 */
export function PasswordForm({ action }: { action: (current: string, next: string) => Promise<Act> }) {
  const t = useTranslations('my.accForm');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const cur = String(fd.get('currentPassword') ?? ''), nw = String(fd.get('newPassword') ?? ''), nw2 = String(fd.get('newPassword2') ?? '');
    setMsg(null);
    if (!cur) { setMsg({ ok: false, msg: t('pwCurNeed') }); return; }
    if (nw.length < 10 || !/[A-Za-z]/.test(nw) || !/[0-9]/.test(nw) || !/[^A-Za-z0-9]/.test(nw)) {
      setMsg({ ok: false, msg: t('pwRule') }); return;
    }
    if (nw !== nw2) { setMsg({ ok: false, msg: t('pwMismatch') }); return; }
    start(async () => {
      const r = await action(cur, nw);
      if (r.ok) { setMsg({ ok: true, msg: r.note ?? t('pwChanged') }); form.reset(); }
      else setMsg({ ok: false, msg: r.message });
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit} data-password-form="">
      <label className="fld"><span>{t('pwCur')}</span><input name="currentPassword" type="password" autoComplete="current-password" maxLength={100} /></label>
      <label className="fld"><span>{t('pwNew')}</span><input name="newPassword" type="password" autoComplete="new-password" maxLength={100} placeholder={t('pwPh')} /></label>
      <label className="fld"><span>{t('pwNew2')}</span><input name="newPassword2" type="password" autoComplete="new-password" maxLength={100} /></label>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('pwChanging') : t('pwSubmit')}</button></div>
    </form>
  );
}
