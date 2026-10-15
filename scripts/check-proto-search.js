/* 검색창에 글자를 치면 팝업이 열리고 초점이 팝업으로 가는지 봅니다.
 *
 * ★ 왜 필요한가 — 실제로 겪은 세 가지
 *
 *   ① 클릭만 듣고 있었습니다
 *      click 은 mousedown 뒤에 옵니다. 그 사이 브라우저가 이미
 *      원래 입력창으로 초점을 옮겨서, 팝업이 떠도 글자는 **뒤쪽
 *      검색창**에 들어갔습니다. 팝업에는 아무것도 안 쳐지니
 *      "입력창이 없다"고 보입니다. Tab 이동도 안 열렸습니다.
 *
 *   ② CFG is not defined
 *      SPOP 은 M_render2 인데 CFG 는 M_render 안에 있습니다.
 *      팝업이 뜨는 순간 draw() 가 죽어 목록도 초점도 없었습니다.
 *
 *   ③ filter is not a function
 *      D.listings 를 배열로 보고 .filter 를 불렀는데 실제로는
 *      객체(popular/cases/…)였습니다.
 *
 *   주소 122개 검사로는 셋 다 못 잡습니다 — 주소만 넣어 볼 뿐
 *   화면 안에서 타이핑해 보지 않기 때문입니다.
 *
 *   사용법: node scripts/check-proto-search.js spec/proto.html
 */
const fs = require('fs'), vm = require('vm');
const h = fs.readFileSync(process.argv[2], 'utf8');
const js = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

const handlers = {};
const nodes = {};

function mkEl(id, cls) {
  const el = {
    id: id || '', className: cls || '', value: '', innerHTML: '', textContent: '',
    dataset: {}, style: {}, _focused: false, _blurred: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(ev, fn) { (handlers['el:' + (id || cls) + ':' + ev] ||= []).push(fn); },
    focus() { this._focused = true; this._focusCalls = (this._focusCalls||0)+1; },
    blur() { this._focused = false; this._blurred++; },
    closest(sel) {
      /* 실제 DOM 의 closest 는 쉼표로 나뉜 여러 선택자를 받습니다.
         가짜 DOM 도 그렇게 흉내 냅니다. */
      const parts = String(sel).split(',').map(x => x.trim());
      for (const p of parts) {
        const last = p.split(/\s+/).pop();          // ".sb .si" → ".si"
        if (last.startsWith('.') && (this.className || '').split(/\s+/).includes(last.slice(1))) return this;
        if (last.startsWith('#') && this.id === last.slice(1)) return this;
      }
      return null;
    },
    querySelector: () => mkEl(), querySelectorAll: () => [],
    appendChild() {}, setAttribute() {}, getAttribute: () => null,
    scrollIntoView() {}, children: [],
  };
  if (id) nodes[id] = el;
  return el;
}

const screen = mkEl('screen'), hltapp = mkEl('hltapp');
const searchInput = mkEl(null, 'si');     // 뒤쪽 검색창

const doc = {
  getElementById: (i) => nodes[i] || (i === 'screen' ? screen : (i === 'hltapp' ? hltapp : mkEl(i))),
  addEventListener(ev, fn) { (handlers[ev] ||= []).push(fn); },
  _log: [],
  createElement: () => {
    const el = mkEl();
    /* innerHTML 로 자식이 생기는 것을 흉내 냅니다 — 가짜 DOM 은
       문자열을 파싱하지 않으므로 #spopq 를 직접 만들어 둡니다. */
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html || ''; },
      set(v) { el._html = v; if (v.includes('id="spopq"')) mkEl('spopq'); },
    });
    return el;
  },
  querySelector: () => mkEl(), querySelectorAll: () => [],
  body: Object.assign(mkEl(), { dataset: {}, appendChild(el) { if (el.id) nodes[el.id] = el; } }),
  documentElement: Object.assign(mkEl(), { dataset: {} }),
  readyState: 'complete', title: '',
};

const ctx = vm.createContext({
  console, document: doc, setTimeout: (fn) => fn(), clearTimeout,
  setInterval: () => 0, clearInterval() {},
  navigator: { userAgent: 'Chrome' }, fetch: () => Promise.reject(new Error('x')),
});
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
ctx.location = { hostname: 'localhost', hash: '#/', pathname: '/', search: '', protocol: 'file:' };
ctx.history = { replaceState() {}, pushState() {} };
ctx.matchMedia = () => ({ matches: false, addEventListener() {} });
ctx.addEventListener = () => {}; ctx.scrollTo = () => {}; ctx.innerWidth = 1440;
ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
ctx.alert = () => {}; ctx.confirm = () => true;

vm.runInContext(js, ctx);

function fire(type, target, extra = {}) {
  const ev = { type, target, preventDefault() { ev._p = true; }, ...extra };
  (handlers[type] || []).forEach(fn => { try { fn(ev); } catch (e) { if(!/querySelector/.test(e.message)) console.log('    [예외] ' + e.message.slice(0,70)); } });
  return ev;
}

console.log('  청취 중인 이벤트: ' + Object.keys(handlers).filter(k => !k.startsWith('el:')).join(', '));
console.log();

/* ① 검색창에 바로 타이핑 (클릭 없이) */
searchInput.value = '강남';
fire('input', searchInput);

const pop = nodes['spop'];
const popInput = nodes['spopq'];
const opened = pop && pop.classList.contains('on');

console.log('  ① 검색창에 타이핑');
console.log('     팝업 열림      : ' + (opened ? '예' : '★ 아니오'));
console.log('     팝업 입력창    : ' + (popInput ? '있음' : '★ 없음'));
if (popInput) {
  console.log('     팝업에 글자    : ' + JSON.stringify(popInput.value));
  console.log('     팝업에 초점    : ' + (popInput._focused ? '예' : '★ 아니오'));
  console.log('     (같은 요소인가 : ' + (nodes['spopq'] === popInput) + ' · focus 호출수 ' + (popInput._focusCalls||0) + ')');
}
console.log('     뒤쪽 창 비움   : ' + (searchInput.value === '' ? '예' : '★ 아니오 (' + searchInput.value + ')'));

const good = opened && popInput && popInput.value === '강남' && popInput._focused && searchInput.value === '';
console.log();
console.log(good ? '  ok  검색 입력이 팝업으로 갑니다' : '  ★   검색 입력이 팝업으로 가지 않습니다');
process.exit(good ? 0 : 1);
