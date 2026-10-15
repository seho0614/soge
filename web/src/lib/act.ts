import { useState } from 'react';
import { ApiFailure } from './api';

/**
 * 변경 요청 공통 (2026-10-02).
 *
 * 서버의 일부 처리 API 는 실패를 **200 + { ok:false, note }** 로 돌려줍니다
 * (예: 사유 없는 반려 · 이미 처리된 건). 이것을 성공으로 보여 주면
 * "눌렀는데 왜 그대로냐" 가 됩니다 — ok:false 는 오류로 보여 줍니다.
 */
export function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, after?: () => void,
                       okText?: string | ((r: T) => string)) {
    setBusy(key); setErr(null); setMsg(null);
    try {
      const r = await fn() as unknown as { ok?: boolean; note?: string | null } | undefined;
      if (r && typeof r === 'object' && r.ok === false) {
        setErr(r.note ?? '처리하지 못했습니다.');
      } else {
        setMsg(typeof okText === 'function' ? okText(r as unknown as T)
          : okText ?? r?.note ?? '처리했습니다.');
        after?.();
      }
      return r as unknown as T;
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
      return undefined;
    } finally { setBusy(null); }
  }
  const clear = () => { setMsg(null); setErr(null); };
  return { busy, msg, err, run, clear, setErr, setMsg };
}

/** 금액 · 수량 표시. 서버가 문자열로 주는 numeric 도 있습니다. */
export const n = (v: unknown) => Number(v ?? 0).toLocaleString('ko-KR');
/** 날짜만 */
export const ymd = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR') : '—');
/** 날짜 · 시각 */
export const ymdhm = (s?: string | null) => (s ? new Date(s).toLocaleString('ko-KR') : '—');
