'use client';
/**
 * v10.32 (추가) — 인증 화면(SB-HOM-AUT-030 · 시안 scVerify) 「2. 사업자 인증」 칸.
 *   시안: 사업자등록번호 칸 → 노란 안내(이런 경우 인증되지 않습니다) → [국세청 조회로 인증].
 *   새 인증 방식을 만들지 않습니다 — 이미 있는 API 두 개를 그대로 씁니다.
 *     ① 「국세청 조회로 인증」 = POST /signup/biz-check(가입 2단계와 같은 조회 — 국세청 상태 · 이미 가입된 번호)
 *     ② 통과하면 그 번호로 사업자 신청서(BusinessForm → POST /businesses — 나의공간 사업자 전환과 같은 신청 · 운영 승인)
 *   휴업 · 폐업 · 이미 가입된 번호면 신청서를 열지 않고 까닭을 보입니다.
 */
import { useState } from 'react';
import { BusinessForm } from './BusinessForm';

interface BizCheck { bizRegNo: string; status: string; stub: boolean; detail: string | null; taken: boolean; ok: boolean }
const fmtBrn = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

export function BizVerify({ disabled = false }: { disabled?: boolean }) {
  const [brn, setBrn] = useState('');
  const [busy, setBusy] = useState(false);
  const [chk, setChk] = useState<BizCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    const d = brn.replace(/\D/g, '');
    if (d.length !== 10) { setErr('사업자등록번호 10자리를 입력해 주십시오.'); return; }
    setErr(null); setBusy(true); setChk(null);
    try {
      const r = await fetch('/api/v1/signup/biz-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bizRegNo: d }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.message ?? '조회하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
      else { setChk(j as BizCheck); setBrn(fmtBrn(d)); }
    } catch { setErr('조회하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); }
    setBusy(false);
  }

  if (chk?.ok) {
    return (
      <div data-biz-check-ok="">
        <div className="my-nt ok">
          <b>국세청 조회 — {chk.status === 'VALID' ? '계속사업자' : '상태 확인 중'}</b> · 사업자등록번호 {fmtBrn(chk.bizRegNo)}{chk.detail ? ` (${chk.detail})` : ''}
          {chk.stub ? ' · 모의 조회(국세청 연동 준비 중)' : ''}. 상호 · 대표자명을 적어 신청하시면 운영 확인 뒤 사업자 인증이 끝납니다.
        </div>
        <BusinessForm regNo={chk.bizRegNo} />
        <button type="button" className="my-bo sm" style={{ marginTop: 8 }} onClick={() => { setChk(null); setBrn(''); }}>다른 번호로 조회</button>
      </div>
    );
  }

  return (
    <div data-biz-check="">
      <label className="my-fld"><span>사업자등록번호</span>
        <input className="my-inp w1-vinp" name="brn" value={brn} onChange={(e) => { setBrn(e.target.value); setChk(null); }}
          inputMode="numeric" placeholder="123-45-67890" maxLength={12} aria-label="사업자등록번호" disabled={disabled} /></label>
      <div className="my-nt warn"><b>이런 경우 인증되지 않습니다.</b> 휴업 · 폐업 사업자 · 이미 가입된 사업자등록번호(사업자당 계정 1개) · 입력한 상호와 국세청 등록 상호가 다른 경우.</div>
      {chk && !chk.ok && (
        <p className="form-error" role="alert" data-biz-check-no="">
          {chk.taken ? '이미 가입된 사업자등록번호입니다 — 사업자당 계정 1개입니다.'
            : <>국세청 조회 결과 <b>{chk.status === 'CLOSED' ? '폐업' : chk.status === 'SUSPENDED' ? '휴업' : '확인되지 않는'}</b> 사업자입니다{chk.detail ? ` (${chk.detail})` : ''}.</>}
        </p>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="my-hbtn" style={{ marginBottom: 0 }}>
        <button type="button" className="my-bp" onClick={check} disabled={busy || disabled}
          title={disabled ? '본인인증을 먼저 마쳐 주십시오' : undefined}>{busy ? '조회 중…' : '국세청 조회로 인증'}</button>
      </div>
    </div>
  );
}
