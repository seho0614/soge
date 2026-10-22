import { useApi } from '../../lib/useApi';
import { ymdKst } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';

interface Adv {
  id: string; code: string; name: string; status: string;
  contactPhone?: string; bookings: number; billed: number;
  collected: number; unpaid: number;
}
interface Inv {
  id: string; invoiceNo: string; advertiser: string;
  total: number; paid: number; unpaid: number;
  status: string; dueDate: string;
}
interface Sum {
  advertisers: number; invoicesThisMonth: number;
  billedThisMonth: number; collectedThisMonth: number;
  unpaidTotal: number; overdueCount: number;
  overdueRunning: Array<{ creativeCode: string; advertiser: string; unpaid: number; overdueDays: number }>;
}

interface Recv {
  id: string; invoiceNo: string; advertiser: string; total: number; paid: number; unpaid: number;
  dueDate: string; overdueDays: number; status: string;
}

const ST: Record<string, string> = {
  ISSUED: '발행', PARTIAL: '일부 입금', PAID: '완납', OVERDUE: '연체', VOID: '취소',
};
const won = (n: number) => Number(n || 0).toLocaleString();

/**
 * SB-ADM-ADB-010 광고 과금 · 정산
 * SB-ADS-PAY-010 광고 과금 · 청구 (청구 · 미수금 · 월 집계)
 *
 * ── 왜 본체에 두나 ──────────────────────────────────────────────────
 * 광고를 분리하지 않기로 했습니다. 관리자 · 백오피스 · 결제 · 정산을
 * **한 화면에서** 끝냅니다.
 *
 * ── 소개비와 섞지 않습니다 ──────────────────────────────────────────
 * 광고비는 **우리가 받는 돈**이고, 소개비는 당사자끼리 주고받는
 * 돈입니다(INV-9R · INV-11).
 *
 * ── 입금 기록은 여기서 하지 않습니다 (2026-10-02) ───────────────────
 * 입금 기록 API 는 지급 담당(PAYOUT)만 부를 수 있습니다(2026-10-01 결정 Q1).
 * 전에는 이 화면에 입금 폼이 있었는데 토큰 없이 fetch 를 불러 늘 403 이었습니다.
 * 입금은 '지급' 탭의 광고비 미수금에서 지급 담당이 기록합니다.
 */
export function AdBilling() {
  const { data: sum, error } = useApi<Sum>('/admin/ad-settlement');
  const { data: advs } = useApi<Adv[]>('/admin/advertisers');
  const { data: invs } = useApi<Inv[]>('/admin/ad-invoices');
  const recv = useApi<Recv[]>('/admin/ad-receivables');

  if (error) return <ErrorView error={error} />;
  if (!sum) return <p className="dim">불러오는 중…</p>;

  return (
    <div>
      {sum.overdueRunning.length > 0 && (
        <div className="notice warn">
          <b>연체인데 아직 나가는 광고가 {sum.overdueRunning.length}건 있습니다.</b>
          받지 못한 채 노출만 계속하면 손해가 커집니다 — 광고를 멈추거나
          입금을 받으십시오.
        </div>
      )}

      <h3>이번 달</h3>
      <table className="tbl">
        <tbody>
          <tr><th>광고주</th><td>{sum.advertisers}곳</td></tr>
          <tr><th>청구</th><td>{sum.invoicesThisMonth}건 · <b>{won(sum.billedThisMonth)}원</b></td></tr>
          <tr><th>수금</th><td><b>{won(sum.collectedThisMonth)}원</b></td></tr>
          <tr>
            <th>미수금</th>
            <td>
              {sum.unpaidTotal > 0
                ? <b style={{ color: 'var(--sgb-rd-text)' }}>{won(sum.unpaidTotal)}원</b>
                : <span className="dim">없음</span>}
              {sum.overdueCount > 0 && <span className="dim"> · 연체 {sum.overdueCount}건</span>}
            </td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>청구 {(invs ?? []).length}건</h3>
      <table className="tbl">
        <thead>
          <tr><th>청구번호</th><th>광고주</th><th>금액</th><th>입금</th><th>납기</th><th>상태</th></tr>
        </thead>
        <tbody>
          {(invs ?? []).map((i) => (
              <tr key={i.id}>
                <td><b>{i.invoiceNo}</b></td>
                <td>{i.advertiser}</td>
                <td>{won(i.total)}</td>
                <td>
                  {won(i.paid)}
                  {i.unpaid > 0 && <b style={{ color: 'var(--sgb-rd-text)' }}> · 잔액 {won(i.unpaid)}</b>}
                </td>
                <td className="dim">{ymdKst(i.dueDate)}</td>
                <td>
                  <span className={`badge ${i.status === 'PAID' ? '' : 'badge-urgent'}`}>
                    {ST[i.status] ?? i.status}
                  </span>
                </td>
              </tr>
          ))}
        </tbody>
      </table>

      {(invs ?? []).length === 0 && <p className="muted">발행한 청구가 없습니다.</p>}

      <h3 style={{ marginTop: 24 }}>미수금 {(recv.data ?? []).length}건</h3>
      {recv.error ? <ErrorView error={recv.error} onRetry={recv.reload} /> : null}
      {recv.data && recv.data.length === 0 && <p className="muted">미수금이 없습니다.</p>}
      {(recv.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>청구번호</th><th>광고주</th><th>잔액</th><th>납기</th><th>연체</th></tr></thead>
          <tbody>
            {(recv.data ?? []).map((v) => (
              <tr key={v.id}>
                <td><b>{v.invoiceNo}</b></td><td>{v.advertiser}</td>
                <td><b style={{ color: 'var(--sgb-rd-text)' }}>{won(v.unpaid)}원</b></td>
                <td className="dim">{ymdKst(v.dueDate)}</td>
                <td>{v.overdueDays > 0 ? <b className="warn-text">{v.overdueDays}일</b> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint"><b>입금 기록은 지급 담당이 &lsquo;지급&rsquo; 탭에서 합니다.</b> 청구를 확정하는 사람과 돈을 기록하는 사람을 나눕니다.</p>

      <h3 style={{ marginTop: 24 }}>광고주 {(advs ?? []).length}곳</h3>
      <table className="tbl">
        <thead>
          <tr><th>광고주</th><th>연락처</th><th>예약</th><th>청구</th><th>수금</th><th>미수</th><th>상태</th></tr>
        </thead>
        <tbody>
          {(advs ?? []).map((a) => (
            <tr key={a.id}>
              <td><b>{a.name}</b><span className="dim"> {a.code}</span></td>
              <td className="dim">{a.contactPhone ?? '—'}</td>
              <td>{a.bookings}</td>
              <td>{won(a.billed)}</td>
              <td>{won(a.collected)}</td>
              <td>
                {a.unpaid > 0
                  ? <b style={{ color: 'var(--sgb-rd-text)' }}>{won(a.unpaid)}</b>
                  : <span className="dim">—</span>}
              </td>
              <td>
                <span className={`badge ${a.status === 'ACTIVE' ? '' : 'badge-urgent'}`}>
                  {a.status === 'ACTIVE' ? '정상' : a.status === 'PAUSED' ? '중지' : '차단'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* v10.31 — 시안 안내 2개(서버 규칙 trg_ad_payment_ro · trg_ad_payment_apply 와 같음) */}
      <div className="notice">
        <b>입금 기록은 고치거나 지울 수 없습니다.</b> 잘못 넣으셨으면 반대 기록을 남기십시오 — 돈이 들어온 기록이라 나중에 따질 때 근거가 됩니다.
      </div>
      <div className="notice">
        <b>부분 입금을 받으면 자동으로 상태가 바뀝니다.</b> 합계가 청구액에 닿으면 완납이 됩니다 — 사람이 바꾸게 하면 빠뜨립니다.
      </div>
      <div className="notice">
        <b>광고비는 우리가 받는 돈입니다.</b> 소개비(당사자끼리 주고받음)와
        섞지 않습니다 — 정산 표를 같이 쓰면 언젠가 섞입니다.
      </div>
      <div className="notice">
        <b>광고주를 차단하면 나가던 광고도 함께 멈춥니다.</b>
        광고주는 막았는데 광고는 계속 나가면 막은 의미가 없습니다.
      </div>
    </div>
  );
}
