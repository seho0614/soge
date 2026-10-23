import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ReportForm } from '@/components/ReportForm';
import { MyFrame } from '@/components/my/MyFrame';

export const metadata: Metadata = { title: '신고하기' };

interface Reason { code: string; label: string; severity: string; gwanCode?: string }
type Props = { params: Promise<{ targetType: string; targetId: string }> };

const TYPE: Record<string, string> = {
  listing: 'LISTING', request: 'REQUEST', service: 'SERVICE', profile: 'PROFILE',
  post: 'POST',      // v10.27 (G-191) — 소개광장 글
  comment: 'COMMENT', // v10.80 (D110) — 소개광장 댓글
};
const LABEL: Record<string, string> = {
  LISTING: '등록글', REQUEST: '요청글', SERVICE: '서비스', PROFILE: '프로필', POST: '소개광장 글', COMMENT: '소개광장 댓글',
};

/**
 * SB-HOM-RPT-010 신고하기
 *
 * ── 자동 노출의 대가입니다 ──────────────────────────────────────────
 * 전수 심사를 포기한 대신 **사후에 잡습니다.** 이 화면이 없으면
 * 잘못된 등록을 알려 줄 길이 없고, 그러면 자동 노출은 그냥
 * 방치가 됩니다.
 *
 * ── 본인인증이 필요합니다 ───────────────────────────────────────────
 * 익명 신고를 받으면 경쟁사가 계정을 만들어 가며 반복 신고할 수
 * 있습니다.
 */
export default async function ReportPage({ params }: Props) {
  const { targetType, targetId } = await params;
  const t = TYPE[targetType.toLowerCase()];
  if (!t) notFound();

  const p = await me();
  if (!p) redirect(`/login?next=/report/${targetType}/${targetId}`);

  const reasons = await apiGet<Reason[]>('/report-reasons', 300).catch(() => []);

  const SEV: Record<string, string> = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' };
  /* v10.31 — 시안 RPT-010: 왼쪽 나의공간 메뉴(MyFrame) + 사유 · 심각도 표 + 본인인증 안내 */
  return (
    <MyFrame><div className="page narrow" data-screen="SB-HOM-RPT-010" style={{ margin: 0, maxWidth: 'none' }}>
      <h1>신고하기</h1>
      <p className="lead">
        이 {LABEL[t] ?? '글'}의 어떤 점이 문제인지 알려 주십시오.
        <strong> 확인 후 처리 결과를 알려 드립니다.</strong>
      </p>

      {!p.identityVerifiedAt ? (
        <div className="note warn rpt-idv">
          <b>본인인증이 필요합니다.</b>
          익명 신고를 받으면 경쟁사가 계정을 만들어 가며 반복 신고할 수
          있어, 인증하신 분만 받습니다.
          <div style={{ marginTop: 10 }}>
            <a className="btn-primary" href="/verify">인증하러 가기</a>
          </div>
        </div>
      ) : reasons.length === 0 ? (
        <div className="empty">신고 사유를 불러오지 못했습니다. 잠시 후 다시 시도해 주십시오.</div>
      ) : (
        <ReportForm targetType={t} targetId={targetId} reasons={reasons} />
      )}

      {reasons.length > 0 && (
        <table className="tbl" style={{ marginTop: 14 }} data-report-reasons="">
          <thead><tr><th>사유</th><th>심각도</th></tr></thead>
          <tbody>{reasons.map((r) => <tr key={r.code}><td>{r.label}</td><td>{SEV[r.severity] ?? r.severity}</td></tr>)}</tbody>
        </table>
      )}

      {/* v10.32 — 시안처럼 사유 표 아래 「본인인증이 필요합니다」 노란 띠(인증한 분에게도 규칙으로 보임 — 인증 전이면 위에 단추와 함께 이미 나옴) */}
      {p.identityVerifiedAt && (
        <div className="note warn rpt-idv" data-report-idv="">{/* v10.32 (추가) — 시안 띠 색(연한 살구 #FFF7ED) · 굵은 첫 줄 따로(rpt-idv) */}
          <b>본인인증이 필요합니다.</b> 익명 신고를 받으면 경쟁사가 계정을 만들어 가며 반복 신고할 수 있어, 인증하신 분만 받습니다 — 지금 계정은 인증되어 있습니다.
        </div>
      )}

      {t === 'POST' || t === 'COMMENT' ? (
        <div className="note info">
          <b>서로 다른 회원 3명이 신고하면 {t === 'COMMENT' ? '댓글이' : '글이'} 가려집니다.</b>
          지우지는 않고, 운영이 확인해 다시 보이게 하거나 정리합니다(v10.27 · G-191).
        </div>
      ) : (
        <div className="note info">
          <b>신고만으로 글이 내려가지는 않습니다.</b>
          같은 신고가 쌓이면 운영이 확인합니다 —
          여럿이 짜고 남의 글을 내리는 일을 막기 위해서입니다.
        </div>
      )}

      <div className="note info">
        <b>자기 글은 신고할 수 없습니다.</b>
        {t === 'COMMENT' ? null /* v10.80 — 댓글은 쓴 사람이 지우는 단추가 없음 */
          : t === 'POST'
          ? ' 내리고 싶으시면 글 상세의 「삭제」를 쓰십시오.'
          : <> 내리고 싶으시면 <a href="/my/listings">내 등록</a>에서 「내리기」로 비공개로 바꾸십시오.</>}
      </div>
    </div></MyFrame>
  );
}
