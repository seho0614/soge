import { useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { ymdhm } from '../lib/act';

/**
 * v10.34 (D093 · 2026-10-11) 국세청 전자세금계산서 전송 — 운영 화면 두 곳(법률 · 세무 정액 노출료 · 리드 이용료)의 공통 칸.
 *
 *   POST /admin/etax/{kind}/{id}/send     발행 — 간주 모드면 「간주 발행」(승인번호 없음) · 연동이면 업체로 전송
 *   POST /admin/etax/{kind}/{id}/resend   다시 보내기 — 실패한 줄 · 간주 줄(연동 뒤). 업체에 보낸 적이 있으면 서버가 먼저 상태 조회
 *   POST /admin/etax/{kind}/{id}/refresh  상태 조회 — 승인 대기(SENDING) · 업체에 보낸 뒤 실패로 남은 줄
 *   POST /admin/etax/{kind}/{id}/cancel   취소 · 수정 발행 — 보낸(SENT) 줄만 · 사유 5자
 *   GET  /admin/etax/status               연동 상태 띠(간주 · 어댑터 · 키 등록 여부 — 키 값은 서버가 싣지 않음)
 *
 * 손으로 번호 넣기(연동 전 임시 방식)는 각 화면에 그대로 두고 「손으로」로 구분합니다.
 */
export type EtaxKind = 'directory' | 'lead-cash';
export interface EtaxRow {
  id: string; state: string; invoiceNo: string | null;
  etaxMode?: string | null; etaxStatus?: string | null; assumed?: boolean; approvalNo?: string | null;
  etaxError?: string | null; attempts?: number; adapter?: string | null; sentAt?: string | null; resultAt?: string | null; docKey?: string | null;
}
interface EtaxStatus {
  assume: boolean; adapter: string | null; configured: boolean; urlHost: string | null; keyName: string; keySet: boolean;
  integration: { status: string; statusLabel: string; provider: string | null } | null; note: string;
}
type Act = { busy: string | null; run: <T>(key: string, fn: () => Promise<T>, after?: () => void, okText?: string | ((r: T) => string)) => Promise<T | undefined>; setErr: (s: string | null) => void };

const ST: Record<string, [string, string]> = {
  ASSUMED: ['간주 발행 — 국세청 전송 없음', 'wait'], SENDING: ['보내는 중 · 승인 대기', 'wait'], SENT: ['국세청 전송됨', 'ok'],
  FAILED: ['전송 실패', 'no'], CANCELED: ['취소 · 수정 발행', ''],
};

/** 연동 상태 띠 — 간주 모드 · 업체 · 키 등록 여부(값은 가림) */
export function EtaxBanner() {
  const s = useApi<EtaxStatus>('/admin/etax/status');
  if (!s.data) return null;
  const d = s.data;
  return (
    <div className={`ad-nt ${d.assume || !d.adapter ? 'warn' : 'info'}`} data-etax-banner={d.adapter ?? 'none'}>
      <b>국세청 전자세금계산서 — {d.assume ? '간주 모드(assume.etax on)' : d.adapter === 'http' ? `업체 연동(${d.urlHost ?? ''})` : '연동 없음'}</b>{' '}
      {d.note}{' '}
      <span className="dim">업체 {d.integration?.provider ?? '미정'} · 연동 상태 {d.integration?.statusLabel ?? '—'} · 키 {d.keyName} {d.keySet ? '등록됨(값은 가림)' : '미등록'}</span>
      {/* v10.34 (10/12 대표 확인) — 업체 연동 전 발행 절차: 홈택스에서 발행 → 승인번호 · 발행일을 손으로 넣음. 작성일자는 입금 확인일과 달라도 됨 */}
      {d.assume || !d.adapter ? (
        <><br /><b>업체 연동 전 발행 절차</b> — 「발행(간주)」은 실제 세금계산서가 아닙니다. <b>홈택스에서 발행</b>한 뒤 그 줄의
          「홈택스 발행 번호 넣기」에 승인번호와 발행일을 적어 주십시오. 작성일자는 입금 확인일과 달라도 됩니다.</>
      ) : null}
    </div>
  );
}

/** 한 줄의 전송 상태 · 승인번호 · 단추 */
export function EtaxCell({ kind, row, act, reload, assume }: { kind: EtaxKind; row: EtaxRow; act: Act; reload: () => void; assume?: boolean }) {
  const [why, setWhy] = useState('');
  const base = `/admin/etax/${kind}/${row.id}`;
  const st = row.etaxStatus ? ST[row.etaxStatus] : null;
  const go = (what: 'send' | 'resend' | 'refresh') => act.run(`${row.id}:${what}`, () => api<{ note?: string }>(`${base}/${what}`, { method: 'POST', body: '{}' }), reload);
  const busy = act.busy?.startsWith(row.id) ?? false;
  const canSend = row.state === 'REQUESTED' && !row.etaxStatus && row.etaxMode !== 'MANUAL';
  const canResend = row.etaxStatus === 'FAILED' || (row.etaxStatus === 'ASSUMED' && assume === false);
  const canRefresh = row.etaxStatus === 'SENDING' || (row.etaxStatus === 'FAILED' && row.adapter === 'http');
  const canCancel = row.etaxStatus === 'SENT';
  return (
    <div data-etax-cell={row.etaxStatus ?? (row.etaxMode === 'MANUAL' ? 'MANUAL' : 'NONE')}>
      {row.etaxMode === 'MANUAL' ? <span className="ad-bg ok" title="연동 전 임시 방식 — 국세청 전송 기록 없음">손으로 번호</span> : null}
      {st ? <span className={`ad-bg ${st[1]}`}>{st[0]}</span> : null}
      {row.approvalNo ? <><br /><span className="mono" data-etax-approval>승인번호 {row.approvalNo}</span></> : null}
      {row.assumed ? <><br /><span className="hint">승인번호 없음 — 실제 발행이 아닙니다(간주). 문서 번호 {row.docKey}</span></> : null}
      {row.etaxStatus === 'FAILED' && row.etaxError ? <><br /><span className="warn-text" data-etax-error>{row.etaxError}</span></> : null}
      {row.etaxStatus && row.etaxStatus !== 'ASSUMED' ? <><br /><span className="hint">시도 {row.attempts ?? 0}회 · {ymdhm(row.resultAt ?? row.sentAt)}</span></> : null}
      {canSend || canResend || canRefresh || canCancel ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        {canSend ? (
          <button className="btn-ok btn-sm" data-act="etax-send" disabled={busy} onClick={() => void go('send')}>
            {assume === false ? '발행(국세청 전송)' : '발행(간주 · 시험용)'}
          </button>
        ) : null}
        {canResend ? (
          <button className="btn-plain btn-sm" data-act="etax-resend" disabled={busy} onClick={() => void go('resend')}>다시 보내기</button>
        ) : null}
        {canRefresh ? (
          <button className="btn-plain btn-sm" data-act="etax-refresh" disabled={busy} onClick={() => void go('refresh')}>상태 조회</button>
        ) : null}
        {canCancel ? (
          <>
            <input aria-label="취소 · 수정 발행 사유" placeholder="취소 · 수정 발행 사유(5자 이상)" value={why} onChange={(e) => setWhy(e.target.value)} />
            <button className="btn-plain btn-sm" data-act="etax-cancel" disabled={busy} onClick={() => {
              if (why.trim().length < 5) { act.setErr('취소 · 수정 발행 사유를 5자 이상 적어 주십시오.'); return; }
              void act.run(`${row.id}:cancel`, () => api(`${base}/cancel`, { method: 'POST', body: JSON.stringify({ reason: why.trim() }) }), () => { setWhy(''); reload(); });
            }}>취소 · 수정 발행</button>
          </>
        ) : null}
      </div> : null}
    </div>
  );
}

/** 지금 간주 모드인지 — 단추 이름(발행(간주) · 발행(국세청 전송))과 「다시 보내기」를 보일지 정합니다 */
export function useEtaxAssume(): boolean | undefined {
  const s = useApi<EtaxStatus>('/admin/etax/status');
  return s.data ? s.data.assume : undefined;
}
