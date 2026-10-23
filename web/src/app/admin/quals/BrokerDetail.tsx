import { useEffect, useState } from 'react';
import { ymdKst } from '../../../lib/format';
import { api } from '../../../lib/api';
import { ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { type Broker, BST, lookupView } from './shared';

/* ── SB-ADM-BRK-011 중개사 인증 상세 ─────────────────────────────── */
/* v10.32 — GET /admin/brokers/:id/evidence (보증 · 서류 · 읽기 전용) */
interface BrokerEvidence { org: string | null; certNo: string | null; amount: number | null; from: string | null; until: string | null; docs: string[]; files: number; valid: boolean }

const BR_DOC: Record<string, string> = { REG_CERT: '중개사무소 등록증', GUARANTEE: '보증(공제) 증서', LICENSE: '공인중개사 자격증', ETC: '그 밖의 서류' };

/* 시안 K.rejects — 자동(BR01 · BR02 · BR05)은 대조가 거르므로 사람이 누르지 않습니다 */
const BR_REJ: Array<[string, string, boolean]> = [
  ['BR01', '국토교통부 자료에서 해당 등록번호를 찾지 못했습니다', true],
  ['BR02', '등록 상태가 영업이 아닙니다(휴업 · 폐업 · 등록취소)', true],
  ['BR03', '제출 서류가 등록번호 · 상호 · 대표자와 맞지 않습니다', false],
  ['BR04', '보증(공제) 증서가 없거나 기간이 지났습니다', false],
  ['BR05', '이미 다른 사업자가 같은 등록번호로 인증되어 있습니다', true],
  ['BR06', '기타 — 사유를 직접 적습니다', false],
];

const eok = (v: number) => (v >= 100000000 && v % 100000000 === 0 ? `${v / 100000000}억 원` : `${v.toLocaleString('ko-KR')}원`);

/* v10.32 — 시안(scAdmBrkD) 배치: 세 칸(신청 · 국토부 자료 · 보증 · 서류) → 승인 + 안내 → 반려 사유 코드 단추 → 심사 목록으로 */
export function BrokerDetail({ id, busy, version, configured, onLookup, onDecide, onBack }: {
  id: string | null; busy: boolean; version: unknown;
  configured: boolean; onLookup: (b: Broker) => void;
  onDecide: (b: Broker, s: 'VERIFIED' | 'REJECTED', preset?: string) => void; onBack: () => void;
}) {
  const [b, setB] = useState<Broker | null>(null);
  const [ev, setEv] = useState<BrokerEvidence | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!id) return;
    api<Broker>(`/admin/brokers/${id}`).then((r) => { setB(r); setErr(null); }).catch(setErr);
    api<BrokerEvidence>(`/admin/brokers/${id}/evidence`).then(setEv).catch(() => setEv(null));
  }, [id, version]);

  if (!id) {
    return (
      <>
        <p className="muted">선택된 신청이 없습니다. 목록에서 신청을 골라 주십시오.</p>
        <button className="btn-ok" onClick={onBack}>심사 목록으로</button>
      </>
    );
  }
  if (err) return <ErrorView error={err} onRetry={onBack} />;
  if (!b) return <p className="muted">불러오는 중…</p>;
  const open = b.state === 'PENDING' || b.state === 'SUBMITTED';
  const why = b.lookupResult !== 'MATCH' ? '국토부 대조가 일치하지 않았습니다 — DB 가 승인을 막습니다' : null;
  const stKind = b.state === 'VERIFIED' ? 'ok' : b.state === 'REJECTED' || b.state === 'EXPIRED' ? 'no' : 'wait';
  return (
    <>
      {/* 제목은 위 제목 줄(SUB_PAGE 'quals/detail') */}
      <p className="dim" style={{ margin: '-4px 0 10px' }}>신청 {b.id.slice(0, 8)}</p>
      <div className="ad-brk3" data-brk-detail={b.id}>
        <div className="ad-brkbox"><span className="lb">신청</span>
          <dl>
            <dt>사업자</dt><dd>{b.company}</dd>
            <dt>사업자번호</dt><dd>{b.personal ? <>개인 신청 <span className="dim">(사업자 아님 · 본인인증 회원 — v10.38 P2P)</span></> : <>{b.bizRegNo} <span className="dim">{b.bizVerified ? '사업자 인증' : '사업자 미인증'}{b.ntsStatus ? ` · 국세청 ${b.ntsStatus}` : ''}</span></>}</dd>
            <dt>등록번호</dt><dd className="mono">{b.licenseNo}</dd>
            <dt>계정</dt><dd>{b.accountEmail}</dd>
            <dt>접수</dt><dd>{ymdhm(b.createdAt)}</dd>
            <dt>상태</dt><dd><span className={`ad-bg ${stKind}`}>{BST[b.state] ?? b.state}</span>{b.canPublish ? <span className="dim"> 부동산 매물 공개 가능</span> : null}</dd>
            {b.decidedAt && <><dt>판정</dt><dd>{ymdhm(b.decidedAt)} · {b.decidedBy ?? '—'}</dd></>}
            {b.recheckDue && <><dt>재확인 기한</dt><dd>{ymdKst(b.recheckDue)}</dd></>}
          </dl>
        </div>
        <div className="ad-brkbox"><span className="lb">국토부 자료 {b.lookupAt ? `(${ymdKst(b.lookupAt)} 기준)` : '(미조회)'}</span>
          <dl>
            <dt>상호</dt><dd>{b.officeName ?? '—'}</dd>
            <dt>대표자</dt><dd>{b.ceoName ?? '—'} {b.ceoMatch ? <span className="st ok">사업자 대표와 일치</span>
              : <span className="warn-text">사업자 대표({b.bizCeoName})와 다름 — 명의 도용을 먼저 의심하십시오</span>}</dd>
            <dt>소재지</dt><dd>{[b.sido, b.sigungu].filter(Boolean).join(' ') || '—'}</dd>
            <dt>대조</dt><dd>{lookupView(b)}
              {b.lookupSource === 'API' ? <span className="dim"> 국토부 실제 조회</span>
                : b.lookupSource === 'ASSUMED' || (!b.lookupSource && b.assumed)
                  ? <span className="warn-text"> 간주 모드 — 실제 대조 아님</span> : null}
              {b.lookupDetail ? <><br /><span className="dim">{b.lookupDetail}</span></> : null}</dd>
            <dt>부동산 매물</dt><dd>공개 {b.malPublished}건 · 공개 대기 {b.malWaiting}건</dd>
          </dl>
        </div>
        <div className="ad-brkbox" data-brk-evidence><span className="lb">보증 · 서류</span>
          {ev && ev.org ? (
            <dl>
              <dt>기관</dt><dd>{ev.org}{ev.certNo ? <span className="dim"> {ev.certNo}</span> : null}</dd>
              <dt>금액</dt><dd>{ev.amount != null ? eok(ev.amount) : '—'}{ev.amount != null && ev.amount < 200000000 && <b className="warn-text"> 법정 최저 미만</b>}</dd>
              <dt>기간</dt><dd>{ev.from ?? '—'} ~ {ev.until ?? '—'}{!ev.valid && <b className="warn-text"> 기간 지남</b>}</dd>
            </dl>
          ) : <p className="dim" style={{ margin: 0 }}>신청 때 받은 보증(공제) 정보가 없습니다.</p>}
          <div className="docs">
            {ev && ev.docs.length ? ev.docs.map((d) => <span key={d} className="ad-bg">{BR_DOC[d] ?? d}</span>)
              : <span className="dim">제출된 서류가 없습니다</span>}
            {ev && ev.files > 0 && <span className="dim">첨부 {ev.files}개</span>}
          </div>
        </div>
      </div>
      {b.rejectReason && <div className="ad-nt warn"><b>반려 사유</b> — {b.rejectReason}</div>}
      {open && why && <div className="ad-nt warn"><b>지금은 승인할 수 없습니다.</b> {why}</div>}
      {open ? (
        <>
          <div className="ad-brkact">
            <button className="btn-ok" disabled={!!why || busy} onClick={() => onDecide(b, 'VERIFIED')}>승인</button>
            <button className="btn-sm" disabled={busy || !configured} onClick={() => onLookup(b)}
                    title={configured ? '국토부 중개사무소 조회와 다시 맞춰 봅니다' : '조회 연동(BROKER_LOOKUP_URL · KEY)이 설정되지 않았습니다'}>
              국토부 다시 조회</button>
            <span className="dim">반려에는 사유가 반드시 있어야 합니다 — 아래 사유를 누르면 글이 채워지고, 신청자에게 그대로 보입니다</span>
          </div>
          <div className="ad-brkrj" data-brk-reject>
            {BR_REJ.map(([code, text, auto]) => (
              <button key={code} disabled={busy || auto} title={auto ? '자동 판정 전용 코드입니다 — 신청 때 대조가 거릅니다' : undefined}
                      onClick={() => onDecide(b, 'REJECTED', code === 'BR06' ? 'BR06 · ' : `${code} · ${text}`)}>
                <b>{code}</b><span>{text}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="dim">심사 대기 상태가 아니라 승인 · 반려 칸이 없습니다 (현재 {BST[b.state] ?? b.state}).</p>
      )}
      <div className="ad-nt warn">
        <b>보증(공제) 금액은 막지 않고 알려만 줍니다.</b> 법인 4억 · 분사무소마다 2억 · 개인 2억이지만
        분사무소 수를 서버가 모릅니다. 미달이면 판단은 검수자가 합니다.
      </div>
      <div className="ad-dact"><button className="btn-plain" onClick={onBack}>심사 목록으로</button></div>
    </>
  );
}
