import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ReportForm } from '@/components/ReportForm';
import { MyFrame } from '@/components/my/MyFrame';
import { Msgs } from '@/i18n/Msgs';   // v10.99 — 나의공간 왼쪽 메뉴(MyShell)가 쓰는 사전 묶음(docs/157)
import { getTranslations } from 'next-intl/server';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('report') };
}

interface Reason { code: string; label: string; severity: string; gwanCode?: string }
type Props = { params: Promise<{ targetType: string; targetId: string }> };

const TYPE: Record<string, string> = {
  listing: 'LISTING', request: 'REQUEST', service: 'SERVICE', profile: 'PROFILE',
  post: 'POST',      // v10.27 (G-191) — 소개광장 글
  comment: 'COMMENT', // v10.80 (D110) — 소개광장 댓글
};
/* v10.101 — 대상 이름은 사전 키(deal.report.type.*) */
const LABEL = ['LISTING', 'REQUEST', 'SERVICE', 'PROFILE', 'POST', 'COMMENT'] as const;
const isLabel = (c: string): c is (typeof LABEL)[number] => (LABEL as readonly string[]).includes(c);

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

  const tr = await getTranslations('deal.report');
  /* v10.101 — 심각도 이름은 사전 키(deal.report.sev.*) · 모르는 값은 서버 값 그대로 */
  const sev = (s: string) => (tr.has(`sev.${s}` as never) ? tr(`sev.${s}` as never) : s);
  /* v10.31 — 시안 RPT-010: 왼쪽 나의공간 메뉴(MyFrame) + 사유 · 심각도 표 + 본인인증 안내 */
  return (
    <Msgs ns={['my', 'myDeal', 'order', 'deal']}><MyFrame><div className="page narrow" data-screen="SB-HOM-RPT-010" style={{ margin: 0, maxWidth: 'none' }}>
      <h1>{tr('title')}</h1>
      <p className="lead">
        {tr.rich('lead', { label: isLabel(t) ? tr(`type.${t}`) : tr('typeDefault'), strong: (x) => <strong>{x}</strong> })}
      </p>

      {!p.identityVerifiedAt ? (
        <div className="note warn rpt-idv">
          {tr.rich('idv', { b: (x) => <b>{x}</b> })}
          <div style={{ marginTop: 10 }}>
            <a className="btn-primary" href="/verify">{tr('verify')}</a>
          </div>
        </div>
      ) : reasons.length === 0 ? (
        <div className="empty">{tr('noReasons')}</div>
      ) : (
        <ReportForm targetType={t} targetId={targetId} reasons={reasons} />
      )}

      {reasons.length > 0 && (
        <table className="tbl" style={{ marginTop: 14 }} data-report-reasons="">
          <thead><tr><th>{tr('thReason')}</th><th>{tr('thSev')}</th></tr></thead>
          <tbody>{reasons.map((r) => <tr key={r.code}><td>{r.label}</td><td>{sev(r.severity)}</td></tr>)}</tbody>
        </table>
      )}

      {/* v10.32 — 시안처럼 사유 표 아래 「본인인증이 필요합니다」 노란 띠(인증한 분에게도 규칙으로 보임 — 인증 전이면 위에 단추와 함께 이미 나옴) */}
      {p.identityVerifiedAt && (
        <div className="note warn rpt-idv" data-report-idv="">{/* v10.32 (추가) — 시안 띠 색(연한 살구 #FFF7ED) · 굵은 첫 줄 따로(rpt-idv) */}
          {tr.rich('idvDone', { b: (x) => <b>{x}</b> })}
        </div>
      )}

      {t === 'POST' || t === 'COMMENT' ? (
        <div className="note info">
          {withCodes(tr.rich('hide3', { what: t === 'COMMENT' ? tr('whatComment') : tr('whatPost'), b: (x) => <b>{x}</b> }))}
        </div>
      ) : (
        <div className="note info">
          {tr.rich('notAlone', { b: (x) => <b>{x}</b> })}
        </div>
      )}

      <div className="note info">
        <b>{tr('self')}</b>
        {t === 'COMMENT' ? null /* v10.80 — 댓글은 쓴 사람이 지우는 단추가 없음 */
          : t === 'POST'
          ? tr('selfPost')
          : <>{tr.rich('selfOther', { link: (x) => <a href="/my/listings">{x}</a> })}</>}
      </div>
    </div></MyFrame></Msgs>
  );
}
