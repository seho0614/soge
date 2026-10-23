import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

interface Medical {
  creativeCode: string; advertiser: string;
  category: string; reviewNo: string | null; confirmedAt?: string | null;
}

/* ── SB-ADM-PTN-040 의료 심의 ────────────────────────────────────── */
/* v10.32 — 시안(scAdmPtnMed) 배치: 위 노란 사전심의 띠 → 소재 카드(제목 · 번호 · 광고주 · 분야 / 심의 번호 · 근거 법 칩 · 단계 / 승인 대기 · 단추) → 노란 띠.
 * 「심의필 확인」은 광고 탭과 같은 서버 호출(POST /admin/ad-creatives/:code/review-confirm)입니다.
 * v10.32 — 시안 「반려」 단추: POST /admin/ad-creatives/:code/review-reject(사유 필수 · 감사 기록 · ADMIN · SUPER · D091).
 *   개발에만 있던 「광고 소재 보기」(광고 탭으로)는 카드 안 단계 줄 옆 작은 단추로 남깁니다(시안 단추 자리 = 반려 · 심의필 확인). */
const MED_LAW: Record<string, string> = { 의료: '의료법 제27조 · 제56조' };

export function MedicalView({ onGo }: { onGo?: (tab: string) => void }) {
  const medical = useApi<Medical[]>('/admin/qualifications/medical');
  const creatives = useApi<Array<{ code: string; title?: string }>>('/admin/ad-creatives');
  const a = useAct();
  if (medical.error) return <ErrorView error={medical.error} onRetry={medical.reload} />;
  const med = medical.data ?? [];
  const title = (code: string) => (creatives.data ?? []).find((c) => c.code === code)?.title;
  function confirmReview(code: string) {
    const reviewNo = prompt(`${code} 의 심의필 번호 — 발급처에서 조회한 번호를 적어 주십시오`) ?? '';
    if (!reviewNo.trim()) return;
    void a.run(code, () => api(`/admin/ad-creatives/${code}/review-confirm`, {
      method: 'POST', body: JSON.stringify({ reviewNo: reviewNo.trim() }),
    }), medical.reload, '심의필을 확인했습니다. 이제 슬롯에 배정할 수 있습니다.');
  }
  function rejectReview(code: string) {
    const reason = prompt(`${code} 반려 사유 — 무엇이 맞지 않았는지까지 적어 주십시오 (감사 기록에 남습니다)`) ?? '';
    if (reason.trim().length < 2) { if (reason) alert('반려 사유를 두 글자 이상 적어 주십시오.'); return; }
    void a.run(code, () => api(`/admin/ad-creatives/${code}/review-reject`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), medical.reload, '반려했습니다. 이 소재는 심의 대기에서 빠지고 슬롯에 배정되지 않습니다.');
  }
  return (
    <>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'quals/medical') */}
      <div className="ad-nt warn"><b>의료광고는 사전심의 대상입니다. 본사가 심의필을 확인해야 광고 가능으로 넘어갑니다</b> — 확인 전에는 어떤 슬롯에도 배정되지 않습니다(DB 가 막습니다).</div>
      <Flash msg={a.msg} err={a.err} />
      {medical.data && med.length === 0 && <p className="ad-empty">심의 확인 대기 소재가 없습니다.</p>}
      {med.map((m) => (
        <div key={m.creativeCode} className="ad-mrow" data-med={m.creativeCode}>
          <div className="mt">
            <b>{title(m.creativeCode) || `${m.advertiser} 광고 소재`}</b>
            <span className="ls">{m.creativeCode} · {m.advertiser} · {m.category}</span>
            <div className="lh">
              <span className={`ad-chip${m.reviewNo ? '' : ' no'}`}>{m.reviewNo ? `심의 ${m.reviewNo}` : '심의필 미제출'}</span>
              <span className="ad-chip warn">{MED_LAW[m.category] ?? '사전심의 대상'}</span>
            </div>
            <span className="ls">{m.reviewNo ? '심의필 등록 완료 → 본사 확인 대기' : '심의필 번호를 받아 발급처에서 조회한 뒤 확인합니다'}
              {onGo && <> · <button type="button" className="ad-inl" data-act="med-open-ads" onClick={() => onGo('ads')}>광고 소재 보기</button></>}</span>
          </div>
          <div className="mm"><span className="ad-bg wait">승인 대기</span></div>
          <div className="mact">
            <button className="btn-sm" data-act="med-reject" disabled={a.busy === m.creativeCode} onClick={() => rejectReview(m.creativeCode)}>반려</button>
            <button className="btn-ok btn-sm" disabled={a.busy === m.creativeCode} onClick={() => confirmReview(m.creativeCode)}>심의필 확인</button>
          </div>
        </div>
      ))}
      <div className="ad-nt warn">
        <b>번호만 받지 말고 실제 조회하십시오.</b> 의료법 제27조 · 제56조는 과태료 대상이고, 환자 유인 · 알선으로
        보이면 더 무겁습니다. 의료 광고는 심의필 없이 나가면 안 됩니다.
      </div>
    </>
  );
}
