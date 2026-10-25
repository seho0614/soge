/**
 * v10.29 — 안심소개 파트너센터 시안 부품 (proto_lite.html 의 page() · note() · table() · badge() · tabs() · empty())
 *
 * 시안은 문자열로 HTML 을 만들어 붙였습니다. 여기서는 같은 모양을 React 로 그립니다.
 * 클래스는 styles/proto-partner.css 의 `pt-` 접두어입니다. 서버 컴포넌트 안에서 그대로 씁니다.
 */
import Link from 'next/link';

/** 쪽 머리 — 시안 page(title, sub, right) */
export function Pgh({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="pt-pgh">
      <div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
      {right ?? null}
    </div>
  );
}

/** 안내 상자 — 시안 note(kind, body) */
export function Note({ kind = 'info', children, ...rest }: { kind?: 'info' | 'ok' | 'warn' | 'plain'; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`pt-nt ${kind}`} {...rest}>{children}</div>;
}

/** 빈 상태 — 시안 empty(msg) */
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="pt-emp">{children}</div>;
}

/** 소제목 — 시안 .s2 */
export function S2({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 className="pt-s2" id={id}>{children}</h2>;
}

export type Tone = 'ok' | 'wait' | 'no' | 'off';
/** 상태 배지 — 시안 badge(t) 의 색 나눔(ok · wait · no · off) */
export function Bg({ tone = 'off', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pt-bg ${tone}`}>{children}</span>;
}

/** 표 — 시안 table(head, rows) */
export function Tw({ head, children, id, numCols = [] }: { head: string[]; children: React.ReactNode; id?: string; numCols?: number[] }) {
  return (
    <div className="pt-tw">
      <table className="pt-tb2" id={id}>
        <thead><tr>{head.map((h, i) => <th key={i} className={numCols.includes(i) ? 'num' : undefined}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** 숫자 칸 — 시안 .tile (누르면 그 화면으로) */
export function Tile({ label, value, unit, sub, href }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; href?: string }) {
  const inner = (
    <>
      <span className="tl">{label}</span>
      <b>{value}</b>
      {unit ? <span className="tu">{unit}</span> : null}
      {sub ? <span className="ts">{sub}</span> : null}
    </>
  );
  return href ? <Link className="pt-tile" href={href}>{inner}</Link> : <div className="pt-tile">{inner}</div>;
}

/** 탭 — 시안 tabs(key, list, cur). 실제 웹은 주소(?tab=)로 고릅니다 — 새로고침 · 공유해도 같은 탭 */
export function Tabs({ items, cur }: { items: Array<{ key: string; label: string; count?: number; href: string }>; cur: string }) {
  return (
    <div className="pt-tabs2" role="tablist">
      {items.map((t) => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={t.key === cur} className={t.key === cur ? 'on' : undefined}
              scroll={false} data-tab={t.key}>
          {t.label}{t.count != null ? <i>{t.count}</i> : null}
        </Link>
      ))}
    </div>
  );
}

/* ── 표기 ── */
export const won = (v: number | string | null | undefined) => Number(v || 0).toLocaleString('ko-KR');

export const GRADE_KO: Record<string, string> = { BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘' };

/** 파트너 상태 → 시안 배지 글자 · 색 */
export const PARTNER_ST: Record<string, [string, Tone]> = {
  ACTIVE: ['운영중', 'ok'], APPLIED: ['승인 대기', 'wait'], SUSPENDED: ['정지', 'no'],
  REJECTED: ['반려', 'no'], WITHDRAWN: ['철회', 'off'],
};

/** 서비스 검수 상태 → 시안 배지 */
export const SVC_ST: Record<string, [string, Tone]> = {
  DRAFT: ['작성중', 'wait'], IN_REVIEW: ['검수대기', 'wait'], APPROVED: ['노출중', 'ok'],
  REJECTED: ['반려', 'no'], SUSPENDED: ['정지', 'no'],
};

/**
 * v10.100 (다국어 2-5a) — 코드 → 사전 글자(partner.<묶음>.<코드> · 예: grade.GOLD · partnerSt.ACTIVE).
 *   위의 한국어 표(GRADE_KO · PARTNER_ST)는 사전과 같은 글자이고, 사전에 없는 코드일 때만 씁니다(fallback).
 *   t 는 getTranslations('partner') / useTranslations('partner').
 */
type CodeT = { (key: never): string; has: (key: never) => boolean };
export const ptCode = (t: CodeT, group: string, code: string | null | undefined, fallback: string) => {
  if (!code) return fallback;
  const k = `${group}.${code}` as never;
  return t.has(k) ? t(k) : fallback;
};

/** 사업자등록번호 123-45-67890 모양으로 */
export const bizNo = (v?: string | null) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (v ?? '—');
};
