'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * 주소 입력 (Daum 우편번호 서비스).
 *
 * ── 왜 붙이는가 ────────────────────────────────────────────────────
 * 기존에는 한 줄짜리 자유 입력이었습니다. 그러면
 *   "서울 강남구 테헤란로 1" · "서울시 강남 테헤란로1길" · "강남구 역삼동"
 * 이 전부 다른 값으로 쌓입니다. 지역으로 소개 요청을 매칭해야 하는데
 * 자유 입력으로는 같은 동네인지 알 수 없습니다.
 *
 * ── 키가 필요 없습니다 ──────────────────────────────────────────────
 * Daum 우편번호 서비스는 무료이고 별도 신청이나 키가 없습니다.
 * 그래서 .env 에 넣을 것이 없고, check-secrets 에 걸릴 것도 없습니다.
 *
 * ── 스크립트를 미리 받지 않습니다 ───────────────────────────────────
 * 버튼을 누를 때 처음 받습니다. 주소를 입력하지 않는 사람에게까지
 * 외부 스크립트를 받게 할 이유가 없습니다.
 */

const SCRIPT_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

export interface AddressValue {
  /** 우편번호 5자리 */
  zipcode: string;
  /** 도로명 주소 (기본) */
  road: string;
  /** 지번 주소 */
  jibun: string;
  /** 시·도 — 지역 매칭에 씁니다 */
  sido: string;
  /** 시·군·구 */
  sigungu: string;
  /** 이용자가 직접 적는 나머지 */
  detail: string;
}

export const EMPTY_ADDRESS: AddressValue = {
  zipcode: '', road: '', jibun: '', sido: '', sigungu: '', detail: '',
};

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저에서만 동작합니다'));
  if ((window as any).daum?.Postcode) return Promise.resolve();
  // 여러 번 눌러도 스크립트는 한 번만 받습니다.
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => { loading = null; reject(new Error('주소 검색을 불러오지 못했습니다')); };
    document.head.appendChild(el);
  });
  return loading;
}

interface Props {
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  /** 상세주소 입력을 감춥니다. 지역만 필요할 때 씁니다 */
  hideDetail?: boolean;
  required?: boolean;
  label?: string;
}

export function AddressInput({
  value, onChange, hideDetail = false, required = false, label = '주소',
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detailRef = useRef<HTMLInputElement>(null);

  const open = useCallback(async () => {
    setErr(null); setBusy(true);
    try {
      await loadScript();
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          onChange({
            zipcode: data.zonecode ?? '',
            road: data.roadAddress ?? '',
            jibun: data.jibunAddress ?? '',
            sido: data.sido ?? '',
            sigungu: data.sigungu ?? '',
            detail: value.detail,
          });
          // 주소를 고르면 바로 상세주소를 적게 합니다. 한 번 덜 누릅니다.
          if (!hideDetail) setTimeout(() => detailRef.current?.focus(), 0);
        },
        onclose: () => setBusy(false),
      }).open();
    } catch (e: any) {
      // 외부 스크립트라 사내망·차단 환경에서 안 올 수 있습니다.
      // 그때 주소를 못 넣게 하면 가입 자체가 막힙니다.
      setErr(`${e.message} 아래에 직접 입력하실 수 있습니다.`);
      setBusy(false);
    }
  }, [onChange, value.detail, hideDetail]);

  const set = (k: keyof AddressValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });

  return (
    <div className="addr">
      <label className="fld">
        <span>{label}{required && <em className="req"> *</em>}</span>
        <div className="addr-row">
          <input
            className="addr-zip"
            value={value.zipcode}
            onChange={set('zipcode')}
            placeholder="우편번호"
            readOnly={!err}
            aria-label="우편번호"
          />
          <button type="button" className="btn-sm" onClick={open} disabled={busy}>
            {busy ? '여는 중…' : '주소 검색'}
          </button>
        </div>
      </label>

      <input
        className="addr-road"
        value={value.road}
        onChange={set('road')}
        placeholder="도로명 주소"
        readOnly={!err}
        aria-label="도로명 주소"
      />

      {!hideDetail && (
        <input
          ref={detailRef}
          className="addr-detail"
          value={value.detail}
          onChange={set('detail')}
          placeholder="상세주소 (동·호수 등)"
          aria-label="상세주소"
        />
      )}

      {err && <p className="form-error">{err}</p>}

      {value.sido && (
        <p className="dim">
          지역 매칭에 <strong>{value.sido} {value.sigungu}</strong> 를 씁니다.
          상세주소는 매칭에 쓰지 않습니다.
        </p>
      )}
    </div>
  );
}
