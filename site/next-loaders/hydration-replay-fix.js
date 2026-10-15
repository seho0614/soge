/**
 * v10.34 — 수화 오류(React #418 · args HTML) 고침: React 19.3.0 의 고침 한 군데를 Next 15 안의 React(19.2.0-canary-0bdb9206-20250818)에 옮겨 붙입니다.
 *
 * 무엇이 틀렸나(G-94 · v10.34 원인)
 *   서버 컴포넌트가 그린 HTML 요소(예: BackBar 의 <div class="pc-bkbar">) 안에 클라이언트 부품(예: next/link)이 들어 있고,
 *   그 부품의 JS 조각(화면 전용 청크)이 아직 내려받는 중이면 React 가 수화 도중 그 <div> 에서 잠깐 멈췄다가(suspend) 다시 그립니다(replay).
 *   19.2 canary 는 다시 그릴 때 「다음에 맞출 서버 DOM 자리」(nextHydratableInstance)를 되돌리지 않아, 이미 맞춘 <div> 대신
 *   그 안의 첫 자식(<a>)에 <div> 를 맞추려다 어긋남(#418)을 냅니다. 청크가 늦게 오는 때(부하 · 느린 회선)에만 나서 드뭅니다.
 *   19.3.0 은 replaySuspendedUnitOfWork 의 HostComponent(case 5) 에서 자리를 되돌립니다 — 아래가 그 줄을 그대로 옮긴 것입니다.
 *   (확인: react-dom@19.3.0 cjs/react-dom-client.{production,development}.js 의 replaySuspendedUnitOfWork · replayBeginWork)
 *
 * 범위: 브라우저용 react-dom 두 파일(운영 · 개발)만. 서버 렌더링은 건드리지 않습니다.
 *   이미 고쳐진 React(앞으로 Next 를 올린 때)면 손대지 않고, 고칠 자리를 못 찾으면 빌드를 멈춰 알립니다(조용히 빠지지 않게).
 */
const FIX = (v) =>
  `var fiber = ${v};\n` +
  `fiber === hydrationParentFiber && (isHydrating ? (popToNextHostParent(fiber), 5 === fiber.tag && null != fiber.stateNode && (nextHydratableInstance = fiber.stateNode)) : (popToNextHostParent(fiber), (isHydrating = !0)));\n`;

// 운영 파일: replaySuspendedUnitOfWork(unitOfWork) 안 — 변수 이름 next
// 개발 파일: replayBeginWork(unitOfWork) 안 — 변수 이름 unitOfWork
const SITES = [
  { re: /(case 5:\s*resetHooksOnUnwind\(next\);)(\s*default:\s*unwindInterruptedWork\(current, next\))/, v: 'next' },
  { re: /(case 5:\s*resetHooksOnUnwind\(unitOfWork\);)(\s*default:\s*unwindInterruptedWork\(current, unitOfWork\))/, v: 'unitOfWork' },
];

module.exports = function hydrationReplayFix(source) {
  const already = /resetHooksOnUnwind\((?:next|unitOfWork)\);\s*(?:\/\*[^*]*\*\/\s*)?var fiber = (?:next|unitOfWork);\s*fiber === hydrationParentFiber/.test(source);
  if (already) return source;
  for (const s of SITES) {
    if (s.re.test(source)) return source.replace(s.re, (_, a, b) => `${a}\n/* v10.34 react 19.3.0 backport */ ${FIX(s.v)}${b}`);
  }
  throw new Error(`[v10.34 hydration-replay-fix] ${this.resourcePath} 에서 고칠 자리(replay · case 5)를 찾지 못했습니다 — Next/React 판이 바뀌었으면 이 고침이 아직 필요한지 확인하십시오(next-loaders/hydration-replay-fix.js).`);
};
