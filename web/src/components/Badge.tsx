import { tone } from '../lib/codes';

/** 상태 배지. 색은 서버가 내려준 tone 을 토큰 이름으로 씁니다. */
export function Badge({ domain, code, text }: {
  domain: string; code: string | null | undefined; text: string;
}) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      fontSize: 'var(--fs-xs)',
      fontWeight: 600,
      borderRadius: 'var(--r-sm)',
      color: `var(--tone-${tone(domain, code)})`,
      border: `1px solid currentColor`,
    }}>{text}</span>
  );
}

/**
 * 광고 라벨. 우선노출은 반드시 이걸 답니다 (B-20 · 전자상거래법).
 * 라벨 문안은 서버가 내려줍니다 — 관리자가 바꿀 수 있습니다.
 */
export function AdLabel({ text }: { text: string }) {
  return (
    <span style={{
      padding: '2px 8px',
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      borderRadius: 'var(--r-sm)',
      color: 'var(--ad)',
      background: 'var(--ad-bg)',
    }}>{text}</span>
  );
}
