'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddressInput, EMPTY_ADDRESS, type AddressValue } from './AddressInput';

/**
 * 사업자 신청.
 *
 * 승인은 검수 큐를 타며 전건 수동입니다.
 * NTS 실연동 전에는 진위 확인이 스텁이므로 결과에 그렇게 표시합니다.
 */
/** regNo — v10.32 (추가): 인증 화면(/verify)에서 국세청 조회(POST /signup/biz-check)를 통과한 번호를 넘기면 그 번호로 고정(읽기 전용)합니다. 없으면 전과 같음 */
export function BusinessForm({ regNo }: { regNo?: string } = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ntsVerified: boolean } | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [addr, setAddr] = useState<AddressValue>(EMPTY_ADDRESS);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizRegNo: String(fd.get('bizRegNo') ?? '').replace(/\D/g, ''),
          companyName: String(fd.get('companyName') ?? ''),
          ceoName: String(fd.get('ceoName') ?? ''),
          // 구조화 주소. 지역 매칭은 시·군·구로 하고
          // 상세주소는 매칭에 쓰지 않습니다.
          zipcode:       addr.zipcode || undefined,
          addressRoad:   addr.road    || undefined,
          addressJibun:  addr.jibun   || undefined,
          sido:          addr.sido    || undefined,
          sigungu:       addr.sigungu || undefined,
          addressDetail: addr.detail  || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        // 409 BIZ_REG_NO_TAKEN 은 재시도해도 같은 결과입니다
        setErr({ code: d.code ?? 'UNKNOWN', message: d.message ?? '신청하지 못했습니다.' });
        return;
      }
      setDone(d);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="result">
        <p className="ok-note">신청이 접수되었습니다. 담당자 확인 후 알려 드립니다.</p>
        {!done.ntsVerified && (
          <p className="stub-note">
            국세청 조회는 <strong>연동 준비 중</strong>입니다 — 실제 확인이 이루어지지 않았습니다.
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>사업자등록번호</span>
        {regNo
          ? <input name="bizRegNo" required readOnly defaultValue={regNo} inputMode="numeric" />
          : <input name="bizRegNo" required placeholder="1234567890" inputMode="numeric" />}
        <em>{regNo ? '국세청 조회를 마친 번호입니다' : '하이픈 없이 10자리'}</em>
      </label>
      <label className="fld"><span>상호</span><input name="companyName" required /></label>
      <label className="fld"><span>대표자명</span><input name="ceoName" required /></label>
      <AddressInput value={addr} onChange={setAddr} label="사업장 주소" />

      {err && (
        <p className="form-error" role="alert">
          {err.message}
          {err.code === 'BIZ_REG_NO_TAKEN' && <> 이미 등록된 번호는 다시 신청할 수 없습니다.</>}
        </p>
      )}

      <button className="cta-primary" disabled={pending}>
        {pending ? '신청 중…' : '사업자 인증 신청'}
      </button>
    </form>
  );
}
