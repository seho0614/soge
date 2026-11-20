/* ===== v10.501 ~ 504 (D273 · docs/639 ~ 642) ㊸ 회원 2 — web/src/app/admin/MemberMbx.tsx 새 파일 =====
 *   MbxOps        회원 › 회원 편의 기능(SB-ADM-MBX-010) — 스위치 4개(처음 모두 꺼짐 · 바꾸기 SUPER · 사유) · 감지 방식 · 수 제한 · 보관 일수 · 수 · 정리 기록
 *   MbxDmReports  회원 › 회원 대화 신고(SB-ADM-MBX-020) — 신고 목록(글 없음) → 「사유 적고 열람」(열 때마다 기록) → 조치 · 기각(대화 닫기 선택)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card · btn-sm · btn-plain · muted · warn-text · num) — 새 색 없음
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { Flash } from '../../components/Flash';

const post = (path: string, body: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(body) });
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 20) : '—');

interface MbxSet {
  recent: boolean; recentMax: number; recentKeepDays: number; compare: boolean; priceAlert: boolean; watchMax: number;
  dm: boolean; patternMode: 'WARN' | 'MASK' | 'BLOCK'; rateMin: number; rateDay: number; retentionDays: number; reportKeepDays: number;
}
interface Overview {
  settings: MbxSet; counts: Record<string, number>; hits30: Record<string, number>;
  purges: Array<{ id: string; ranAt: string; recent: number; watches: number; messages: number; reports: number; threads: number }>;
  jobs: { digest: string; purge: string };
}
const SW: Array<[keyof MbxSet, string, string]> = [
  ['recent', '최근 본 매물 · 상품', '로그인 회원이 본 것을 서버에 적음(로그인 전은 브라우저에만) · 처리방침 「서비스 이용 기록」 게시 뒤'],
  ['compare', '비교하기', '매물끼리 · 상품끼리 최대 4개 · 공개 칸만 · 담는 목록은 브라우저에만'],
  ['priceAlert', '가격 변동 알림', '회원이 켠 관심 매물 · 상품 가격이 바뀌면 매일 08:30 묶음 알림(알림 수신 설정 따름)'],
  ['dm', '회원 간 1:1 대화', '거래 · 문의 당사자끼리 글로만 · 연락처 · 계좌 감지 · 법무 확인 · 처리방침 「회원 대화」 게시 뒤'],
];
const HIT_KO: Record<string, string> = { PHONE: '전화번호', EMAIL: '메일 주소', ACCOUNT: '계좌번호로 보이는 숫자', OFF_PLATFORM: '플랫폼 밖 거래 표현' };
const MODE_KO: Record<string, string> = { WARN: '경고 뒤 그대로', MASK: '경고 뒤 가려서', BLOCK: '보내지 않음' };

/* ═════════════ 회원 편의 기능 ═════════════ */
export function MbxOps() {
  const q = useApi<Overview>('/admin/mbx/overview');
  const a = useAct();
  const su = tokenRoles().includes('SUPER');
  const [reason, setReason] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const d = q.data;
  const s = d?.settings;
  const save = (body: Record<string, unknown>) => void a.run('s', () => post('/admin/mbx/settings', { ...body, reason }, 'PUT'), () => { setF({}); q.reload(); });
  const numField = (k: keyof MbxSet, label: string, lo: number, hi: number) => (
    <label style={{ marginRight: 12 }}>{label}{' '}
      <input type="number" min={lo} max={hi} value={f[k] ?? String(s?.[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ width: 72 }} disabled={!su} data-mbx-num={k} />
    </label>
  );
  const changed = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'patternMode' ? v : Number(v)]));
  return (
    <section data-mbx-ops={d ? 'loaded' : ''}>
      <Flash msg={a.msg} err={a.err} />
      {!su && <p className="muted">설정은 SUPER 만 바꿉니다. 지금 값과 수만 보입니다.</p>}
      {s && (
        <div className="card">
          <h3 className="sec">스위치(처음 모두 꺼짐)</h3>
          <table className="tbl"><thead><tr><th>기능</th><th>지금</th><th>설명</th><th /></tr></thead>
            <tbody>{SW.map(([k, label, desc]) => (
              <tr key={k} data-mbx-switch={k} data-on={s[k] ? 'on' : 'off'}>
                <td><b>{label}</b></td><td>{s[k] ? <b>켜짐</b> : <span className="muted">꺼짐</span>}</td><td className="muted">{desc}</td>
                <td>{su && <button className="btn-sm" disabled={a.busy === 's' || reason.trim().length < 2} onClick={() => save({ [k]: !s[k] })} data-mbx-toggle={k}>{s[k] ? '끄기' : '켜기'}</button>}</td>
              </tr>))}</tbody></table>
          <p>
            <label>바꾸는 사유(2 ~ 200자 · 설정 바뀐 기록에 남음){' '}
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} size={40} disabled={!su} data-mbx-reason="" /></label>
          </p>
          <h3 className="sec">회원 대화 · 기록 설정</h3>
          <p>
            <label style={{ marginRight: 12 }}>연락처 · 계좌 · 메일 감지{' '}
              <select value={f.patternMode ?? s.patternMode} onChange={(e) => setF({ ...f, patternMode: e.target.value })} disabled={!su} data-mbx-mode="">
                {(['WARN', 'MASK', 'BLOCK'] as const).map((m) => <option key={m} value={m}>{m} — {MODE_KO[m]}</option>)}
              </select></label>
            {numField('rateMin', '1분에', 1, 60)}{numField('rateDay', '하루', 10, 2000)}
            {numField('retentionDays', '대화 보관(일)', 30, 1825)}{numField('reportKeepDays', '처리한 신고 대화 보관(일)', 30, 1825)}
          </p>
          <p>{numField('recentMax', '최근 본 개수', 5, 50)}{numField('recentKeepDays', '최근 본 보관(일)', 7, 365)}{numField('watchMax', '가격 알림 개수', 1, 200)}</p>
          {su && <p><button className="btn-sm" disabled={a.busy === 's' || !Object.keys(changed).length || reason.trim().length < 2} onClick={() => save(changed)} data-mbx-save="">설정 저장</button></p>}
        </div>
      )}
      {d && (
        <div className="card">
          <h3 className="sec">지금 수(개인 식별 없음)</h3>
          <table className="tbl"><tbody>
            <tr><th>최근 본 기록</th><td className="num">{n(d.counts.recentRows)}줄 · 회원 {n(d.counts.recentMembers)}</td></tr>
            <tr><th>가격 알림</th><td className="num">{n(d.counts.watches)}(상품 {n(d.counts.productWatches)}) · 최근 7일 묶음 {n(d.counts.digests7)}통 · {n(d.counts.digestLines7)}건</td></tr>
            <tr><th>회원 대화</th><td className="num">대화 {n(d.counts.threads)}(닫힘 {n(d.counts.lockedThreads)}) · 최근 30일 글 {n(d.counts.messages30)} · 처리 중 신고 <b>{n(d.counts.openReports)}</b></td></tr>
            <tr><th>감지(30일)</th><td data-mbx-hits="">{Object.keys(d.hits30).length ? Object.entries(d.hits30).map(([k, v]) => `${HIT_KO[k] ?? k} ${n(v)}`).join(' · ') : '없음'}</td></tr>
            <tr><th>정기 작업</th><td className="muted">가격 묶음 알림 {d.jobs.digest} · 기록 정리 {d.jobs.purge}</td></tr>
          </tbody></table>
          <h3 className="sec">정리 기록(최근 10)</h3>
          {d.purges.length === 0 ? <p className="muted">아직 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>때</th><th className="num">최근 본</th><th className="num">가격 알림</th><th className="num">대화 글</th><th className="num">신고</th><th className="num">빈 대화</th></tr></thead>
              <tbody>{d.purges.map((p) => <tr key={p.id} data-mbx-purge={p.id}><td>{dt(p.ranAt)}</td><td className="num">{n(p.recent)}</td><td className="num">{n(p.watches)}</td><td className="num">{n(p.messages)}</td><td className="num">{n(p.reports)}</td><td className="num">{n(p.threads)}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </section>
  );
}

/* ═════════════ 회원 대화 신고 ═════════════ */
interface Rep {
  id: string; threadId: string; reason: string; reasonLabel: string; detail: string | null; state: string; createdAt: string; decidedAt: string | null; decideNote: string | null;
  basisType: string; threadStatus: string; reporter: string; reported: string; messages: number; hits: number; views: number;
}
interface Msg { id: string; who: 'REPORTER' | 'REPORTED'; body: string; masked: boolean; hitCodes: string[]; createdAt: string }
const STATE_KO: Record<string, string> = { OPEN: '처리 중', UPHELD: '조치함', DISMISSED: '기각' };

export function MbxDmReports() {
  const [state, setState] = useState('OPEN');
  const q = useApi<{ items: Rep[]; counts: Record<string, number> }>(`/admin/mbx/dm/reports?state=${state}`, [state]);
  const a = useAct();
  const [sel, setSel] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [dec, setDec] = useState({ result: 'UPHELD', note: '', lock: false });
  const pick = (id: string) => { setSel(id); setMsgs(null); setWhy(''); setDec({ result: 'UPHELD', note: '', lock: false }); a.clear(); };
  const open = () => void a.run('o', async () => {
    const r = await post(`/admin/mbx/dm/reports/${sel}/open`, { reason: why }) as { messages: Msg[]; note: string };
    setMsgs(r.messages); return r;
  });
  const decide = () => void a.run('d', () => post(`/admin/mbx/dm/reports/${sel}/decide`, dec), () => { setSel(null); setMsgs(null); q.reload(); });
  const cur = q.data?.items.find((r) => r.id === sel) ?? null;
  return (
    <section data-mbx-dm-reports={q.data?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p className="muted">신고가 있는 대화만 열 수 있습니다. 열 때마다 사유가 개인정보 접속기록(위험감지 › 개인정보 접속기록)과 이 신고의 열람 기록에 남습니다. 목록에는 대화 글을 싣지 않습니다.</p>
      <p>{(['OPEN', 'UPHELD', 'DISMISSED', ''] as const).map((s) => (
        <button key={s || 'ALL'} className={`btn-sm ${state === s ? '' : 'btn-plain'}`} onClick={() => { setState(s); setSel(null); }} data-mbx-dm-tab={s || 'ALL'}>
          {s ? STATE_KO[s] : '모두'} {s ? n(q.data?.counts[s] ?? 0) : ''}</button>))}</p>
      {q.data && (q.data.items.length === 0 ? <p className="muted">신고가 없습니다.</p> : (
        <table className="tbl"><thead><tr><th>번호</th><th>접수</th><th>사유</th><th>신고 내용</th><th>신고한 회원</th><th>신고된 회원</th><th className="num">글</th><th className="num">감지</th><th className="num">열람</th><th>상태</th><th /></tr></thead>
          <tbody>{q.data.items.map((r) => (
            <tr key={r.id} data-mbx-dm-report={r.id} className={sel === r.id ? 'on' : ''}>
              <td>{r.id}</td><td>{dt(r.createdAt)}</td><td>{r.reasonLabel}</td><td>{r.detail ?? '—'}</td><td>{r.reporter}</td><td>{r.reported}</td>
              <td className="num">{n(r.messages)}</td><td className="num">{r.hits ? <span className="warn-text">{n(r.hits)}</span> : 0}</td><td className="num">{n(r.views)}</td>
              <td>{STATE_KO[r.state] ?? r.state}{r.threadStatus === 'LOCKED' && <small className="muted"> · 닫힘</small>}{r.decideNote && <><br /><small className="muted">{r.decideNote}</small></>}</td>
              <td><button className="btn-sm btn-plain" onClick={() => pick(r.id)} data-mbx-dm-pick={r.id}>보기</button></td>
            </tr>))}</tbody></table>
      ))}
      {cur && (
        <div className="card" data-mbx-dm-sel={cur.id}>
          <h3 className="sec">신고 {cur.id} — {cur.reasonLabel}</h3>
          {!msgs ? (
            <p>
              <label>열람 사유(2 ~ 200자){' '}<input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} size={48} placeholder="예: 신고 처리 — 직접 입금 유도 확인" data-mbx-dm-why="" /></label>{' '}
              <button className="btn-sm" disabled={a.busy === 'o' || why.trim().length < 2} onClick={open} data-mbx-dm-open="">사유 적고 열람</button>
            </p>
          ) : (
            <table className="tbl" data-mbx-dm-msgs={msgs.length}><thead><tr><th>때</th><th>보낸 쪽</th><th>글</th><th>감지</th></tr></thead>
              <tbody>{msgs.map((m) => (
                <tr key={m.id}><td>{dt(m.createdAt)}</td><td>{m.who === 'REPORTER' ? '신고한 회원' : '신고된 회원'}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{m.body}{m.masked && <small className="muted"> (가려 보냄)</small>}</td>
                  <td>{m.hitCodes.length ? <span className="warn-text">{m.hitCodes.map((h) => HIT_KO[h] ?? h).join(' · ')}</span> : '—'}</td></tr>))}</tbody></table>
          )}
          {cur.state === 'OPEN' && (
            <p>
              <select value={dec.result} onChange={(e) => setDec({ ...dec, result: e.target.value, lock: e.target.value === 'UPHELD' ? dec.lock : false })} data-mbx-dm-result="">
                <option value="UPHELD">조치함</option><option value="DISMISSED">기각</option></select>{' '}
              {dec.result === 'UPHELD' && <label><input type="checkbox" checked={dec.lock} onChange={(e) => setDec({ ...dec, lock: e.target.checked })} data-mbx-dm-lock="" /> 대화 닫기(서로 보낼 수 없음)</label>}{' '}
              <input value={dec.note} onChange={(e) => setDec({ ...dec, note: e.target.value })} maxLength={400} size={40} placeholder="처리 내용(2자 이상)" data-mbx-dm-note="" />{' '}
              <button className="btn-sm" disabled={a.busy === 'd' || dec.note.trim().length < 2} onClick={decide} data-mbx-dm-decide="">처리</button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
