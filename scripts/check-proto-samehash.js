/* 같은 주소를 다시 눌렀을 때 화면이 다시 그려지는지 봅니다.
 *
 * ★ 왜 필요한가
 *   해시 라우팅은 location.hash 가 **바뀔 때만** hashchange 를 냅니다.
 *   이미 #/ 에 있는데 헤더 로고(href="#/")를 누르면 값이 그대로라
 *   아무 일도 일어나지 않습니다. 사용자는 "링크가 죽었다"고 봅니다.
 *
 *   주소 122개를 전부 눌러 보는 검사로는 못 잡습니다 — 그 검사는
 *   서로 다른 주소만 확인하기 때문입니다.
 *
 *   사용법: node scripts/check-proto-samehash.js spec/proto.html
 */
const fs = require('fs'), vm = require('vm');
const h = fs.readFileSync(process.argv[2], 'utf8');
const js = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

let paintCount = 0;
const handlers = {};

const mk = () => ({
  innerHTML: '', textContent: '', addEventListener() {}, closest: () => null,
  getAttribute: () => null, setAttribute() {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {}, querySelector: () => mk(), querySelectorAll: () => [],
  focus() {}, scrollIntoView() {}, appendChild() {}, children: [],
});
const screen = mk(), hltapp = mk();

/* screen.innerHTML 에 쓰일 때마다 셉니다 = 다시 그린 횟수 */
let _html = '';
Object.defineProperty(screen, 'innerHTML', {
  get() { return _html; },
  set(v) { _html = v; paintCount++; },
});

const doc = {
  getElementById: (i) => (i === 'screen' ? screen : (i === 'hltapp' ? hltapp : mk())),
  addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
  querySelector: () => mk(), querySelectorAll: () => [], createElement: () => mk(),
  body: Object.assign(mk(), { dataset: {} }),
  documentElement: Object.assign(mk(), { dataset: {} }),
  readyState: 'complete', title: '',
};

const ctx = vm.createContext({
  console, document: doc, setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval() {},
  navigator: { userAgent: 'Chrome' }, fetch: () => Promise.reject(new Error('x')),
});
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
ctx.location = { hostname: 'localhost', hash: '#/', pathname: '/', search: '', protocol: 'file:' };
ctx.history = { replaceState() {}, pushState() {} };
ctx.matchMedia = () => ({ matches: false, addEventListener() {} });
ctx.addEventListener = (ev, fn) => { (handlers['w:' + ev] = handlers['w:' + ev] || []).push(fn); };
ctx.scrollTo = () => {}; ctx.innerWidth = 1440;
ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
ctx.alert = () => {}; ctx.confirm = () => true;

vm.runInContext(js, ctx);

const before = paintCount;
console.log('  초기 렌더 ' + before + '회 · 현재 주소 ' + ctx.location.hash);

/* 메인(#/)에서 로고(#/)를 누릅니다 */
const logoAnchor = {
  target: '', dataset: {}, hasAttribute: () => false,
  getAttribute: (k) => (k === 'href' ? '#/' : null),
  href: 'file:///x#/',
};
const ev = {
  target: { closest: (sel) => (sel === 'a[href]' ? logoAnchor : null) },
  preventDefault() { ev._prevented = true; },
};
(handlers['click'] || []).forEach(fn => { try { fn(ev); } catch (e) {} });

const after = paintCount;
console.log('  로고 클릭 후 렌더 ' + after + '회  (증가 ' + (after - before) + ')');
console.log('  기본동작 막음: ' + (ev._prevented ? '예' : '아니오'));
if (after > before) { console.log('  ok  같은 주소 재클릭에도 다시 그려집니다'); }
else { console.log('  ★   같은 주소를 누르면 아무 일도 안 일어납니다'); process.exit(1); }
