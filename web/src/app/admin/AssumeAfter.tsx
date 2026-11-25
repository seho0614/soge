import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

/**
 * v10.792 (D331 · docs/907) — 오픈 체크리스트 › 「간주 끈 뒤 처리」(「간주 모드 끄는 순서」 바로 아래)
 *
 *   탭 ① 중개사 재대조 — 간주로 승인된 중개사를 국토부 조회로 다시 맞춤(SUPER · 50건씩). 다름 · 없음이면 운영 알림만 ·
 *        **승인은 그대로**(대표 11/25 「알림만 · 사람이 판단」) · 운영자가 확인 사유를 적어 닫음.
 *   탭 ② 시험 기록 — 구독 청구 · 소개몰 결제 · 리드 캐시 충전 · 지급 요청의 시험(스텁) 기록 최근 50건씩 「시험」 표시(읽기만).
 *   탭 ③ 시험 하위가맹점 번호 — STUB-SUB-… 판매자 · 결제대행사 화면에서 받은 실제 번호로 바꾸기(지금 길 그대로).
 */
interface Broker {
  id: string; licenseNo: string; officeName: string | null; decidedAt: string | null;
  recheckId: string | null; lastResult: string | null; lastDetail: string | null; lastCheckedAt: string | null;
  ackAt: string | null; ackNote: string | null; matched: boolean;
}
interface StubKind { key: string; label: string; total: number; rows: { id: string; amount: number | null; status: string | null; at: string }[] }
interface Seller { id: string; code: string; name: string; status: string; submerchantId: string }
interface Data {
  broker: { configured: boolean; pending: number; max: number; items: Broker[] };
  stubs: StubKind[]; sellers: Seller[]; note: string;
}

const RESULT: Record<string, string> = { MATCH: '일치', MISMATCH: '다름', NOT_FOUND: '없음', FAILED: '조회 실패' };

export function AssumeAfter() {
  const q = useApi<Data>('/admin/assume-after');
  const a = useAct();
  const [tab, setTab] = useState<'broker' | 'stubs' | 'sellers'>('broker');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [subs, setSubs] = useState<Record<string, string>>({});
  const isSuper = tokenRoles().includes('SUPER');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  const d = q.data;
  const stubTotal = d.stubs.reduce((s, k) => s + k.total, 0);

  const recheck = () => void a.run('recheck', () => api<{ checked: number; match: number; mismatch: number; notFound: number; failed: number; pending: number }>(
    '/admin/assume-after/broker-recheck', { method: 'POST', body: JSON.stringify({}) }), q.reload,
    (r) => `재대조 ${r.checked}건 — 일치 ${r.match} · 다름 ${r.mismatch} · 없음 ${r.notFound} · 조회 실패 ${r.failed} · 남은 대상 ${r.pending}`);
  const ack = (b: Broker) => void a.run(`ack-${b.recheckId}`, () => api(`/admin/assume-after/broker-recheck/${b.recheckId}/ack`,
    { method: 'POST', body: JSON.stringify({ note: (notes[b.recheckId!] ?? '').trim() }) }), q.reload, '확인으로 닫았습니다.');
  const setSub = (s: Seller) => void a.run(`sub-${s.id}`, () => api(`/admin/health/sellers/${s.id}/submerchant`,
    { method: 'POST', body: JSON.stringify({ submerchantId: (subs[s.id] ?? '').trim() }) }), q.reload, '하위가맹점 번호를 바꿨습니다.');

  return (
    <section className="card" data-assume-after={`${d.broker.pending}|${stubTotal}|${d.sellers.length}`} style={{ margin: '10px 0' }}>
      <b>간주 끈 뒤 처리</b> <small className="dim">{d.note}</small>
      <div className="subtabs" style={{ margin: "6px 0" }}>
        <button className={tab === 'broker' ? 'on' : ''} onClick={() => setTab('broker')} data-aa-tab="broker">중개사 재대조 <em>{d.broker.pending}</em></button>
        <button className={tab === 'stubs' ? 'on' : ''} onClick={() => setTab('stubs')} data-aa-tab="stubs">시험 기록 <em>{stubTotal}</em></button>
        <button className={tab === 'sellers' ? 'on' : ''} onClick={() => setTab('sellers')} data-aa-tab="sellers">시험 하위가맹점 번호 <em>{d.sellers.length}</em></button>
      </div>
      <Flash msg={a.msg} err={a.err} />

      {tab === 'broker' && (
        <div data-aa-broker={d.broker.configured ? 'on' : 'off'}>
          <div>
            재대조 남은 대상 <b>{d.broker.pending}</b>건 · 국토부 조회 연동 {d.broker.configured ? <b className="form-ok">설정됨</b> : <span className="warn-text">설정 안 됨(재대조 불가)</span>}
            {' '}{isSuper && <button className="btn-ok" disabled={!d.broker.configured || d.broker.pending === 0 || a.busy === 'recheck'} onClick={recheck} data-aa-recheck>
              재대조 {Math.min(d.broker.max, d.broker.pending)}건 하기</button>}
          </div>
          <small className="dim">다름 · 없음이어도 승인은 그대로입니다 — 운영 알림이 가고, 운영자가 확인 사유를 적어 닫습니다. 해제가 필요하면 회원 상세에서 따로 판단합니다.</small>
          <table className="tbl" style={{ marginTop: 6 }}>
            <thead><tr><th>등록번호</th><th>사무소</th><th>승인일</th><th>최근 재대조</th><th>확인</th></tr></thead>
            <tbody>
              {d.broker.items.length === 0 ? <tr><td colSpan={5} className="muted">간주로 승인된 중개사가 없습니다.</td></tr>
                : d.broker.items.map((b) => (
                  <tr key={b.id} data-aa-broker-row={b.lastResult ?? 'NONE'}>
                    <td className="mono">{b.licenseNo}</td>
                    <td>{b.officeName ?? '—'}</td>
                    <td>{b.decidedAt ? ymdhm(b.decidedAt) : '—'}</td>
                    <td>{b.lastResult ? <><b className={b.lastResult === 'MATCH' ? 'form-ok' : 'warn-text'}>{RESULT[b.lastResult] ?? b.lastResult}</b> <span className="dim">{b.lastCheckedAt ? ymdhm(b.lastCheckedAt) : ''} {b.lastDetail ?? ''}</span></> : <span className="muted">아직</span>}</td>
                    <td>
                      {b.ackAt ? <span className="dim" data-aa-acked>확인함 {ymdhm(b.ackAt)} — {b.ackNote}</span>
                        : b.recheckId && (b.lastResult === 'MISMATCH' || b.lastResult === 'NOT_FOUND') && isSuper ? (
                          <span>
                            <input value={notes[b.recheckId] ?? ''} maxLength={200} placeholder="확인 내용(2 ~ 200자)" data-aa-ack-note
                                   onChange={(e) => setNotes({ ...notes, [b.recheckId!]: e.target.value })} />
                            <button className="btn-plain" disabled={(notes[b.recheckId] ?? '').trim().length < 2 || a.busy === `ack-${b.recheckId}`} onClick={() => ack(b)} data-aa-ack>확인으로 닫기</button>
                          </span>) : <span className="muted">—</span>}
                    </td>
                  </tr>))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stubs' && (
        <div data-aa-stubs>
          <small className="dim">시험(스텁) 승인으로 만들어진 기록입니다. 실제 돈이 오가지 않았습니다 — 매출 · 정산 화면에서 빼고 보는지 확인하십시오.</small>
          {d.stubs.map((k) => (
            <details key={k.key} data-aa-stub-kind={k.key} data-aa-stub-total={k.total} style={{ marginTop: 6 }}>
              <summary>{k.label} — <b>{k.total}</b>건{k.total > k.rows.length ? ` (최근 ${k.rows.length}건 표시)` : ''}</summary>
              <table className="tbl">
                <thead><tr><th></th><th>번호</th><th>금액</th><th>상태</th><th>시각</th></tr></thead>
                <tbody>
                  {k.rows.length === 0 ? <tr><td colSpan={5} className="muted">없음</td></tr> : k.rows.map((r) => (
                    <tr key={r.id} data-aa-stub-row>
                      <td><span className="badge" data-aa-stub-badge>시험</span></td>
                      <td className="mono">{r.id.slice(0, 8)}</td>
                      <td>{r.amount != null ? `${r.amount.toLocaleString('ko-KR')}원` : '—'}</td>
                      <td>{r.status ?? '—'}</td>
                      <td>{ymdhm(r.at)}</td>
                    </tr>))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}

      {tab === 'sellers' && (
        <div data-aa-sellers>
          <small className="dim">결제대행사 화면에서 받은 실제 하위가맹점 번호를 적습니다. 시험 번호(STUB-SUB-…)로는 실제 지급이 되지 않습니다.</small>
          <table className="tbl" style={{ marginTop: 6 }}>
            <thead><tr><th>판매자</th><th>상태</th><th>지금 번호</th><th>실제 번호</th></tr></thead>
            <tbody>
              {d.sellers.length === 0 ? <tr><td colSpan={4} className="muted">시험 번호가 붙은 판매자가 없습니다.</td></tr>
                : d.sellers.map((s) => (
                  <tr key={s.id} data-aa-seller={s.code}>
                    <td>{s.name} <span className="mono dim">{s.code}</span></td>
                    <td>{s.status}</td>
                    <td className="mono">{s.submerchantId}</td>
                    <td>
                      <input value={subs[s.id] ?? ''} maxLength={60} placeholder="결제대행사 번호" data-aa-sub-input
                             onChange={(e) => setSubs({ ...subs, [s.id]: e.target.value })} />
                      <button className="btn-plain" disabled={!(subs[s.id] ?? '').trim() || (subs[s.id] ?? '').trim().startsWith('STUB-') || s.status !== 'ACTIVE' || a.busy === `sub-${s.id}`}
                              onClick={() => setSub(s)} data-aa-sub-save>바꾸기</button>
                    </td>
                  </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
