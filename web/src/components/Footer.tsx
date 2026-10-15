/**
 * 푸터 3종 — 일반 · slim(백오피스) · mini(모바일).
 * 같은 컴포넌트의 변형입니다.
 */
import { siteHref } from '../lib/siteUrl';

export interface FooterLink {
  section: string;
  label: string;
  targetType: string;
  targetRef: string | null;
  available: boolean;
  tip: string | null;
}

export function Footer({ links, settings, variant = 'full', className }: {
  links: FooterLink[];
  settings: Record<string, string | null>;
  variant?: 'full' | 'slim' | 'mini';
  /** v10.29 — 운영 화면은 본문과 같은 폭(최대 1400 · 좌우 20)에 맞춥니다(.bo-foot) */
  className?: string;
}) {
  const pad = variant === 'full' ? 'var(--sp-6)' : 'var(--sp-3)';
  return (
    <footer className={className} style={{
      background: variant === 'slim' ? 'var(--paper)' : 'var(--surface)',
      borderTop: '1px solid var(--line)', padding: pad,
      fontSize: variant === 'mini' ? 'var(--fs-xs)' : 'var(--fs-sm)',
      color: 'var(--ink-2)',
    }}>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        {links.map((l) =>
          l.available
            ? <a key={l.label} href={hrefOf(l)} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{l.label}</a>
            /* 숨기지 않습니다 — 없다는 사실이 보여야 합니다 */
            : <span key={l.label} className="tbd" title={l.tip ?? '준비 중입니다'}>{l.label}</span>
        )}
      </nav>

      {variant !== 'mini' && (
        <address style={{ fontStyle: 'normal', lineHeight: 1.8, color: 'var(--ink-3)' }}>
          {settings['footer.biz_reg_no'] && <>사업자등록번호 {settings['footer.biz_reg_no']} · </>}
          {settings['footer.mail_order_no'] && <>통신판매업 신고 {settings['footer.mail_order_no']} · </>}
          {settings['footer.ceo_name'] && <>대표 {settings['footer.ceo_name']}<br /></>}
          {settings['footer.address']}
        </address>
      )}

      {/* 전자상거래법 제20조 통신판매중개자 고지 */}
      {settings['legal.intermediary_notice'] && (
        <p style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)',
          background: 'var(--paper)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)',
        }}>{settings['legal.intermediary_notice']}</p>
      )}
    </footer>
  );
}

/* v10.31 (10/10 결함) — 운영 화면에는 /terms/… · /support 경로가 없습니다. 사용자 웹 주소로 보냅니다(새 창). */
const hrefOf = (l: FooterLink) =>
  l.targetType === 'TERM' ? siteHref(`/terms/${l.targetRef}`)
  : l.targetType === 'SCREEN' ? siteHref('/support')
  : /^https?:/.test(l.targetRef ?? '') ? l.targetRef!
  : l.targetRef ? siteHref(l.targetRef) : '#';
