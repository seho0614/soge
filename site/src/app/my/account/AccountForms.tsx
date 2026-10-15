'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Res = { ok?: boolean; note?: string; message?: string; code?: string } | null;

async function patch(url: string, body: unknown): Promise<{ ok: boolean; msg: string }> {
  const r = await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => null)) as Res;
  if (r.status === 401) return { ok: false, msg: '로그인이 풀렸습니다. 다시 로그인해 주십시오.' };
  if (!r.ok) return { ok: false, msg: d?.message ?? '저장하지 못했습니다. 잠시 후 다시 시도해 주십시오.' };
  if (d?.ok === false) return { ok: false, msg: d.note ?? '저장하지 못했습니다.' };
  return { ok: true, msg: d?.note ?? '수정했습니다.' };
}

/**
 * 회원 정보 — PATCH /me/account (이름 2~40자 · 연락처 형식 0XX-XXXX-XXXX)
 * ★ 이메일은 로그인 수단이라 여기서 바꾸지 않습니다(서버도 받지 않습니다).
 */
export function ProfileForm({ name, phone, email }: { name: string; phone: string | null; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const n = String(fd.get('name') ?? '').trim();
    const ph = String(fd.get('phone') ?? '').trim();
    setMsg(null);
    if (n.length < 2) { setMsg({ ok: false, msg: '이름을 두 글자 이상 쓰십시오.' }); return; }
    if (ph && !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(ph)) {
      setMsg({ ok: false, msg: '연락처 형식이 맞지 않습니다. 예: 010-1234-5678' }); return;
    }
    start(async () => {
      const r = await patch('/api/v1/me/account', { name: n, phone: ph || undefined });
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>이름</span><input name="name" defaultValue={name} maxLength={40} required /></label>
      <label className="fld"><span>연락처</span><input name="phone" type="tel" defaultValue={phone ?? ''} placeholder="010-1234-5678" /></label>
      <div className="fld"><span>이메일 <span className="dim">(고칠 수 없음)</span></span><div className="masked">{email}</div></div>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? '저장 중…' : '저장'}</button></div>
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
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = (e.currentTarget.elements.namedItem('earningsPublic') as HTMLInputElement).checked;
    setMsg(null);
    start(async () => {
      const r = await patch('/api/v1/me/account', { name, earningsPublic: checked });
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="chk">
        <input type="checkbox" name="earningsPublic" defaultChecked={on} />
        <span><b>누적수익 공개</b> — 내 매물 상세의 「소개자 실적」에 누적수익(정산받은 소개비 합계)을 보여 줍니다.</span>
      </label>
      <p className="hint">꺼 두면 총 소개 · 성사(계약) · 성사율만 나옵니다. 로그인하지 않은 사람도 보는 화면이니, 공개를 원하실 때만 켜십시오. 언제든 다시 끌 수 있습니다.</p>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? '저장 중…' : '공개 설정 저장'}</button></div>
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
      });
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>상호</span><input name="companyName" defaultValue={biz.companyName ?? ''} maxLength={60} /></label>
      <label className="fld"><span>대표자</span><input name="ceoName" defaultValue={biz.ceoName ?? ''} maxLength={40} /></label>
      <label className="fld"><span>업태</span><input name="bizType" defaultValue={biz.bizType ?? ''} maxLength={60} /></label>
      <label className="fld"><span>종목</span><input name="bizItem" defaultValue={biz.bizItem ?? ''} maxLength={60} /></label>
      <label className="fld"><span>주소</span><input name="address" defaultValue={biz.address ?? ''} maxLength={200} /></label>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.msg}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? '저장 중…' : '사업자 정보 저장'}</button></div>
    </form>
  );
}
