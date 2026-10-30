import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.144 (D140 · docs/220 · 설계 docs/218) — 외부 연동 › 「결제 · 계좌 연결 확인」 (SB-ADM-SIT-080 안의 한 구역 · 보기 ADMIN · 시험 SUPER)
 *
 *   ① 결제(토스) 키 확인 — 없는 주문을 조회해 키가 맞는지(돈 안 나감) · 키 종류(시험 · 운영) · 결제창 키 짝
 *   ② 1원 계좌인증 시험 — 본인 계좌로 1원 → 통장 코드 확인(하루 integ.bank_test_daily · 30분)
 *   ④ v10.155 (D148 · docs/235) 세금계산서 — 「키 확인 · 시험 발행」 한 단추(운영 주소는 조회만 · 발행은 업체 시험 주소 ETAX_TEST_URL 로만) ·
 *      7일 안 둘 다 성공해야 간주(assume.etax)를 끔(etax.require_config on)
 *   ③ 최근 시험 — PG · BANK 를 「연결됨(LIVE)」으로 바꾸려면 최근 7일 안에 성공(스텁 아님)이 있어야 함(서버가 검사)
 */

interface Status {
  pg: { status: string | null; secretKey: boolean; keyMode: string | null; clientKey: string | null; pair: boolean; lastOkAt: string | null };
  bank: { status: string | null; key: boolean; url: boolean; lastOkAt: string | null; test: { limit: number; used: number; left: number } };
  etax: { status: string | null; url: boolean; key: boolean; testUrl: boolean; testKey: string | null; lastKeyOkAt: string | null; lastIssueOkAt: string | null;
    requireTest: boolean; test: { limit: number; used: number; left: number } };
  recent: { id: string; code: string; kind: string; ok: boolean; stub: boolean; errorKind: string | null; detail: string | null; keyMode: string | null; accountLast4: string | null; pending: boolean; at: string }[];
}

const KIND: Record<string, string> = { PG_KEY: '결제 키 확인', BANK_SEND: '1원 보내기', BANK_CONFIRM: '코드 확인', ETAX_KEY: '세금계산서 키 확인', ETAX_TEST_ISSUE: '세금계산서 시험 발행' };
const MODE: Record<string, string> = { test: '시험 키', live: '운영 키' };

export function IntegTestPanel() {
  const isSuper = tokenRoles().includes('SUPER');
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [bank, setBank] = useState({ bankCode: '', accountNo: '', holderName: '' });
  const [testId, setTestId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = () => api<Status>('/admin/integ-tests').then(setSt).catch((e) => setErr(e?.message ?? '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);

  async function run<T>(fn: () => Promise<T>, show: (r: T) => { ok: boolean; text: string }) {
    setBusy(true); setRes(null);
    try { const r = await fn(); setRes(show(r)); void load(); }
    catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(false); }
  }
  const pgCheck = () => run(() => api<{ ok: boolean; detail: string; keyMode: string | null; pair: boolean }>('/admin/integ-tests/pg-check', { method: 'POST', body: '{}' }),
    (r) => ({ ok: r.ok, text: `${r.ok ? '키 확인됨' : '확인 실패'} — ${r.detail}${r.keyMode ? ` · ${MODE[r.keyMode] ?? r.keyMode}` : ''}${r.ok && !r.pair ? ' · 결제창 키 짝이 맞지 않음' : ''}` }));
  function etaxTest() {
    if (!window.confirm('세금계산서 키 확인(운영 주소 · 조회만)과 시험 발행(업체 시험 주소 · 1,000원 1건)을 할까요? 운영 주소로는 발행하지 않습니다.')) return;
    void run(() => api<{ ok: boolean; key: { ok: boolean; detail: string }; issue: { ok: boolean; detail: string }; left: number }>('/admin/integ-tests/etax-test', { method: 'POST', body: '{}' }),
      (r) => ({ ok: r.ok, text: `키 확인 ${r.key.ok ? '성공' : '실패'} — ${r.key.detail} · 시험 발행 ${r.issue.ok ? '성공' : '실패'} — ${r.issue.detail} · 오늘 남은 시험 발행 ${r.left}번` }));
  }
  function bankSend() {
    if (!window.confirm(`${bank.holderName} 님 계좌(끝 ${bank.accountNo.replace(/\D/g, '').slice(-4)})로 1원 시험을 보낼까요? 우리 돈 1원과 업체 요금이 듭니다.`)) return;
    void run(() => api<{ ok: boolean; stub: boolean; testId?: string; detail: string; left: number }>('/admin/integ-tests/bank-send', { method: 'POST', body: JSON.stringify(bank) }),
      (r) => { if (r.ok && r.testId) setTestId(r.testId); return { ok: r.ok, text: `${r.detail} · 오늘 남은 시험 ${r.left}번` }; });
  }
  const bankConfirm = () => run(() => api<{ ok: boolean; detail: string }>('/admin/integ-tests/bank-confirm', { method: 'POST', body: JSON.stringify({ testId, code }) }),
    (r) => { if (r.ok) { setTestId(null); setCode(''); } return { ok: r.ok, text: r.detail }; });

  if (err) return <div data-integtest-panel><h2 className="ad-s2">결제 · 계좌 연결 확인</h2><p className="warn-text" role="alert">{err}</p></div>;
  if (!st) return null;
  const row = (k: string, label: string, ok: boolean, now: string, fix: string) => (
    <tr key={k} data-integtest-row={k} data-ok={ok ? 'y' : 'n'}><td>{label}</td><td>{ok ? '✓' : '✗'}</td><td>{now}</td><td className="muted">{ok ? '' : fix}</td></tr>
  );
  return (
    <div data-integtest-panel>
      <h2 className="ad-s2">결제 · 계좌 연결 확인 <small className="dim">키를 넣은 뒤 실제로 붙는지 시험 — 「연결됨(LIVE)」으로 바꾸는 근거(docs/220)</small></h2>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th>할 일</th></tr></thead>
        <tbody>
          {row('pg-key', '결제 시크릿 키', st.pg.secretKey, st.pg.secretKey ? (MODE[st.pg.keyMode ?? ''] ?? '종류 모름') : '없음', '위 「연동 키」 › 전자결제')}
          {row('pg-pair', '결제창 키 짝', st.pg.pair, st.pg.clientKey ? (MODE[st.pg.clientKey] ?? st.pg.clientKey) : '없음', '시크릿 키와 같은 종류(시험 · 운영)의 클라이언트 키')}
          {row('pg-ok', '결제 키 확인(7일)', !!st.pg.lastOkAt, st.pg.lastOkAt ? ymdKst(st.pg.lastOkAt) : '없음', '아래 「결제 키 확인」')}
          {row('bank-key', '1원 인증 키 · 주소', st.bank.key && st.bank.url, st.bank.key ? (st.bank.url ? '있음' : '주소 없음') : '없음(스텁)', '연동 키 › 계좌인증 · .env BANK_VERIFY_URL')}
          {row('bank-ok', '1원 시험 성공(7일)', !!st.bank.lastOkAt, st.bank.lastOkAt ? ymdKst(st.bank.lastOkAt) : '없음', '아래 1원 시험')}
          {row('etax-conf', '세금계산서 주소 · 키', st.etax.url && st.etax.key, st.etax.url ? (st.etax.key ? '있음' : '키 없음') : '주소 없음', '.env ETAX_URL · 연동 키 › 전자세금계산서')}
          {row('etax-test-url', '세금계산서 시험 주소', st.etax.testUrl, st.etax.testUrl ? `있음(키 ${st.etax.testKey ?? '없음'})` : '없음', '.env ETAX_TEST_URL(업체 시험 환경 · 키가 다르면 ETAX_TEST_KEY)')}
          {row('etax-key-ok', '세금계산서 키 확인(7일)', !!st.etax.lastKeyOkAt, st.etax.lastKeyOkAt ? ymdKst(st.etax.lastKeyOkAt) : '없음', '아래 「세금계산서 키 확인 · 시험 발행」')}
          {row('etax-issue-ok', '세금계산서 시험 발행(7일)', !!st.etax.lastIssueOkAt, st.etax.lastIssueOkAt ? ymdKst(st.etax.lastIssueOkAt) : '없음', '아래 「세금계산서 키 확인 · 시험 발행」')}
        </tbody>
      </table>
      <p className="muted">지금 상태 — 결제 {st.pg.status ?? '-'} · 계좌인증 {st.bank.status ?? '-'} · 세금계산서 {st.etax.status ?? '-'}. 「연결됨(LIVE)」은 위 성공 줄이 ✓ 일 때만 바뀝니다.</p>
      <p className="hint" data-integtest-etax-lock={st.etax.requireTest ? 'on' : 'off'}>
        세금계산서 간주 끄기 전 확인 — <b>{st.etax.requireTest ? '켜짐' : '꺼짐'}</b>
        {st.etax.requireTest ? ' (주소 · 키 + 7일 안 키 확인 · 시험 발행 성공이 있어야 간주를 끌 수 있음 · 바꾸기는 오픈 체크리스트 › 관리자 스위치)' : ' (연동 상태만 보고 간주를 끌 수 있음)'}
      </p>
      {isSuper && (
        <>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn-sm" disabled={busy} onClick={() => void pgCheck()} data-integtest-pg>결제 키 확인(돈 안 나감)</button>
            <button className="btn-sm" disabled={busy || st.etax.test.left <= 0} onClick={etaxTest} data-integtest-etax>세금계산서 키 확인 · 시험 발행</button>
            <span className="muted">오늘 남은 시험 발행 {st.etax.test.left} / {st.etax.test.limit}번</span>
          </div>
          <div className="row-actions" style={{ marginTop: 10 }} data-integtest-bank>
            <input value={bank.bankCode} onChange={(e) => setBank({ ...bank, bankCode: e.target.value })} placeholder="은행 코드(004)" size={10} aria-label="은행 코드" data-integtest-bankcode />
            <input value={bank.accountNo} onChange={(e) => setBank({ ...bank, accountNo: e.target.value })} placeholder="계좌번호" size={18} aria-label="계좌번호" data-integtest-account />
            <input value={bank.holderName} onChange={(e) => setBank({ ...bank, holderName: e.target.value })} placeholder="예금주" size={10} aria-label="예금주" data-integtest-holder />
            <button className="btn-sm" disabled={busy || !bank.bankCode || !bank.accountNo || !bank.holderName} onClick={bankSend} data-integtest-send>1원 보내기</button>
            <span className="muted">오늘 남은 시험 {st.bank.test.left} / {st.bank.test.limit}번</span>
          </div>
          {testId && (
            <div className="row-actions" style={{ marginTop: 6 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="통장 입금자명 코드" size={16} aria-label="통장 코드" data-integtest-code />
              <button className="btn-sm" disabled={busy || !code.trim()} onClick={() => void bankConfirm()} data-integtest-confirm>코드 확인</button>
            </div>
          )}
        </>
      )}
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-integtest-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}
      {st.recent.length > 0 && (
        <table className="tbl" style={{ marginTop: 10 }} data-integtest-recent>
          <thead><tr><th>시각</th><th>시험</th><th>결과</th><th>내용</th></tr></thead>
          <tbody>{st.recent.map((r) => (
            <tr key={r.id} data-integtest-log={r.kind} data-ok={r.ok ? 'y' : 'n'}>
              <td>{ymdKst(r.at)}</td><td>{KIND[r.kind] ?? r.kind}{r.accountLast4 ? ` · ***${r.accountLast4}` : ''}</td>
              <td>{r.ok ? (r.stub ? '스텁' : '성공') : `실패 · ${r.errorKind ?? ''}`}{r.pending ? ' · 코드 대기' : ''}</td><td>{r.detail ?? ''}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
