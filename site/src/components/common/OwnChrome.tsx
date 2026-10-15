/**
 * v10.29 — 일반 머리줄 · 꼬리줄을 숨기는 표시(파트너센터처럼 전용 상단바를 쓰는 화면용).
 *
 * 화면(또는 그 폴더의 layout.tsx) 안에 <OwnChrome /> 한 줄을 넣으면 그 화면에서만 일반 머리줄(.pc-hd)이 숨습니다.
 * footer 를 주면 꼬리줄(.pc-ft)도 숨깁니다. 서버에서 그린 그대로 CSS(:has)로 숨기므로 깜빡이지 않습니다
 * (styles/proto-common.css 의 body:has([data-own-chrome]) 규칙).
 * Chrome.tsx 를 고치지 않고 다른 묶음이 쓰도록 만든 부품입니다.
 */
export function OwnChrome({ footer = false }: { footer?: boolean }) {
  return <span data-own-chrome={footer ? 'all' : 'header'} hidden aria-hidden="true" />;
}
