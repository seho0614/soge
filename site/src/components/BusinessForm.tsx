'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('join.businessForm');
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
        setErr({ code: d.code ?? 'UNKNOWN', message: d.message ?? t('failed') });
        return;
      }
      setDone(d);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="result">
        <p className="ok-note">{t('received')}</p>
        {!done.ntsVerified && (
          <p className="stub-note">
            {t.rich('stub', { strong: (c) => <strong>{c}</strong> })}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>{t('brn')}</span>
        {regNo
          ? <input name="bizRegNo" required readOnly defaultValue={regNo} inputMode="numeric" />
          : <input name="bizRegNo" required placeholder="1234567890" inputMode="numeric" />}
        <em>{regNo ? t('brnLocked') : t('brnHint')}</em>
      </label>
      <label className="fld"><span>{t('company')}</span><input name="companyName" required /></label>
      <label className="fld"><span>{t('ceo')}</span><input name="ceoName" required /></label>
      <AddressInput value={addr} onChange={setAddr} label={t('address')} />

      {err && (
        <p className="form-error" role="alert">
          {err.message}
          {err.code === 'BIZ_REG_NO_TAKEN' && <> {t('taken')}</>}
        </p>
      )}

      <button className="cta-primary" disabled={pending}>
        {pending ? t('working') : t('submit')}
      </button>
    </form>
  );
}
