/**
 * v10.29 — 나의공간 화면 부품 (시안 page() · note() · empty() · badge() · tabs() · table() 을 그대로 옮김).
 * 서버 · 클라이언트 어디서나 쓸 수 있는 순수 부품입니다(조회 없음). 클래스는 styles/proto-my.css 의 my- 접두어.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

/** 화면 머리 — 시안 .pgh (제목 · 설명 · 오른쪽) */
export function MyHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="my-pgh">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right && <div className="my-pgh-r">{right}</div>}
    </div>
  );
}

/** 안내 상자 — 시안 note(kind) · .nt.info / .ok / .warn */
export function Note({ kind = 'info', children, className, ...rest }: { kind?: 'info' | 'ok' | 'warn' | 'plain'; children: ReactNode; className?: string } & Record<`data-${string}`, string | boolean | undefined> & { role?: string }) {
  return <div className={`my-nt ${kind === 'plain' ? '' : kind}${className ? ` ${className}` : ''}`} {...rest}>{children}</div>;
}

/** 빈 상태 — 시안 empty() */
export function Empty({ children, ...rest }: { children: ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
  return <div className="my-emp" {...rest}>{children}</div>;
}

/** 배지 — 시안 badge() 의 색 규칙(초록 ok · 노랑 wait · 빨강 no · 회색 off) */
export type Tone = 'ok' | 'wait' | 'no' | 'off';
export function Badge({ tone = 'off', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`my-bg ${tone}`}>{children}</span>;
}

/** 관 표시 — 시안 .gt.g-mny 등 */
export const GWAN_NAME: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개뱅크몰' };
export function GwanTag({ code }: { code?: string | null }) {
  if (!code) return null;
  return <span className={`my-gt g-${code.toLowerCase()}`}>{GWAN_NAME[code] ?? code}</span>;
}

/** 탭 — 시안 tabs() (.tabs2). 실제 웹은 주소(?tab=)로 바꿉니다 — 새로고침 · 공유해도 같은 탭 */
export function Tabs({ items, cur, label }: { items: { k: string; t: string; n?: number | null; href: string; extra?: ReactNode; data?: string }[]; cur: string; label: string }) {
  return (
    <nav className="my-tabs" aria-label={label}>
      {items.map((x) => (
        <Link key={x.k} href={x.href} className={`my-tb${x.k === cur ? ' on' : ''}`} aria-current={x.k === cur ? 'page' : undefined} data-my-tab={x.data ?? x.k}>
          {x.t}{x.n != null && <i>{x.n}</i>}{x.extra}
        </Link>
      ))}
    </nav>
  );
}

/** 표 — 시안 table() (.tw .tb2) */
export function Table({ head, children, narrow }: { head: ReactNode[]; children: ReactNode; narrow?: boolean }) {
  return (
    <div className="my-tw">
      <table className={`my-tb2${narrow ? ' narrow' : ''}`}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** 금액 「1,234원」 — 시안 won() */
export const wonP = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString('ko-KR')}원`);
/** 거래 · 정산 번호를 짧게(앞 8자리) — 서버 번호는 UUID 라 표에 다 넣으면 읽히지 않습니다 */
export const shortId = (id: string | null | undefined, pre = '') => (id ? `${pre}${id.slice(0, 8).toUpperCase()}` : '—');
