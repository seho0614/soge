/**
 * v10.29 — 시안 공통 부품 N-06 「← ○○(으)로 돌아가기」 (proto_lite.html 의 backLink() · .bkl).
 *
 * 시안은 글자를 「(으)로」 그대로 씁니다 — 같게 둡니다.
 * 시안은 이력이 있으면 직전 화면으로 갑니다. 실제 웹은 주소가 곧 화면이라 **정해 둔 곳(href)** 으로 보냅니다
 * (시안 v10.24 의 「back 을 주면 정해 둔 곳」 방식과 같음 — 주소로 바로 연 사람도 같은 곳으로 갑니다).
 *
 * 쓰는 법:
 *   import { BackBar } from '@/components/common/BackBar';
 *   <BackBar href="/money" label="소개장터" />
 *   <BackBar href="/my" label="나의공간" right={<Link href="/my/listings">전체 보기</Link>} />
 */
import Link from 'next/link';

export function BackBar({ href, label, right, wrap = true, linkData }: {
  /** 돌아갈 주소 */
  href: string;
  /** 돌아갈 화면 이름 — 「← {label}(으)로 돌아가기」 */
  label: string;
  /** 같은 줄 오른쪽에 둘 것(선택) */
  right?: React.ReactNode;
  /** 시안 .wrap 처럼 위 여백(16px)을 둘지 — 이미 여백이 있는 곳이면 false */
  wrap?: boolean;
  /** v10.32 — 링크에 붙일 data- 속성(시험 손잡이 · 예: { 'data-verify-back': '' }) */
  linkData?: Record<`data-${string}`, string>;
}) {
  return (
    <div className={`pc-bkbar${wrap ? ' pad' : ''}`}>
      <Link href={href} className="pc-bkl" {...linkData}>← {label}(으)로 돌아가기</Link>
      {right && <span className="pc-bkr">{right}</span>}
    </div>
  );
}
