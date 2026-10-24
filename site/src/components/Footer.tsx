import Link from 'next/link';
import type { FooterLink } from '@/lib/types';
import { footerHref } from '@/components/common/links';
import { useTranslations } from 'next-intl';

/**
 * 푸터 — v10.29 시안 꼬리줄(proto_lite.html footer() — .ft · .lk · .info 두 줄 · .nt2 중개 고지) 모양.
 *
 * 값은 지금처럼 서버에서: 링크 GET /footer-links · 사업자 정보 GET /site-settings/public.
 *   · 시안처럼 앞의 두 링크(이용약관 · 개인정보처리방침)는 밑줄 굵게(.em).
 *   · v10.31 — 순서는 서버(sort_order) 그대로: 시안 다섯(이용약관 · 개인정보처리방침 · 운영정책 · 분쟁조정 안내 · 고객센터) 뒤에
 *     개발에만 있는 「제3자 제공 동의 · 환불 정책 · 위치기반」(조금 옅게). 운영정책은 D049 에서 더함 → 이용안내(/guide). 주소 규칙은 common/links.ts.
 *   · 값이 비어 있는 항목은 숨기지 않고 점선(TBD)으로 — 없다는 사실이 보여야 합니다.
 *   · 시안의 「직업정보제공사업 신고번호」는 설정 키가 없어 넣지 않았습니다(지어내지 않음 · diffs).
 * 목적지 없는 링크를 숨기지 않습니다 — 약관이 발행 전이면 available=false 로 옵니다.
 */
const DEV_ONLY = new Set(['THIRDPARTY', 'REFUND', 'LOCATION']);

export function Footer({ links, settings }: {
  links: FooterLink[];
  settings: Record<string, string | null>;
}) {
  const t = useTranslations('footer');
  const v = (k: string, tip: string) =>
    settings[k] ? <>{settings[k]}</> : <span className="tbd" title={tip}>TBD</span>;
  const notice = settings['legal.intermediary_notice'];

  return (
    <footer className="pc-ft">
      <div className="pc-wrap">
        <div className="lk">
          {links.map((l, i) => {
            const cls = [i < 2 ? 'em' : '', l.targetType === 'TERM' && DEV_ONLY.has(l.targetRef ?? '') ? 'dev' : ''].filter(Boolean).join(' ') || undefined;
            return l.available ? (
              <Link key={l.label} className={cls} title={l.tip ?? undefined}
                href={footerHref(l)}>
                {l.label}
              </Link>
            ) : (
              <span key={l.label} className="tbdl" title={l.tip ?? t('preparing')}>{l.label}</span>
            );
          })}
        </div>

        <div className="info">
          {settings['footer.company_name'] ? <b>{settings['footer.company_name']}</b> : <span className="tbd" title={t('tipCompany')}>TBD</span>}
          {' · '}{t('ceo')} {v('footer.ceo_name', t('tipCeo'))}
          {' · '}{t('bizRegNo')} {v('footer.biz_reg_no', t('tipNeeded'))}
          {' · '}{t('mailOrderNo')} {v('footer.mail_order_no', t('tipMailOrder'))}
          {/* v10.31 (합침 · w6 D080) — 시안 바닥줄 「직업정보제공사업 신고번호」 · 설정 footer.job_info_no(지금 「해당 없음」) */}
          {settings['footer.job_info_no'] && <>{' · '}{t('jobInfoNo')} {settings['footer.job_info_no']}</>}
          <br />
          {t('address')} {v('footer.address', t('tipNeeded'))}
          {' · '}{t('phone')} {v('footer.phone', t('tipNeeded'))}
          {' · '}{t('privacyOfficer')} {v('footer.privacy_officer', t('tipNeeded'))}
          {' · '}{t('hosting')} {v('footer.hosting', t('tipNeeded'))}
        </div>

        {notice && (
          <div className="nt2">
            {/* 시안: 첫 문장을 굵게 — 서버 문구의 첫 문장(마침표까지)을 굵게 씁니다 */}
            {(() => {
              const m = notice.match(/^(.+?[.。])\s*(.*)$/);
              return m ? <><b>{m[1]}</b>{m[2] ? ' ' + m[2] : ''}</> : <b>{notice}</b>;
            })()}
          </div>
        )}
      </div>
    </footer>
  );
}
