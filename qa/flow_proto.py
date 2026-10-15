"""flow 점검 — 시안(프로토타입 HTML 한 파일)에서 주요 흐름이 끊기지 않고 끝까지 시연되는지.  결과: flow_proto.json

  S1  메인 → 관 → 목록 → 매물 상세 → 문의
  S2  로그인 · 가입 → 나의공간
  S3  매물 등록 → 검수 안내
  S4  안심소개 상담 — 축 → 업종 상세 → 신청서 → 접수
  S5  소개몰 — 메인 → 상품 → 장바구니 → 주문서 → 결제 → 완료 → 내 주문 → 배송 조회 → 반품 신청
  S6  소개광장 — 목록 → 글 상세 → 글쓰기 → 등록 → 투표
  S7  구독 — 요금제 → 결제 → 내 구독 → 해지
  S8  파트너센터 — 입점 신청 → 리드 → 이용료
  S9  운영 화면 — 검수 큐 → 승인 · 반려 → 정산 · 지급
  S10 머리줄 · 바닥줄로 관 사이 이동

방식
  · 시안 파일(…/SGB_Prototype_v10_25.html — 판 번호는 sgb/VERSION 에서 읽어 조립)을 file:// 로 열고, 사람이 시연하듯 화면의 단추 · 링크를 실제로 눌러 다음 화면으로 갑니다.
    화면 열쇠로 직접 옮기지 않습니다(흐름마다 파일을 새로 열어 메인에서 출발).
  · 단계마다 「무엇을 눌렀더니 어느 화면(열쇠 · 제목)이 됐고 무엇이 보이는지」를 확인합니다. 눌러도 화면 · 내용 · 안내 글이 바뀌지 않으면 실패입니다.
  · 흐름마다 마지막 단계로 쪽 오류(pageerror · console error) 0 을 봅니다. 외부 주소 요청(글꼴 · 우편번호 서비스)은 시험에서 막고, 그 때문에 생긴 「불러오지 못함」 기록은 세지 않습니다.
  · 시안에 그 화면이 없으면 단계를 지우지 않고 건너뜀(「시안에 이 화면이 없음」)으로 남깁니다. 앞 단계가 실패해 더 갈 수 없을 때도 건너뜀으로 남깁니다.
  · 시안은 서버가 아니므로 DB 단계는 없습니다. 모든 단계의 how 는 「시안」.

사용:  python3 flow_proto.py        PROTO=/path/시안.html (기본: 킷의 SGB_Prototype_<판>.html) · ONLY=S1,S5 (일부만)
"""
import os, re, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from flow_lib import *

VER = open(os.path.join(KIT, 'VERSION'), encoding='utf-8').read().strip()                      # 예 v10.25
FILE = os.environ.get('PROTO') or os.path.join(os.path.dirname(KIT), 'SGB_Prototype_' + VER.replace('.', '_') + '.html')
ONLY = [x.strip().upper() for x in os.environ.get('ONLY', '').split(',') if x.strip()]
HOW = '시안'
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
DEMO_ONLY = re.compile(r'시연: «|선택 — 시안은 표시만 바꿉니다')
def josa(w, a, b):
    """받침이 있으면 a(을 · 이), 없으면 b(를 · 가)"""
    c = ord(w[-1]); return a if (0xAC00 <= c <= 0xD7A3 and (c - 0xAC00) % 28) else b
won = lambda s: int(re.sub(r'[^\d]', '', s or '') or 0)
MENU6 = ['소개장터', '안심소개', '소개창업', '소개몰', '소개광장', '이용안내']

# ── 화면에서 읽는 것 ──
ST = r"""() => { const host = document.getElementById('hlthost'); const open = !!(host && host.classList.contains('on'));
  const root = open ? document.getElementById('hltapp') : document.getElementById('screen');
  const main = open ? root.querySelector('main') : null;
  const key = open ? (main ? main.getAttribute('data-screen') : null) : __VIEW.state.screen;
  const h = (open ? (main || root) : root).querySelector('h1, h2');
  const x = root.innerHTML; let v = 0; for (let i = 0; i < x.length; i += 7) v = (v * 31 + x.charCodeAt(i)) | 0;
  const vals = [...root.querySelectorAll('input,select,textarea')].map(e => (e.type === 'checkbox' || e.type === 'radio') ? (e.checked ? 1 : 0) : e.value).join('\u0001');
  let w = 0; for (let i = 0; i < vals.length; i++) w = (w * 31 + vals.charCodeAt(i)) | 0;
  const hd = root.querySelector('header'); const cur = hd ? hd.querySelector('nav a[aria-current=page], nav a.on') : null;
  const meta = (!open && typeof __VIEW.meta === 'function' && __VIEW.meta()[key]) || {};
  return { open, key, hash: location.hash, route: (open && window.__hltMall) ? window.__hltMall.route() : null,
    title: h ? h.innerText.replace(/\s+/g, ' ').trim().slice(0, 60) : '', sid: open ? key : (meta.id || ''), cur: cur ? cur.textContent.trim() : '', hcls: hd ? hd.className : '',
    nf: /페이지를 찾을 수 없습니다|없는 주소입니다/.test(root.innerText || ''),
    sig: x.length + ':' + v + ':' + vals.length + ':' + w + ':' + document.querySelectorAll('.adrmask').length + ':' + ((document.getElementById('hltmodal') || {}).innerHTML || '').length,
    docTitle: document.title } }"""
# 안내 글(토스트)은 2~3초 뒤 사라지므로, 뜨는 대로 적어 두는 기록 장치를 쪽에 답니다(시안 파일은 건드리지 않음)
TOASTHOOK = r"""() => { window.__flowT = window.__flowT || []; const push = t => { t = (t || '').replace(/\s+/g, ' ').trim(); if (t) window.__flowT.push(t); };
  const a = document.getElementById('toast'); if (a && !a.__flow) { a.__flow = 1; new MutationObserver(() => { if (a.classList.contains('on')) push(a.textContent); }).observe(a, { attributes: true, childList: true, characterData: true, subtree: true }); }
  const h = document.getElementById('hlttoast'); if (h && !h.__flow) { h.__flow = 1; new MutationObserver(() => push(h.textContent)).observe(h, { childList: true, characterData: true, subtree: true }); }
  return window.__flowT.length }"""
TXT = r"""() => { const host = document.getElementById('hlthost'); const open = !!(host && host.classList.contains('on'));
  const root = open ? (document.querySelector('#hltapp main') || document.getElementById('hltapp')) : document.getElementById('screen'); return (root.innerText || '').replace(/\s+/g, ' ').trim() }"""


def where(s):
    """「화면 열쇠 · 제목 · 주소」 한 줄"""
    t = f"「{s['title'][:22]}」" if s.get('title') else ''
    if s.get('open'): return f"소개몰 {s['key']}{t} {s['route']}"
    return f"{s['key']}{t} {s['hash'] or '(주소 없음)'}"


class Demo:
    """시안 한 벌(새 창) — 흐름마다 하나씩 엽니다(로그인 · 장바구니 · 투표가 다른 흐름에 남지 않게)"""
    def __init__(self, browser):
        self.ctx = browser.new_context(viewport={'width': 1500, 'height': 1000}); self.pg = self.ctx.new_page()
        self.errs = []; self.blocked = set(); self.dialogs = []; self.ads = []
        def route(r):
            u = r.request.url
            if u.startswith('http'): self.blocked.add(urlparse(u).netloc); r.abort()      # 외부 주소로는 보내지 않습니다
            else: r.continue_()
        self.pg.route('**/*', route)
        self.pg.on('pageerror', lambda e: self.errs.append('pageerror: ' + str(e)[:140]))
        def con(m):
            if m.type != 'error': return
            u = (m.location or {}).get('url', '') or ''
            if u.startswith('http'): return                                               # 시험이 막은 외부 요청(글꼴 · 우편번호 서비스) — 시안의 오류가 아님
            self.errs.append('console: ' + m.text[:140])
        self.pg.on('console', con)
        self.pg.on('dialog', lambda d: (self.dialogs.append(d.message[:80]), d.accept()))

    def open(self, close_ads=True):
        pg = self.pg
        pg.goto('file://' + FILE, wait_until='load', timeout=60000)
        pg.wait_for_function("window.__VIEW && __VIEW.state && __VIEW.state.screen && document.getElementById('screen').innerText.length > 100", timeout=30000)
        pg.wait_for_timeout(1200); pg.evaluate(TOASTHOOK)
        if close_ads: self.close_ads()
        return self.st()

    def vis(self, sel):
        loc = self.pg.locator(sel)
        try: return any(loc.nth(i).is_visible() for i in range(loc.count()))
        except Exception: return False

    def close_ads(self):
        """전면 광고 · 오른쪽 아래 작은 광고를 사람처럼 「✕」로 닫습니다. 닫은 것의 이름을 돌려줍니다"""
        done = []
        for sel, nm in (('.admask', '전면 광고'), ('.adfloat', '작은 광고')):
            if self.vis(sel):
                try: self.pg.locator(sel + ' .adx').first.click(timeout=4000); self.pg.wait_for_timeout(250); done.append(nm)
                except Exception: pass
        self.ads += done
        return done

    def st(self):
        return self.pg.evaluate(ST)

    def text(self):
        return self.pg.evaluate(TXT)

    def texts(self, sel):
        return [norm(x) for x in self.pg.locator(sel).all_inner_texts()]

    def count(self, sel):
        return self.pg.locator(sel).count()

    def find(self, sel, text=None, exact=None, nth=0):
        """보이는 것 가운데 nth 번째 — 없으면 None"""
        loc = self.pg.locator(sel)
        if text is not None: loc = loc.filter(has_text=text)
        k = 0
        for i in range(loc.count()):
            e = loc.nth(i)
            try:
                if not e.is_visible(): continue
                if exact is not None and norm(e.inner_text()) != exact: continue
            except Exception: continue
            if k == nth: return e
            k += 1
        return None

    def wait_change(self, before, t0, limit=3200):
        """누른 뒤 화면 · 내용 · 안내 글이 바뀔 때까지(최대 limit) 기다렸다가 상태를 돌려줍니다"""
        pg = self.pg; waited = 0; s = before; changed = False
        while waited <= limit:
            pg.wait_for_timeout(130); waited += 130
            try: s = self.st(); tn = pg.evaluate("(window.__flowT || []).length")
            except Exception: continue
            if any(s[k] != before[k] for k in ('open', 'key', 'hash', 'route', 'sig')) or tn > t0:
                changed = True; break
        if changed:
            pg.wait_for_timeout(380)
            try: s = self.st()
            except Exception: pass
        pg.evaluate(TOASTHOOK)
        s['toast'] = ' / '.join(pg.evaluate("(n) => (window.__flowT || []).slice(n)", t0))
        s['moved'] = any(s[k] != before[k] for k in ('open', 'key', 'hash', 'route'))
        # 시안에는 「눌러도 아무 변화가 없으면 안내 글이라도 띄우는」 장치가 있습니다(「시연: «…» — 실제 동작은 구현 화면 …」 · 「«…» 선택 — 시안은 표시만 바꿉니다」).
        # 그 글만 뜬 것은 「눌러도 바뀌지 않음」으로 셉니다.
        s['demo'] = bool(DEMO_ONLY.search(s['toast'])) and not s['moved']
        s['changed'] = changed and not s['demo']
        return s

    def click(self, sel, text=None, exact=None, nth=0, limit=3200):
        """보이는 그 단추 · 링크를 실제로 누르고, 누른 뒤의 상태를 돌려줍니다(clicked · changed · moved · toast · label 포함)"""
        pg = self.pg
        if self.vis('.admask'): self.close_ads()
        try: t0 = pg.evaluate(TOASTHOOK)
        except Exception: t0 = 0
        before = self.st(); e = self.find(sel, text, exact, nth)
        if e is None:
            before.update(clicked=False, changed=False, moved=False, demo=False, toast='', label='', why=f'누를 것이 화면에 없음({sel}{" · " + str(text or exact) if (text or exact) else ""})'); return before
        try: label = norm(e.inner_text() or e.get_attribute('aria-label') or '')[:28]
        except Exception: label = ''
        try: e.click(timeout=6000)
        except Exception as ex:
            if self.vis('.adfloat') or self.vis('.admask'):                               # 광고가 가리면 사람처럼 닫고 다시 누릅니다
                self.close_ads()
                try: e.click(timeout=6000)
                except Exception as ex2:
                    before.update(clicked=False, changed=False, moved=False, demo=False, toast='', label=label, why='누르지 못함: ' + str(ex2)[:80]); return before
            else:
                before.update(clicked=False, changed=False, moved=False, demo=False, toast='', label=label, why='누르지 못함: ' + str(ex)[:80]); return before
        s = self.wait_change(before, t0, limit); s['clicked'] = True; s['label'] = label; s['why'] = ''
        return s

    def act(self, fn, limit=2500):
        """누르기가 아닌 조작(글자 넣기 · 고르기 · 체크) 뒤의 상태"""
        t0 = self.pg.evaluate(TOASTHOOK); before = self.st(); fn(); s = self.wait_change(before, t0, limit); s['clicked'] = True; s['label'] = ''; s['why'] = ''
        return s

    def close(self):
        try: self.ctx.close()
        except Exception: pass


class Run:
    """흐름 하나 — 앞 단계(꼭 필요한 것)가 실패하면 남은 단계는 건너뜀으로 남깁니다"""
    def __init__(self, name, who):
        self.F = Flow(name, who); self.alive = True; self.why = ''

    def step(self, name, critical=True):
        def deco(fn):
            if not self.alive:
                self.F.step(name, HOW, False, f'앞 단계가 실패해 더 갈 수 없음 — 「{self.why}」', skip=True); return fn
            try: ok, detail = fn()
            except Exception as ex:
                ok, detail = False, '실행 중 오류(시험 쪽 착오일 수 있음): ' + repr(ex)[:220]
            self.F.step(name, HOW, ok, re.sub(r'\bFalse\b', '아니오', re.sub(r'\bTrue\b', '예', str(detail))))
            if not ok and critical: self.alive = False; self.why = name[:46]
            return fn
        return deco

    def skip(self, name, why):
        self.F.step(name, HOW, False, why, skip=True)

    def errors(self, D):
        ext = ('시험이 막은 외부 요청: ' + ' · '.join(sorted(D.blocked))) if D.blocked else '외부 요청 없음'
        self.F.step('이 흐름 내내 쪽 오류(스크립트 오류 · console error) 0', HOW, not D.errs, (D.errs[:3] if D.errs else f'오류 0 · {ext}' + (f' · 알림창 {len(D.dialogs)}' if D.dialogs else '')))


def nav_fail(s, want):
    return f"기대 {want} · 실제 {where(s)}" + (f" · {s['why']}" if s.get('why') else '') + (' · 눌러도 바뀌지 않음' + ('(시안의 「시연 안내」만 뜸)' if s.get('demo') else '') if s.get('clicked') and not s.get('changed') else '') + (f" · 안내 「{s['toast'][:60]}」" if s.get('toast') else '')


# ═════════════════════════════════════════════ S1 ═════════════════════════════════════════════
def s1(b):
    R = Run('S1 메인 → 관 → 목록 → 매물 상세 → 문의', '방문자(로그인하지 않음)'); D = Demo(b); pg = D.pg; C = {}

    @R.step('시안 파일을 서버 없이(file://) 엶 → 메인 화면 · 머리줄 메뉴 6개(소개장터 · 안심소개 · 소개창업 · 소개몰 · 소개광장 · 이용안내)')
    def _():
        s = D.open(close_ads=False); nav = D.texts('#screen header nav a'); C['title0'] = s['docTitle']
        return s['key'] == 'main1' and nav == MENU6 and '무엇을 찾고 계세요' in s['title'], f"파일 {os.path.basename(FILE)} · 화면 {where(s)} · 메뉴 {nav} · 창 제목 「{s['docTitle'][:24]}」"

    @R.step('처음 뜨는 전면 광고 · 오른쪽 아래 작은 광고를 「✕」로 닫음 → 메인이 가려지지 않음')
    def _():
        had = [n for sel, n in (('.admask', '전면 광고'), ('.adfloat', '작은 광고')) if D.vis(sel)]
        ad = norm(pg.locator('.admask h3').first.inner_text()) if D.vis('.admask') else ''
        done = D.close_ads()
        return not D.vis('.admask') and not D.vis('.adfloat') and done == had, f"뜬 것 {had or '없음'}" + (f" · 전면 광고 「{ad[:26]}」" if ad else '') + f" · 닫은 것 {done or '없음'}"

    @R.step('머리줄 「소개장터」를 누름 → 소개장터 화면 · 매물 카드가 보임 · 머리줄의 「소개장터」가 켜짐')
    def _():
        s = D.click('#screen header nav a', exact='소개장터'); n = D.count('#screen .pgc')
        ok = s['clicked'] and s['key'] == 'list' and s['hash'] == '#/g/mny' and n >= 6 and s['cur'] == '소개장터'
        return ok, (f"→ {where(s)} · 카드 {n}장 · 켜진 메뉴 「{s['cur']}」 · 창 제목 「{s['docTitle'][:18]}」" if ok else nav_fail(s, 'list #/g/mny'))

    # v10.30 — 소개장터 메인이 10/9 제시 디자인으로 바뀌어 「더보기 ›」 대신 「지금 인기 있는 상품/서비스」 머리의 「전체 목록」으로 갑니다
    @R.step('소개장터 메인의 「지금 인기 있는 상품/서비스」에서 「전체 목록」을 누름 → 「소개장터 전체 목록」 · 카드 12장 · 정렬 탭 4개')
    def _():
        s = D.click('#screen .mny-old-q a[data-go=lstm]', exact='전체 목록'); n = D.count('#screen .pc'); tabs = D.texts('#screen button.tb[data-x=lsort]')
        ok = s['clicked'] and s['key'] == 'lstm' and s['hash'] == '#/g/mny/list' and n >= 6 and len(tabs) == 4
        return ok, (f"→ {where(s)} · 카드 {n}장 · 정렬 {tabs}" if ok else nav_fail(s, 'lstm #/g/mny/list'))

    CARD = r"""(i) => { const e = [...document.querySelectorAll('#screen .pc')].filter(x => x.offsetParent !== null)[i]; if (!e) return null; const t = s => { const x = e.querySelector(s); return x ? (x.innerText || '').replace(/\s+/g, ' ').trim() : '' };
        const im = e.querySelector('.pcimg img'); const src = im ? im.getAttribute('src') || '' : '';
        return { no: e.getAttribute('data-open'), title: t(':scope > b'), cat: t('.ck'), price: t('.pf2 span'), region: t(':scope > .ls').split(' · ')[0], img: src.length + ':' + src.slice(-24) } }"""
    DET = r"""() => { const sc = document.getElementById('screen'); const t = s => { const x = sc.querySelector(s); return x ? (x.innerText || '').replace(/\s+/g, ' ').trim() : '' };
        const im = sc.querySelector('.dtimg img'); const src = im ? im.getAttribute('src') || '' : '';
        return { title: t('.dtt'), cat: t('.dtcat'), price: t('.dtprice'), region: t('.dtloc').replace(/^[^가-힣A-Za-z0-9]+/, ''), img: src.length + ':' + src.slice(-24),
                 prof: sc.querySelectorAll('.dtprof').length, stat: sc.querySelectorAll('.stat > div').length, qna: sc.querySelectorAll('.qna .qi').length, revs: sc.querySelectorAll('.revs .rv2').length,
                 bar: [...sc.querySelectorAll('.abar button')].map(b => (b.innerText || '').replace(/\s+/g, ' ').trim().replace(/^[^가-힣A-Za-z0-9]+/, '')), bad: /undefined|NaN|\[object/.test(sc.innerText) } }"""

    @R.step('목록의 넷째 카드를 누름 → 그 매물의 상세 화면(주소에 그 매물 번호)')
    def _():
        c = pg.evaluate(CARD, 3); C['card'] = c
        s = D.click('#screen .pc', nth=3)
        ok = bool(c) and s['clicked'] and s['key'] == 'dtlm' and s['hash'] == f"#/g/mny/l/{c['no']}"
        return ok, (f"누른 카드 「{c['title']}」 {c['price']} · {c['cat']} · {c['region']} → {where(s)} · 화면 ID {s['sid']}" if ok else nav_fail(s, f"dtlm #/g/mny/l/{c and c['no']}"))

    @R.step('상세의 제목 · 값 · 분류 · 지역 · 사진이 누른 카드와 같음')
    def _():
        c = C['card']; d = pg.evaluate(DET); C['det'] = d
        diff = [f"{k}: 카드 「{c[k]}」 ≠ 상세 「{d[k]}」" for k in ('title', 'price', 'cat', 'region') if norm(c[k]) != norm(d[k])] + ([] if c['img'] == d['img'] and c['img'] != '0:' else ['사진이 다름'])
        return not diff and not d['bad'], (diff or f"제목 「{d['title']}」 · 값 {d['price']} · 분류 {d['cat']} · 지역 {d['region']} · 사진 같음")

    @R.step('상세에 소개자 · 실적 4칸 · 문의 내용 · 후기 · 맨 아래 줄(관심 담기 · 질문 · 공유하기 · 신고 · 1:1 문의 시작)이 보임', critical=False)
    def _():
        d = C['det']; bar = [re.sub(r' \d+$', '', x.split(' 대화가')[0]) for x in d['bar']]
        ok = d['prof'] == 1 and d['stat'] == 4 and d['qna'] >= 1 and d['revs'] >= 1 and len(d['bar']) == 5 and d['bar'][0].startswith('관심 담기') and d['bar'][4].startswith('1:1 문의 시작')
        return ok, f"소개자 {d['prof']} · 실적 {d['stat']}칸 · 문의 {d['qna']}줄 · 후기 {d['revs']}건 · 아래 줄 {bar}"

    @R.step('맨 아래 줄의 「관심 담기」를 누름 → 안내 「관심 목록에 담았습니다.」', critical=False)
    def _():
        s = D.click('#screen .abar button[data-like]')
        return s['clicked'] and '관심 목록에 담았습니다' in s['toast'] and s['key'] == 'dtlm', f"안내 「{s['toast'][:50]}」 · 화면 그대로 {s['key']}" if s['clicked'] else s['why']

    @R.step('「1:1 문의 시작」을 누름 → 문의(대화) 화면 · 위쪽에 그 매물의 제목 · 값 · 주소에 그 매물 번호')
    def _():
        c = C['card']; s = D.click('#screen .abar button.go')
        bar = norm(pg.locator('#screen .askbar').first.inner_text()) if D.count('#screen .askbar') else ''
        ok = s['clicked'] and s['key'] == 'ask' and s['hash'] == f"#/g/mny/chat/{c['no']}" and c['title'] in bar and c['price'] in bar
        return ok, (f"→ {where(s)} · 위쪽 「{bar[:70]}」" if ok else nav_fail(s, f"ask #/g/mny/chat/{c['no']}") + f" · 위쪽 「{bar[:50]}」")

    @R.step('보낼 칸의 견본 글(계좌번호 …) 때문에 뜬 경고에서 「수정하겠습니다」를 누름 → 경고가 사라짐', critical=False)
    def _():
        t0 = D.text(); had = '보내기 전에 확인이 필요합니다' in t0
        s = D.click('#screen button[data-warn]', exact='수정하겠습니다'); t1 = D.text()
        return had and s['clicked'] and s['changed'] and '보내기 전에 확인이 필요합니다' not in t1, f"경고가 떠 있었음 {had} → 누른 뒤 경고 {'없음' if '보내기 전에 확인이 필요합니다' not in t1 else '그대로'}"

    @R.step('문의 글을 적고 「전송」을 누름 → 대화 맨 아래에 내가 보낸 글이 보임')
    def _():
        msg = '아직 거래 가능한가요? (흐름 점검)'
        pg.fill('#screen form[data-chat] input.in', msg); s = D.click('#screen form[data-chat] button.snd')
        mine = D.texts('#screen .chb .msg.me'); last = mine[-1] if mine else ''
        return s['clicked'] and s['changed'] and msg in last and s['key'] == 'ask', f"맨 아래 내 글 「{last[:44]}」 · 화면 {s['key']}"

    @R.step('「← 소개장터 상세(으)로 돌아가기」를 누름 → 처음 보던 그 매물의 상세(같은 주소 · 제목)')
    def _():
        c = C['card']; s = D.click('#screen button.bkl[data-back]'); t = norm(pg.locator('#screen .dtt').first.inner_text()) if D.count('#screen .dtt') else ''
        ok = s['clicked'] and s['key'] == 'dtlm' and s['hash'] == f"#/g/mny/l/{c['no']}" and t == c['title']
        return ok, (f"「{s['label']}」 → {where(s)}" if ok else nav_fail(s, f"dtlm #/g/mny/l/{c['no']}"))

    @R.step('다시 「← 소개장터 목록(으)로 돌아가기」를 누름 → 전체 목록')
    def _():
        s = D.click('#screen button.bkl[data-back]'); n = D.count('#screen .pc')
        ok = s['clicked'] and s['key'] == 'lstm' and s['hash'] == '#/g/mny/list' and n >= 6
        return ok, (f"「{s['label']}」 → {where(s)} · 카드 {n}장" if ok else nav_fail(s, 'lstm #/g/mny/list'))

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S2 ═════════════════════════════════════════════
def s2(b):
    R = Run('S2 로그인 · 가입 → 나의공간', '방문자 → 가입 신청 → 시안의 견본 회원(소개하니)으로 로그인'); D = Demo(b); pg = D.pg; C = {}

    @R.step('시안을 엶 → 메인 · 머리줄 오른쪽에 「로그인」 「무료 회원가입」')
    def _():
        s = D.open(); btn = D.texts('#screen header button.home-pill')
        return s['key'] == 'main1' and btn == ['로그인', '무료 회원가입'], f"{where(s)} · 단추 {btn}"

    @R.step('머리줄 「로그인」을 누름 → 로그인 화면(이메일 · 비밀번호 칸 · 「로그인」 · 「사업자로 회원가입」)')
    def _():
        s = D.click('#screen header button[data-auth=in]')
        ok = s['clicked'] and s['key'] == 'login' and s['hash'] == '#/login' and D.count('#lg-mail') == 1 and D.count('#lg-pw') == 1 and D.vis('#screen button[data-auth=submit]') and D.vis('#screen button[data-s=join]')
        return ok, (f"→ {where(s)} · 화면 ID {s['sid']} · 안내 「{norm(pg.locator('#screen h2 + p, #screen .lgs').first.inner_text())[:30] if D.count('#screen h2 + p, #screen .lgs') else ''}」" if ok else nav_fail(s, 'login #/login'))

    @R.step('「사업자로 회원가입」을 누름 → 회원가입 화면 · 단계 5개 · 가입 유형 3가지(개인 회원 · 개인 사업자 · 법인 사업자)')
    def _():
        s = D.click('#screen button[data-s=join]'); steps = D.texts('#screen .jst .js b'); types = D.texts('#screen .jop:not(.no) > div > b')
        ok = s['clicked'] and s['key'] == 'join' and s['hash'] == '#/join' and steps == ['사업자 유형', '기업 인증', '담당자 정보', '약관 동의', '관심 성향'] and types == ['개인 회원', '개인 사업자', '법인 사업자']
        return ok, (f"→ {where(s)} · 단계 {steps} · 유형 {types}" if ok else nav_fail(s, 'join #/join') + f" · 단계 {steps} · 유형 {types}")

    @R.step('가입 유형 「개인 사업자」를 누름 → 그 칸이 골라짐')
    def _():
        s = D.click('#screen .jop[data-jt=sole]'); on = D.texts('#screen .jop.on > div > b')
        return s['clicked'] and on == ['개인 사업자'], f"골라진 유형 {on}"

    @R.step('「다음 ▶」을 누름 → 2단계 「기업 인증」 · 인증 전에는 「다음 ▶」이 꺼져 있음')
    def _():
        s = D.click('#screen .jnav button[data-js="2"]'); t = D.text(); dis = pg.locator('#screen .jnav button[data-js="3"]').is_disabled() if D.count('#screen .jnav button[data-js="3"]') else None
        return s['clicked'] and s['changed'] and '2. 기업 인증' in t and '인증 전' in t and dis is True, f"화면 {s['key']} · 「2. 기업 인증」 {'2. 기업 인증' in t} · 다음 단추 꺼짐 {dis}"

    @R.step('「인증하기」를 누름 → 「인증 완료」 · 상호 · 대표자명 · 개업일자가 채워짐 · 「다음 ▶」이 켜짐')
    def _():
        s = D.click('#screen button[data-jv]'); t = D.text(); vals = [pg.locator('#screen .jsec input[readonly]').nth(i).input_value() for i in range(D.count('#screen .jsec input[readonly]'))]
        dis = pg.locator('#screen .jnav button[data-js="3"]').is_disabled()
        return s['clicked'] and s['changed'] and '인증 완료' in t and '(주)세바코리아' in vals and '김대표' in vals and dis is False, f"채워진 값 {vals[-4:]} · 다음 단추 꺼짐 {dis}"

    @R.step('「다음 ▶」 → 3단계 「담당자 정보」 · 이름 · 휴대폰 · 이메일 · 비밀번호를 적고 「본인확인」을 누름 → 모의 인증 안내')
    def _():
        s = D.click('#screen .jnav button[data-js="3"]'); t = D.text(); ins = pg.locator('#screen .jsec input.in'); n = ins.count()
        if n >= 6:
            for i, v in enumerate(['김시연', '010-1234-5678', 'demo@sogae.test', '사업개발팀 팀장', 'Demo-pass-1234!', 'Demo-pass-1234!']): ins.nth(i).fill(v)
        s2_ = D.click('#screen .jsec button.jvb', exact='본인확인')
        return s['clicked'] and '3. 담당자 정보' in t and n == 6 and '모의' in s2_['toast'], f"입력 칸 {n}개 · 「본인확인」 안내 「{s2_['toast'][:44]}」"

    @R.step('「다음 ▶」 → 4단계 「약관 동의」 · 필수 4 · 선택 1 · 선택 항목(마케팅)을 눌러 켬')
    def _():
        s = D.click('#screen .jnav button[data-js="4"]'); t = D.text()
        ag = pg.evaluate("[...document.querySelectorAll('#screen .agl .ag')].map(a => [a.querySelector('.t').textContent.trim(), a.querySelector('.rq2').textContent.trim(), a.querySelector('.cb').classList.contains('on')])")
        s2_ = D.click('#screen .agl .ag[data-ag="4"] .t'); on = pg.evaluate("[...document.querySelectorAll('#screen .agl .ag .cb')].map(c => c.classList.contains('on'))")
        ok = s['clicked'] and '4. 약관 동의' in t and [a[1] for a in ag] == ['[필수]'] * 4 + ['[선택]'] and [a[2] for a in ag] == [True] * 4 + [False] and s2_['changed'] and on == [True] * 5
        return ok, f"약관 {[a[0] for a in ag]} · 처음 {[a[2] for a in ag]} → 선택 항목을 누른 뒤 {on} · 안내 「운영자 승인 후 가입이 완료됩니다」 {'운영자 승인 후 가입이 완료됩니다' in t}"

    @R.step('「다음 ▶」 → 5단계 「관심 성향(선택)」 · 보기 하나를 고름', critical=False)
    def _():
        s = D.click('#screen .jnav button[data-js="5"]'); t = D.text(); n = D.count('#screen button.qop')
        s2_ = D.click('#screen button.qop[data-aiq=q1][data-aiv=fr]')
        return s['clicked'] and '5. 관심 성향' in t and n >= 20 and s2_['changed'] and D.vis('#screen .jnav button[data-go=joind]'), f"질문 보기 {n}개 · 「프랜차이즈 · 창업」을 누르자 화면이 바뀜 {s2_['changed']} · 「가입 신청하기」 단추 보임"

    @R.step('「가입 신청하기」를 누름 → 가입 뒤 화면 「가입 신청이 접수되었습니다」 · 진행 4칸(접수 완료 · 사업자 확인 · 운영자 승인 심사 중 · 가입 완료 대기)')
    def _():
        s = D.click('#screen .jnav button[data-go=joind]'); t = D.text()
        ok = s['clicked'] and s['key'] == 'joind' and s['hash'] == '#/join/done' and '가입 신청이 접수되었습니다' in s['title'] and all(w in t for w in ('접수 완료', '사업자 확인 자동 통과', '운영자 승인 심사 중', '가입 완료 대기', '(주)세바코리아'))
        C['done_btn'] = D.texts('#screen .wrap button.jb')
        return ok, (f"→ {where(s)} · 단추 {C['done_btn']} · 「운영자 승인 후 가입이 완료됩니다. 영업일 기준 1일 이내」 {'영업일 기준 1일 이내' in t}" if ok else nav_fail(s, 'joind #/join/done'))

    @R.step('가입 뒤 화면의 「메인으로」를 누름 → 메인(이 화면에는 로그인 · 나의공간으로 바로 가는 단추가 없어 메인을 거침)')
    def _():
        s = D.click('#screen button[data-s=main1]')
        return s['clicked'] and s['key'] == 'main1' and s['hash'] == '#/', (f"가입 뒤 화면의 단추 {C.get('done_btn')} → {where(s)}" if s['key'] == 'main1' else nav_fail(s, 'main1 #/'))

    @R.step('머리줄 「로그인」 → 이메일 · 비밀번호를 적고 「로그인」을 누름 → 로그인된 메인 · 머리줄에 회원 이름 · 「나의공간」 「로그아웃」')
    def _():
        s0 = D.click('#screen header button[data-auth=in]')
        if s0['key'] != 'login': return False, nav_fail(s0, 'login')
        pg.fill('#lg-mail', 'demo@sogae.test'); pg.fill('#lg-pw', 'Demo-pass-1234!')
        s = D.click('#screen button[data-auth=submit]'); btn = D.texts('#screen header button.home-pill'); hd = norm(pg.locator('#screen header').first.inner_text())
        ok = s['clicked'] and s['key'] == 'main2' and btn[:2] == ['나의공간', '로그아웃'] and '소개하니' in hd
        return ok, (f"→ {where(s)} · 머리줄 단추 {btn} · 이름 「소개하니」 보임" if ok else nav_fail(s, 'main2') + f" · 단추 {btn}")

    @R.step('머리줄 「나의공간」을 누름 → 나의공간 · 프로필 · 요약 4칸 · 바로가기 14개(v10.27 G-198 — 결제 수단 · 알림 · 한도 안내 · 사업자 전환 · 소개 활동 더함)')
    def _():
        s = D.click('#screen header button[data-go=my]'); tiles = D.texts('#screen .tiles .tile .tl'); cards = D.texts('#screen .mgrid .mcard b'); menu = D.texts('#screen .mynav a')
        C['menu'] = menu
        ok = s['clicked'] and s['key'] == 'my' and s['hash'] == '#/my' and len(tiles) == 4 and len(cards) == 14 and all(x in cards for x in ('결제 수단', '알림', '소개 활동')) and D.count('#screen .prof') == 1
        return ok, (f"→ {where(s)} · 요약 {tiles} · 왼쪽 메뉴 {menu}"[:300] if ok else nav_fail(s, 'my #/my'))

    @R.step('바로가기 「내 등록 리스팅」을 누름 → 내 매물 목록 · 상태 탭 6개 · 매물 줄')
    def _():
        s = D.click('#screen .mgrid .mcard[data-go=mylst]'); tabs = D.texts('#screen button.tb[data-x=mylst]'); rows = D.texts('#screen .mymain b.lnk')
        ok = s['clicked'] and s['key'] == 'mylst' and s['hash'] == '#/my/listings' and len(tabs) == 6 and len(rows) >= 1
        return ok, (f"→ {where(s)} · 탭 {tabs} · 줄 {len(rows)}건(첫 줄 「{rows[0][:20]}」) · 왼쪽 메뉴에는 「{next((m for m in C['menu'] if m.startswith('내 등록')), '')}」" if ok else nav_fail(s, 'mylst'))

    @R.step('「← 나의공간(으)로 돌아가기」 → 나의공간 → 바로가기 「관심 목록」을 누름 → 관심 목록 · 줄마다 「보기」 「1:1 문의」')
    def _():
        s0 = D.click('#screen button.bkl[data-back]')
        if s0['key'] != 'my': return False, nav_fail(s0, 'my')
        s = D.click('#screen .mgrid .mcard[data-go=mylik]'); n1 = D.count('#screen .mymain button[data-open]'); n2 = D.count('#screen .mymain button[data-askitem]')
        ok = s['clicked'] and s['key'] == 'mylik' and s['hash'] == '#/my/likes' and n1 >= 1 and n1 == n2
        return ok, (f"돌아가기 → my → {where(s)} · 줄 {n1}건 · 「보기」 {n1} · 「1:1 문의」 {n2} · 왼쪽 메뉴에는 「{next((m for m in C['menu'] if m.startswith('관심')), '')}」" if ok else nav_fail(s, 'mylik'))

    @R.step('관심 목록 첫 줄의 「보기」를 누름 → 그 매물의 상세 → 「돌아가기」 → 다시 관심 목록', critical=False)
    def _():
        row = norm(pg.locator('#screen .mymain tbody tr').first.inner_text()) if D.count('#screen .mymain tbody tr') else ''
        s = D.click('#screen .mymain button[data-open]'); t = norm(pg.locator('#screen .dtt').first.inner_text()) if D.count('#screen .dtt') else ''
        s2_ = D.click('#screen button.bkl[data-back]')
        ok = s['clicked'] and s['key'] in ('detail', 'dtlm', 'dtll') and bool(t) and t in row and s2_['key'] == 'mylik'
        return ok, f"첫 줄 「{row[:40]}」 → {where(s)} · 상세 제목 「{t[:26]}」 → 돌아가기 → {s2_['key']}"

    @R.step('왼쪽 메뉴 「설정 · 알림」을 누름 → 알림 화면으로 감', critical=False)
    def _():
        s = D.click('#screen .mynav a', exact='설정 · 알림'); bell = D.count('#screen header .bell[data-t]')
        ok = s['clicked'] and s['moved'] and s['key'] == 'myntf'
        return ok, (f"→ {where(s)}" if ok else f"화면이 바뀌지 않음(그대로 {s['key']}) — 안내 글만 뜸 「{s['toast'][:36]}」 · 머리줄의 종(🔔 {bell}개)도 안내 글만. 알림 화면(myntf · SB-MYP-NTF-010 「알림 센터」)은 시안에 있으나 거기로 가는 단추 · 링크가 어느 화면에도 없음(주소 #/my/notifications 는 「페이지를 찾을 수 없습니다」)")

    @R.step('왼쪽 메뉴 「구독 · 소개코드」를 누름 → 구독 화면 · 「내 구독」 · 요금제 3종 · 결제 내역')
    def _():
        s = D.click('#screen .mynav a[data-go=mysub]'); t = D.text(); plans = D.count('#screen .plans .plan')
        ok = s['clicked'] and s['key'] == 'mysub' and s['hash'] == '#/my/subscription' and D.count('#screen [data-pb-box="my"]') == 1 and plans == 3 and '결제 내역' in t
        return ok, (f"→ {where(s)} · 내 구독 상자 1 · 요금제 {plans}종 · 결제 내역 표 있음" if ok else nav_fail(s, 'mysub'))

    @R.step('머리줄 「로그아웃」을 누름 → 로그인 전의 메인(머리줄에 다시 「로그인」)', critical=False)
    def _():
        s = D.click('#screen header [data-auth=out]'); btn = D.texts('#screen header button.home-pill')
        return s['clicked'] and s['key'] == 'main1' and btn == ['로그인', '무료 회원가입'], f"→ {where(s)} · 머리줄 단추 {btn}"

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S3 ═════════════════════════════════════════════
def s3(b):
    R = Run('S3 매물 등록 → 검수 안내', '등록하려는 사람(시안은 로그인 없이도 등록 화면이 열림)'); D = Demo(b); pg = D.pg; C = {'title': '흐름 점검 매물 — 업소용 커피머신 일괄 양도'}

    # v10.30 — 소개장터 메인의 역할 탭 3개가 10/9 제시 디자인의 바로가기 3장으로 바뀜(가는 곳은 같음)
    @R.step('시안을 엶 → 머리줄 「소개장터」 → 소개장터 메인의 바로가기 「소개하기」를 누름 → 등록 화면 「상품/서비스 등록하기」 · 구역 5개')
    def _():
        D.open(); s0 = D.click('#screen header nav a', exact='소개장터')
        if s0['key'] != 'list': return False, nav_fail(s0, 'list')
        s = D.click('#screen a.mny-qc[data-go=reg]'); t = D.text(); secs = [w for w in ('1. 기본 정보', '2. 상품/서비스 상세 설명', '3. 소개 조건', '4. 지역 정보', '5. 거래 및 운영 정보') if w in t]
        ok = s['clicked'] and s['key'] == 'reg' and s['hash'] == '#/register' and len(secs) == 5 and D.vis('#screen [data-fdone=reg]')
        return ok, (f"→ {where(s)} · 구역 {secs} · 맨 아래 「등록취소」 「등록완료」" if ok else nav_fail(s, 'reg #/register'))

    @R.step('아무것도 적지 않고 「등록완료」를 누름 → 등록되지 않고 빠진 필수 항목을 알려 줌', critical=False)
    def _():
        s = D.click('#screen [data-fdone=reg]'); n = D.count('#screen .fmiss')
        return s['clicked'] and s['key'] == 'reg' and '필수 항목' in s['toast'] and n >= 5, f"화면 그대로 {s['key']} · 안내 「{s['toast'][:60]}」 · 빨간 표시 {n}칸"

    @R.step('1. 기본 정보 — 관 「소개장터」를 고름 → 업종 목록이 열림 → 업종을 고름 → 등급 · 부담 주체가 자동으로 정해짐')
    def _():
        dis0 = pg.locator('#f-reg-cat').is_disabled()
        s = D.act(lambda: pg.select_option('#f-reg-gwan', label='소개장터')); opts = pg.evaluate("[...document.querySelector('#f-reg-cat').options].map(o => o.text)"); dis1 = pg.locator('#f-reg-cat').is_disabled()
        D.act(lambda: pg.select_option('#f-reg-cat', label='가전 · 디지털')); t = D.text(); C['cat'] = '가전 · 디지털'
        g = re.search(r'등급 자동 (\S+)', t); bd = re.search(r'부담 주체 자동 (.{2,12}?) 관마다', t)
        ok = dis0 and not dis1 and len(opts) > 5 and s['changed'] and bool(g) and g.group(1) in ('골든', '실버', '브론즈', '기타') and bool(bd)
        C['grade'] = g.group(1) if g else ''
        return ok, f"업종 칸 처음 꺼짐 {dis0} → 관을 고르자 열림(업종 {len(opts) - 1}개) · 업종 「가전 · 디지털」 → 등급 자동 「{C['grade']}」 · 부담 주체 자동 「{bd.group(1) if bd else ''}」"

    @R.step('상품/서비스명 · 한줄 소개를 적음 → 글자 수가 같이 올라감 / 2. 상세 설명을 적음')
    def _():
        intro = '흐름 점검에서 넣은 한줄 소개입니다'; desc = '흐름 점검 도구가 넣은 상세 설명입니다. 2그룹 반자동 커피머신 3대 · 그라인더 포함.'
        pg.fill('#f-reg-title', C['title']); pg.fill('#f-reg-intro', intro); pg.fill('#f-reg-desc', desc)
        pg.wait_for_timeout(200); t = D.text(); n = len(C['title']); n2 = len(intro); n3 = len(desc)
        return f'{n} / 50' in t and f'{n2} / 60' in t and f'{n3} / 3000' in t and pg.input_value('#f-reg-title') == C['title'], f"이름 {n}자 → 「{n} / 50」 표시 {f'{n} / 50' in t} · 한줄 소개 「{n2} / 60」 표시 {f'{n2} / 60' in t} · 상세 설명 「{n3} / 3000」 표시 {f'{n3} / 3000' in t}"

    @R.step('3. 소개 조건 — 소개비 500000 을 적음 → 「500,000」으로 쉼표가 붙음 · 계약 지원 · 문의 가능 시간을 넣음')
    def _():
        pg.click('#f-reg-fee'); pg.keyboard.type('500000'); pg.wait_for_timeout(150); fee = pg.input_value('#f-reg-fee')
        D.act(lambda: pg.select_option('#f-reg-support', label='계약서 검토 지원')); pg.fill('#f-reg-hours', '평일 10:00 ~ 18:00')
        return fee == '500,000' and pg.input_value('#f-reg-support') != '' and pg.input_value('#f-reg-title') == C['title'], f"소개비 칸 「{fee}」 · 계약 지원 「{pg.input_value('#f-reg-support')}」 · 앞에서 적은 이름이 그대로 남아 있음"

    @R.step('4. 지역 정보 — 「우편번호 찾기」를 누름 → 주소 창이 뜸(외부 우편번호 서비스는 시험에서 막아 「직접 입력」 칸이 나옴) → 주소를 적고 「이 주소 쓰기」 → 주소 칸에 들어감')
    def _():
        s = D.click('#screen [data-adr-open=reg]', limit=2500)
        try: pg.wait_for_selector('.adrmask form.adrman', timeout=15000)
        except Exception: return False, f"주소 창에 직접 입력 칸이 나오지 않음 — 창 내용 「{norm(pg.locator('.adrmask').first.inner_text())[:80] if D.count('.adrmask') else '창 없음'}」"
        head = norm(pg.locator('.adrmask .adrmh').first.inner_text())
        for k, v in (('zip', '06236'), ('sido', '서울'), ('sigungu', '강남구'), ('road', '서울 강남구 테헤란로 152'), ('bname', '역삼동')): pg.fill(f'.adrman input[name={k}]', v)
        s2_ = D.click('.adrman button[type=submit]')
        vals = {pg.locator('#screen input[aria-label]').nth(i).get_attribute('aria-label'): pg.locator('#screen input[aria-label]').nth(i).input_value() for i in range(D.count('#screen input[aria-label]'))}
        ok = s['clicked'] and s2_['clicked'] and D.count('.adrmask') == 0 and vals.get('우편번호') == '06236' and vals.get('도로명주소') == '서울 강남구 테헤란로 152'
        return ok, f"주소 창 「{head[:34]}」 → 「이 주소 쓰기」 → 우편번호 {vals.get('우편번호')} · 도로명주소 {vals.get('도로명주소')} · 안내 「{s2_['toast'][:40]}」"

    @R.step('5. 거래 및 운영 정보 — 월매출 · 희망조건을 넣음 → 「지금까지 N칸 입력했습니다」가 올라감')
    def _():
        pg.fill('#f-reg-sales', '8,000만원 내외'); D.act(lambda: pg.select_option('#f-reg-wish', label='협의 후 결정')); t = D.text(); m = re.search(r'지금까지 (\d+)칸 입력했습니다', t)
        return bool(m) and int(m.group(1)) >= 10 and pg.input_value('#f-reg-title') == C['title'], f"「지금까지 {m.group(1) if m else '?'}칸 입력했습니다」 · 「등록완료를 누르면 내 등록 리스팅에 검수대기로 한 건이 추가됩니다」 {'검수대기로 한 건이 추가됩니다' in t}"

    @R.step('「등록완료」를 누름 → 「내 등록 리스팅」 화면으로 감 · 검수 안내 「등록했습니다 — 검수 대기 상태입니다(SLA 24시간)」')
    def _():
        C['n0'] = None
        s = D.click('#screen [data-fdone=reg]')
        ok = s['clicked'] and s['key'] == 'mylst' and s['hash'] == '#/my/listings' and '검수 대기 상태입니다' in s['toast'] and 'SLA 24시간' in s['toast']
        return ok, (f"→ {where(s)} · 안내 「{s['toast'][:70]}」" if ok else nav_fail(s, 'mylst #/my/listings'))

    @R.step('목록 맨 위 줄이 방금 적은 매물 — 이름 · 「검수대기」 · 관 「소개장터」 · 업종 · 등급 · 오늘 날짜')
    def _():
        row = norm(pg.locator('#screen .mymain .lrow').first.inner_text()) if D.count('#screen .mymain .lrow') else ''
        C['no'] = (re.search(r'L-\d+', row) or [None])[0] if row else None
        ok = C['title'] in row and row.startswith('검수대기') and '소개장터' in row and C['cat'] in row and C['grade'] in row and time.strftime('%Y-%m-%d') in row
        return ok, f"맨 위 줄 「{row[:110]}」"

    @R.step('상태 탭 「검수대기」를 누름 → 검수대기인 것만 남고 방금 매물이 그 안에 있음', critical=False)
    def _():
        s = D.click('#screen button.tb[data-x=mylst][data-xv="검수대기"]'); rows = D.texts('#screen .mymain .lrow')
        ok = s['clicked'] and s['changed'] and len(rows) >= 1 and all(r.startswith('검수대기') for r in rows) and any(C['title'] in r for r in rows)
        return ok, f"탭 「{s['label']}」 · 남은 줄 {len(rows)}건 · 모두 검수대기 {all(r.startswith('검수대기') for r in rows)} · 방금 매물 있음 {any(C['title'] in r for r in rows)}"

    R.skip('등록 단계 사이의 「다음」 단추 · 따로 된 「등록 완료 / 검수 안내」 화면', '시안에 이 화면이 없음 — 등록은 한 화면(구역 5개)에서 끝나고, 「등록완료」를 누르면 안내 글과 함께 「내 등록 리스팅」으로 갑니다(검수 안내는 그 안내 글과 「검수대기」 표시)')
    R.errors(D); D.close()


# ═════════════════════════════════════════════ S4 ═════════════════════════════════════════════
def s4(b):
    R = Run('S4 안심소개 상담 — 축 → 업종 상세 → 신청서 → 접수', '방문자(로그인하지 않음)'); D = Demo(b); pg = D.pg; C = {}

    @R.step('시안을 엶 → 머리줄 「안심소개」를 누름 → 안심소개 화면 · 축 3개(기계 · 설비 · 시설 / 부동산 / 생활 · 금융 상담)')
    def _():
        D.open(); s = D.click('#screen header nav a', exact='안심소개'); ax = [x.split(' ')[0] if False else x for x in D.texts('#screen .axt')]
        ok = s['clicked'] and s['key'] == 'listl' and s['hash'] == '#/g/mal' and len(ax) == 3 and ax[2].startswith('생활 · 금융 상담') and s['cur'] == '안심소개'
        return ok, (f"→ {where(s)} · 축 {ax} · 켜진 메뉴 「{s['cur']}」" if ok else nav_fail(s, 'listl #/g/mal') + f" · 축 {ax}")

    @R.step('축 「생활 · 금융 상담」을 누름 → 상담 축(주소 …/consult) · 업종 22줄 · 줄마다 「상세 보기」와 「상담 신청」(법률 · 세무는 「사무소 보기」)')
    def _():
        s = D.click('#screen .axt', text='생활 · 금융 상담'); n = D.count('#screen .axrow[data-csl]'); on = D.texts('#screen .axt.on')
        btn = pg.evaluate("[...document.querySelectorAll('#screen .axrow[data-csl]')].map(r => [...r.querySelectorAll('.axr a')].map(a => a.textContent.trim()).join('+'))")
        kinds = sorted(set(btn))
        ok = s['clicked'] and s['key'] == 'listl' and s['hash'] == '#/g/mal/consult' and n == 22 and on and on[0].startswith('생활 · 금융 상담') and btn.count('상세 보기+상담 신청') >= 18
        return ok, (f"→ {where(s)} · 켜진 축 「{on[0][:12]}」 · 업종 {n}줄 · 줄의 단추 {kinds} ({btn.count('상세 보기+상담 신청')}줄이 상세 보기+상담 신청)" if ok else nav_fail(s, 'listl #/g/mal/consult') + f" · 줄 {n}")

    @R.step('「이사짐」 줄의 「상세 보기」를 누름 → 업종 상세 「이사짐」 · 인증업체 수 · 받는 지역 · 진행 순서 · 알아 두실 것')
    def _():
        row = norm(pg.locator('#screen .axrow[data-csl="CSL_MOVING"]').first.inner_text()); C['row'] = row
        s = D.click('#screen .axrow[data-csl="CSL_MOVING"] .axr a', exact='상세 보기'); t = D.text(); m = re.search(r'인증업체 (\d+)곳', row)
        ok = s['clicked'] and s['key'] == 'malcsld' and s['hash'] == '#/mal/consult/CSL_MOVING' and s['title'] == '이사짐' and all(w in t for w in ('받을 수 있는 인증업체', '받는 지역', '이렇게 진행됩니다', '알아 두실 것', 'SB-MAL-CSL-025')) and bool(m) and f"받을 수 있는 인증업체 {m.group(1)}곳" in t
        return ok, (f"누른 줄 「{row[:44]}」 → {where(s)} · 상세의 인증업체 수가 줄과 같음({m.group(1)}곳) · 구역 4개 · 화면 ID SB-MAL-CSL-025" if ok else nav_fail(s, 'malcsld #/mal/consult/CSL_MOVING'))

    @R.step('맨 아래 「상담 신청」을 누름 → 신청서 「이사짐 상담 신청」 · 이름 · 휴대폰(인증번호 받기) · 이메일(v10.28) · 지역 · 상담 내용 · 동의 칸')
    def _():
        s = D.click('#screen .cslD .abar a.go'); f = [k for k in ('#csl-name', '#csl-tel', '#csl-mail', '#csl-area', '#csl-memo', '#csl-agree') if D.count(k) == 1]
        ok = s['clicked'] and s['key'] == 'malcsl' and s['hash'] == '#/mal/consult/CSL_MOVING/apply' and s['title'] == '이사짐 상담 신청' and len(f) == 6 and D.vis('#screen [data-csl-otp]')
        return ok, (f"「{s['label'][:8]}」 → {where(s)} · 입력 칸 {len(f)}개 · 「인증번호 받기」" if ok else nav_fail(s, 'malcsl …/apply'))

    @R.step('아무것도 적지 않고 「상담 신청」을 누름 → 접수되지 않고 「이름을 적어 주십시오.」', critical=False)
    def _():
        s = D.click('#screen [data-csl-submit]'); e = norm(pg.locator('#screen .cslerr').first.inner_text()) if D.count('#screen .cslerr') else ''
        return s['clicked'] and s['changed'] and e == '이름을 적어 주십시오.' and s['title'] == '이사짐 상담 신청', f"화면 그대로 「{s['title']}」 · 빨간 안내 「{e}」"

    @R.step('이름 · 휴대폰을 적고 「인증번호 받기」를 누름 → 「확인됨 (시연)」으로 바뀜')
    def _():
        pg.fill('#csl-name', '김시연'); pg.fill('#csl-tel', '010-1234-5678'); s = D.click('#screen [data-csl-otp]'); lab = norm(pg.locator('#screen [data-csl-otp]').first.inner_text()); t = D.text()
        return s['clicked'] and s['changed'] and lab == '확인됨 (시연)' and pg.input_value('#csl-name') == '김시연', f"단추 글자 「{lab}」 · 안내 「지금은 시연으로 확인된 것으로 표시합니다」 {'시연으로 확인된 것으로 표시' in t} · 적은 이름이 남아 있음"

    @R.step('이메일을 적고(v10.28 · 지시서 4절) 지역 「서울특별시」를 고르고 상담 내용을 적고 동의에 체크한 뒤 「상담 신청」을 누름 → 접수 화면 「상담 신청 접수」 · 접수번호')
    def _():
        pg.fill('#csl-mail', 'kim@example.com'); pg.select_option('#csl-area', label='서울특별시'); pg.fill('#csl-memo', '10월 말 투룸 이사 견적 부탁드립니다'); pg.check('#csl-agree')
        s = D.click('#screen [data-csl-submit]'); t = D.text(); m = re.search(r'접수번호 (C-\d{6}-\d{4})', t); C['no'] = m.group(1) if m else ''
        ok = s['clicked'] and s['key'] == 'malcsl' and s['title'] == '상담 신청 접수' and bool(m) and '이사짐 상담 신청을 받았습니다' in t and 'SB-MAL-CSL-040' in t
        return ok, (f"→ {where(s)} · 「이사짐 상담 신청을 받았습니다」 · 접수번호 {C['no']} · 「인증된 업체 1곳이 연락드립니다」 {'인증된 업체 1곳이 연락드립니다' in t} · 화면 ID SB-MAL-CSL-040" if ok else nav_fail(s, '접수 화면') + f" · 빨간 안내 「{norm(pg.locator('#screen .cslerr').first.inner_text()) if D.count('#screen .cslerr') else ''}」")

    @R.step('접수 화면의 「안심소개로」를 누름 → 다시 상담 축(업종 22줄)')
    def _():
        s = D.click('#screen a.bp', exact='안심소개로'); n = D.count('#screen .axrow[data-csl]')
        ok = s['clicked'] and s['key'] == 'listl' and s['hash'] == '#/g/mal/consult' and n == 22
        return ok, (f"→ {where(s)} · 업종 {n}줄" if ok else nav_fail(s, 'listl #/g/mal/consult'))

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S5 ═════════════════════════════════════════════
def s5(b):
    R = Run('S5 소개몰 — 메인 → 상품 → 장바구니 → 주문서 → 결제 → 완료 → 내 주문 → 배송 조회 → 반품 신청', '구매자(시안의 견본 배송지 · 견본 주문이 들어 있음)'); D = Demo(b); pg = D.pg; C = {}
    M = '#hltapp main '
    cartn = lambda: norm(pg.locator('#hltapp header.b2-hd .b2-cart .b2-cartn').first.inner_text()) if D.count('#hltapp header.b2-hd .b2-cart .b2-cartn') else ''
    ORD = r"""() => [...document.querySelectorAll('#hltapp main .hlt-ord')].map(o => { const h = o.querySelector('.hlt-ord-h'); const st = o.querySelector('.hlt-bdg.st'); const bs = [...o.querySelectorAll('.hlt-ci .bd b')];
        return { no: ((h ? h.textContent : '').match(/H\d{8}-\d+/) || [''])[0], head: (h ? h.textContent : '').replace(/\s+/g, ' ').trim(), state: st ? st.textContent.trim() : '', name: bs[0] ? bs[0].textContent.trim() : '', price: bs.length ? bs[bs.length - 1].textContent.trim() : '',
                 btns: [...o.querySelectorAll('.hlt-btns button')].map(x => x.textContent.trim()) } })"""

    @R.step('시안을 엶 → 머리줄 「소개몰」을 누름 → 소개몰 메인이 겹쳐 뜸 · 전용 머리줄(켜진 메뉴 「소개몰」) · 장바구니 0')
    def _():
        D.open(); s = D.click('#screen header nav a', exact='소개몰', limit=5000); pg.wait_for_timeout(500); s = {**s, **D.st()}
        secs = D.texts(M + '.shop-sec h2')
        ok = s['open'] and s['key'] == 'SB-HLT-HUB-010' and s['hash'] == '#/health' and 'b2-hd' in s['hcls'] and s['cur'] == '소개몰' and cartn() == '0' and len(secs) >= 7
        return ok, (f"→ {where(s)} · 주소 {s['hash']} · 구역 {len(secs)}개({secs[0]} … {secs[-2]}) · 장바구니 {cartn()} · 창 제목 「{s['docTitle']}」" if ok else nav_fail(s, '소개몰 SB-HLT-HUB-010'))

    @R.step('「이번 주 특별 할인」의 첫 카드를 누름 → 그 실제 상품의 상세(v10.27 G-199 · 10/8 「실제 상품값으로」)')
    def _():
        card = norm(pg.locator(M + '[data-shop-deal] .shop-dealc').first.inner_text()); go = pg.locator(M + '[data-shop-deal] .shop-dealc').first.get_attribute('data-go'); C['deal'] = card
        s = D.click(M + '[data-shop-deal] .shop-dealc'); n = D.count(M + 'article.hlt-card')
        ok = s['clicked'] and s['open'] and s['route'] == go and s['key'] == 'SB-HLT-PRD-010' and go.startswith('#/p/') and not s['nf']
        return ok, (f"누른 카드 「{card[:50]}」 → {where(s)}" if ok else nav_fail(s, f'소개몰 {go}'))

    @R.step('상품 카드를 누름 → 상품 상세 · 이름 · 값이 카드와 같음 · 개월 수 옵션 · 판매자 정보 · 「배송비 전 상품 무료」 · 「반품 배송비 왕복 6,000원」')
    def _():
        # v10.27 — 특별 할인 카드가 상품 상세로 바로 가므로, 그 상품의 성분 목록(상세의 위 경로 「성분」)을 열고 거기서 상품 카드를 누름
        crumb = pg.locator('#hltapp .hlt-crumb a[data-go^="#/i/"]')
        if crumb.count(): crumb.first.click(); pg.wait_for_timeout(700)
        card = pg.evaluate("(() => { const a = document.querySelector('#hltapp main article.hlt-card'); const t = a.innerText.replace(/\\s+/g, ' '); return { go: a.getAttribute('data-go'), t } })()")
        s = D.click(M + 'article.hlt-card'); t = D.text(); name = s['title']; C['name'] = name; C['pid'] = (s['route'] or '').split('/')[-1]
        opts = pg.evaluate("(() => [...document.querySelectorAll('#hltapp main input[id^=q_]')].map(i => { const r = i.closest('div').parentElement; return [i.id, (i.getAttribute('aria-label') || ''), (r.innerText || '').replace(/\\s+/g, ' ').slice(0, 90)] }))()")
        C['opts'] = opts
        ok = s['clicked'] and s['key'] == 'SB-HLT-PRD-010' and s['route'] == card['go'] and bool(name) and name in card['t'] and len(opts) >= 1 and '배송비 전 상품 무료' in t and '왕복 6,000원' in t and '판매자 정보' in t and '사업자등록번호 429-88-01533' in t
        return ok, (f"카드 「{card['t'][:60]}」 → {where(s)} · 옵션 {len(opts)}개 · 판매자 정보 · 배송비 무료 · 반품 배송비 왕복 6,000원 · (메인 카드는 「{C['deal'][:30]}」)" if ok else nav_fail(s, f"소개몰 {card['go']}") + f" · 옵션 {len(opts)}")

    @R.step('마지막 옵션(가장 짧은 개월 수)의 「+」를 눌러 수량 2 로 하고 「담기」를 누름 → 안내 「장바구니에 담았습니다」 · 머리줄 장바구니 숫자 2')
    def _():
        i = len(C['opts']) - 1; oid, olab, _ = C['opts'][i]
        row = pg.evaluate("(id) => { let r = document.getElementById(id); for (let k = 0; k < 6 && r; k++) { r = r.parentElement; if (/결제 [\\d,]+원/.test(r.innerText || '')) break; } return (r.innerText || '').replace(/\\s+/g, ' ') }", oid)
        m = re.search(r'결제 ([\d,]+)원', row); C['unit'] = won(m.group(1)) if m else 0; C['optlab'] = norm(olab)[:40]
        s1_ = D.click(M + f'button[data-qp="{i}"]'); q = pg.input_value('#' + oid)
        s = D.click(M + f'button.hlt-btn.sm[data-addcart="{i}"]')
        ok = s1_['clicked'] and q == '2' and s['clicked'] and '장바구니에 담았습니다' in s['toast'] and cartn() == '2' and C['unit'] > 0
        return ok, f"옵션 「{C['optlab']}」 한 개 {C['unit']:,}원 · 수량 {q} · 안내 「{s['toast'].replace('보기', '')[:24]}」(+「보기」 단추) · 머리줄 장바구니 {cartn()}"

    @R.step('머리줄의 장바구니를 누름 → 장바구니 · 그 상품 · 수량 2 · 상품 금액 = 한 개 값 × 2 · 배송비 0원 · 결제 예정 금액 = 상품 금액')
    def _():
        s = D.click('#hltapp header.b2-hd .b2-cart'); t = D.text(); m = re.search(r'상품 금액 ([\d,]+)원 배송비 ([\d,]+)원 결제 예정 금액 ([\d,]+)원', t)
        q = pg.input_value(M + 'input[data-cq="0"]') if D.count(M + 'input[data-cq="0"]') else ''
        C['sum'] = won(m.group(1)) if m else -1
        ok = s['clicked'] and s['key'] == 'SB-HLT-CRT-010' and s['route'] == '#/cart' and C['name'] in t and q == '2' and bool(m) and C['sum'] == C['unit'] * 2 and won(m.group(2)) == 0 and won(m.group(3)) == C['sum'] and '배송비 무료' in t
        return ok, (f"→ {where(s)} · 「{C['name']}」 수량 {q} · 상품 금액 {m.group(1)}원(= {C['unit']:,} × 2) · 배송비 {m.group(2)}원 · 결제 예정 {m.group(3)}원" if ok else nav_fail(s, '소개몰 #/cart') + f" · 금액 {m.groups() if m else None} · 수량 {q}")

    @R.step('「주문하기」를 누름 → 주문서 · 같은 상품 2개 · 배송지 · 결제수단 4가지 · 총 결제 금액이 장바구니와 같음 · 배송비 0원 · 동의 전에는 결제 단추가 꺼져 있음')
    def _():
        s = D.click('#btnToOrder'); t = D.text(); m = re.search(r'상품 금액 ([\d,]+)원 배송비 ([\d,]+)원 할인 ([\d,]+)원 총 결제 금액 ([\d,]+)원', t); pays = D.texts(M + 'button[data-pay]')
        dis = pg.locator('#btnPay').is_disabled() if D.count('#btnPay') else None
        ok = s['clicked'] and s['key'] == 'SB-HLT-ORD-010' and s['route'] == '#/order' and C['name'] in t and '· 2개' in t and bool(m) and won(m.group(4)) == C['sum'] and won(m.group(2)) == 0 and len(pays) == 4 and '배송지' in t and dis is True
        return ok, (f"→ {where(s)} · 「{C['name']}」 · 2개 · 총 결제 금액 {m.group(4)}원(장바구니 {C['sum']:,}원과 같음) · 배송비 {m.group(2)}원 · 결제수단 {pays} · 결제 단추 꺼짐 {dis}" if ok else nav_fail(s, '소개몰 #/order') + f" · 금액 {m.groups() if m else None} · 꺼짐 {dis}")

    @R.step('필수 동의 2개에 체크 → 결제 단추가 켜짐 → 「…원 결제하기」를 누름 → 결제 화면(시연 결제 창) · 주문 1건 · 결제 금액이 같음')
    def _():
        pg.check(M + '#agree1'); pg.check(M + '#agree2'); pg.wait_for_timeout(200); dis = pg.locator('#btnPay').is_disabled(); lab = norm(pg.locator('#btnPay').inner_text())
        s = D.click('#btnPay'); t = D.text(); m = re.search(r'주문 건수 (\d+)건 결제 금액 ([\d,]+)원', t)
        ok = dis is False and f"{C['sum']:,}원" in lab and s['clicked'] and s['key'] == 'SB-HLT-ORD-020' and s['route'] == '#/order/pay' and bool(m) and m.group(1) == '1' and won(m.group(2)) == C['sum'] and D.vis('#payOk')
        return ok, (f"단추 「{lab}」 → {where(s)} · 주문 {m.group(1)}건 · 결제 금액 {m.group(2)}원 · 「결제 성공」 「결제 거절」 「부분 실패」(시연 — 실제 결제는 하지 않음)" if ok else nav_fail(s, '소개몰 #/order/pay') + f" · 단추 「{lab}」 꺼짐 {dis}")

    @R.step('「결제 성공」을 누름 → 완료 화면 「주문이 접수되었습니다」 · 주문번호 · 결제 금액이 같음 · 청약철회 안내 · 머리줄 장바구니가 비워짐(0)')
    def _():
        s = D.click('#payOk', limit=6000); pg.wait_for_timeout(500); s = {**s, **D.st()}; t = D.text(); m = re.search(r'주문번호 (H\d{8}-\d+)', t); p = re.search(r'결제 금액 ([\d,]+)원', t); C['ono'] = m.group(1) if m else ''
        ok = s['clicked'] and s['key'] == 'SB-HLT-ORD-030' and s['route'] == '#/order/done' and bool(m) and bool(p) and won(p.group(1)) == C['sum'] and C['name'] in t and '받으신 날부터 7일 안' in t and cartn() == '0'
        return ok, (f"→ {where(s)} · 주문번호 {C['ono']} · 결제 금액 {p.group(1)}원 · 「받으신 날부터 7일 안 … 청약철회」 · 장바구니 {cartn()}" if ok else nav_fail(s, '소개몰 #/order/done') + f" · 주문번호 {C['ono']} · 장바구니 {cartn()}")

    @R.step('「주문 상세」를 누름 → 주문 상세 · 완료 화면과 같은 주문번호 · 같은 금액 · 배송비 0원 · 진행 상태(결제 → … → 구매확정) · 주문 · 결제 시각')
    def _():
        s = D.click(M + 'button[data-go^="#/my/orders/H"]', exact='주문 상세'); t = D.text(); m = re.search(r'상품 금액 ([\d,]+)원 배송비 ([\d,]+)원 총 결제 금액 ([\d,]+)원', t)
        ok = s['clicked'] and s['key'] == 'SB-HLT-MYO-020' and s['route'] == '#/my/orders/' + C['ono'] and C['ono'] in t and bool(m) and won(m.group(3)) == C['sum'] and won(m.group(2)) == 0 and C['name'] in t and '진행 상태' in t and re.search(r'결제 \d{4}\.\d{2}\.\d{2} \d{2}:\d{2}', t) is not None
        return ok, (f"→ {where(s)} · 주문번호 {C['ono']} 이어짐 · 총 결제 금액 {m.group(3)}원 · 배송비 {m.group(2)}원" if ok else nav_fail(s, f"소개몰 #/my/orders/{C['ono']}"))

    @R.step('위 메뉴 줄의 「내 주문」을 누름 → 내 주문 목록 · 맨 위가 방금 주문(같은 주문번호 · 「결제 완료」 · 같은 금액)')
    def _():
        s = D.click(M + 'nav.hlt-mynav [data-go="#/my/orders"]'); o = pg.evaluate(ORD); C['orders'] = o; top = o[0] if o else {}
        ok = s['clicked'] and s['key'] == 'SB-HLT-MYO-010' and s['route'] == '#/my/orders' and top.get('no') == C['ono'] and top.get('state') == '결제 완료' and top.get('name') == C['name'] and won(top.get('price')) == C['sum']
        return ok, (f"→ {where(s)} · 전체 {len(o)}건 · 맨 위 {top['no']} 「{top['state']}」 {top['name']} {top['price']} · 단추 {top['btns']}" if ok else nav_fail(s, '소개몰 #/my/orders') + f" · 맨 위 {top}")

    @R.step('방금 주문은 아직 보내기 전(결제 완료)이라 「배송조회」 · 「반품신청」 단추가 없음(「주문취소」 「상세보기」만) — 배송 조회 · 반품은 시안에 미리 들어 있는 「배송 완료」 주문으로 이어 감')
    def _():
        o = C['orders']; top = o[0]; dl = next((x for x in o if '배송조회' in x['btns'] and '반품신청' in x['btns']), None); C['dl'] = dl
        ok = top['btns'] == ['주문취소', '상세보기'] and dl is not None and dl['state'] == '배송 완료'
        return ok, f"방금 주문의 단추 {top['btns']} · 배송 완료 견본 주문 {dl and dl['no']} 「{dl and dl['state']}」 {dl and dl['name']} {dl and dl['price']} · 단추 {dl and dl['btns']}"

    @R.step('배송 완료 주문의 「배송조회」를 누름 → 배송 조회 · 그 주문번호 · 택배사 · 송장번호 · 상태 「배송 완료」 · 배송 추적 5단계')
    def _():
        dl = C['dl']; s = D.click(M + f'button[data-go="#/my/orders/{dl["no"]}/track"]'); t = D.text(); m = re.search(r'주문번호 (\S+) 택배사 (\S+) 송장번호 (\S+) 발송 (\S+ \S+) 상태 (배송 완료)', t)
        stg = [w for w in ('집화 처리', '간선 상차', '간선 하차', '배송 출발', '배송 완료') if w in t]
        ok = s['clicked'] and s['key'] == 'SB-HLT-MYO-030' and s['route'] == f'#/my/orders/{dl["no"]}/track' and bool(m) and m.group(1) == dl['no'] and len(stg) == 5
        return ok, (f"→ {where(s)} · 주문번호 {m.group(1)} · {m.group(2)} {m.group(3)} · 발송 {m.group(4)} · 상태 {m.group(5)} · 추적 {len(stg)}단계" if ok else nav_fail(s, '소개몰 …/track'))

    @R.step('메뉴 줄 「내 주문」 → 그 주문의 「반품신청」을 누름 → 반품 신청 · 그 주문번호 · 신청 마감일 · 신청 종류(반품 · 교환) · 사유 · 포장 여부')
    def _():
        dl = C['dl']; s0 = D.click(M + 'nav.hlt-mynav [data-go="#/my/orders"]')
        if s0['key'] != 'SB-HLT-MYO-010': return False, nav_fail(s0, '소개몰 #/my/orders')
        s = D.click(M + f'button[data-go="#/my/returns/new?o={dl["no"]}"]'); t = D.text(); m = re.search(r'신청 마감 (\d{4}\.\d{2}\.\d{2})', t); kinds = D.texts(M + '[data-rkind]')
        ok = s['clicked'] and s['key'] == 'SB-HLT-RTN-010' and (s['route'] or '').endswith('o=' + dl['no']) and dl['no'] in t and bool(m) and kinds == ['반품', '교환'] and D.count('#rReason') == 1 and D.count(M + '[data-ropen]') == 2 and dl['name'] in t
        return ok, (f"→ {where(s)} · 주문 {dl['no']} 「{dl['name']}」 · 신청 마감 {m.group(1)} · 종류 {kinds} · 사유 고르기 · 「포장을 여셨나요?」" if ok else nav_fail(s, '소개몰 #/my/returns/new'))

    @R.step('환불 예상 — 결제 금액 − 반품 배송비(왕복) 6,000원 = 환불 예정액 · 「고객 귀책이라 6,000원이 환불액에서 빠집니다」')
    def _():
        t = D.text(); m = re.search(r'결제 금액 ([\d,]+)원 반품 배송비 \(왕복\) ([\d,]+)원 환불 예정액 ([\d,]+)원', t)
        if not m: return False, f"환불 예상 칸을 읽지 못함 — 「{t[t.find('환불 예상'):][:90]}」"
        pay, fee, ref = won(m.group(1)), won(m.group(2)), won(m.group(3)); C['ref'] = ref
        ok = fee == 6000 and ref == pay - fee and pay == won(C['dl']['price']) and '6,000원이 환불액에서 빠집니다' in t and pg.locator('#rReason').input_value() != ''
        return ok, f"결제 금액 {pay:,}원(주문 목록의 값과 같음) − 반품 배송비(왕복) {fee:,}원 = 환불 예정액 {ref:,}원 · 사유 「{norm(pg.locator('#rReason option:checked').first.inner_text())}」"

    @R.step('포장 「열지 않았습니다」를 고르고 「반품 접수」를 누름 → 「취소 · 반품 내역」 · 접수번호 · 그 주문번호 · 유형 반품 · 고객 부담 6,000원 · 환불 예정액이 같음')
    def _():
        dl = C['dl']; s1_ = D.click(M + '[data-ropen="0"]'); on = pg.locator(M + '[data-ropen="0"]').get_attribute('aria-checked')
        s = D.click('#btnReturn', limit=5000); t = D.text(); m = re.search(r'(R\d{8}-\d+) (\S+) 주문번호 (\S+) 유형 (\S+) 사유 (.+?) 비용 부담 (.+?) 개봉 여부 (.+?) 환불 예정액 ([\d,]+)원', t)
        ok = on == 'true' and s['clicked'] and s['key'] == 'SB-HLT-RTN-020' and s['route'] == '#/my/returns' and bool(m) and m.group(3) == dl['no'] and m.group(4) == '반품' and '6,000원' in m.group(6) and won(m.group(8)) == C['ref'] and '반품이 접수되었습니다' in s['toast']
        C['rstate'] = m.group(2) if m else ''
        return ok, (f"→ {where(s)} · 접수번호 {m.group(1)} · 상태 표시 「{m.group(2)}」 · 주문 {m.group(3)} · {m.group(4)} · {m.group(6)} · {m.group(7)} · 환불 예정액 {m.group(8)}원 · 안내 「{s['toast'][:16]}」" if ok else nav_fail(s, '소개몰 #/my/returns') + f" · 내역 「{t[:120]}」")

    @R.step('메뉴 줄 「내 주문」으로 돌아옴 → 그 주문의 상태가 「반품 접수」로 바뀌고 「배송조회 · 구매확정 · 반품신청」 단추가 없어짐 · 방금 결제한 주문은 그대로', critical=False)
    def _():
        dl = C['dl']; s = D.click(M + 'nav.hlt-mynav [data-go="#/my/orders"]'); o = pg.evaluate(ORD); a = next((x for x in o if x['no'] == dl['no']), {}); mine = next((x for x in o if x['no'] == C['ono']), {})
        ok = s['key'] == 'SB-HLT-MYO-010' and a.get('state') == '반품 접수' and '반품신청' not in a.get('btns', ['반품신청']) and mine.get('state') == '결제 완료'
        return ok, f"{dl['no']} 「{a.get('state')}」 단추 {a.get('btns')} · 방금 주문 {C['ono']} 「{mine.get('state')}」 · 전체 {len(o)}건"

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S6 ═════════════════════════════════════════════
def s6(b):
    R = Run('S6 소개광장 — 목록 → 글 상세 → 글쓰기 → 등록 → 투표', '방문자(로그인하지 않음)'); D = Demo(b); pg = D.pg; C = {}
    ROWS = "[...document.querySelectorAll('#screen table.plz-tbl tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()))"
    POLL = r"""(id) => { const c = document.querySelector('#screen .px-card[data-poll="' + id + '"]'); if (!c) return null; return { voted: c.getAttribute('data-voted'), q: c.querySelector('h2').textContent.trim(), text: c.innerText.replace(/\s+/g, ' ').trim(),
        picked: [...c.querySelectorAll('[data-px=pick]')].filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.textContent.replace(/\s+/g, ' ').trim()) } }"""

    @R.step('시안을 엶 → 머리줄 「소개광장」을 누름 → 소개광장 목록 · 전용 머리줄(켜진 메뉴 「소개광장」) · 글 10줄 · 게시판 탭 6개 · 「글쓰기」')
    def _():
        D.open(); s = D.click('#screen header nav a', exact='소개광장'); rows = pg.evaluate(ROWS); tabs = D.texts('#screen .plz-tabs a'); C['rows'] = rows
        ok = s['clicked'] and s['key'] == 'cmu' and s['hash'] == '#/community' and len(rows) == 10 and tabs == ['전체', '소개 후기', '업종 이야기', '질문', '공지', '이건 어때? 투표'] and 'b2-hd' in s['hcls'] and s['cur'] == '소개광장' and D.vis('#screen .plz-write')
        return ok, (f"→ {where(s)} · 글 {len(rows)}줄 · 탭 {tabs}" if ok else nav_fail(s, 'cmu #/community') + f" · 글 {len(rows)} · 탭 {tabs}")

    @R.step('목록 첫 줄의 제목을 누름 → 그 글의 상세 · 제목 · 게시판 · 작성자 · 날짜 · 조회가 그 줄과 같음')
    def _():
        r = C['rows'][0]; title = re.sub(r'\s*\[\d+\]$', '', r[0]); C['ncm'] = (re.search(r'\[(\d+)\]$', r[0]) or [0, '0'])[1]
        s = D.click('#screen table.plz-tbl tbody tr:nth-child(1) td a'); h1 = norm(pg.locator('#screen .plz-post h1').first.inner_text()) if D.count('#screen .plz-post h1') else ''
        bd = norm(pg.locator('#screen .plz-post .plz-bd').first.inner_text()) if D.count('#screen .plz-post .plz-bd') else ''; meta = norm(pg.locator('#screen .plz-post .plz-meta').first.inner_text()) if D.count('#screen .plz-post .plz-meta') else ''
        ok = s['clicked'] and s['key'] == 'cmud' and re.fullmatch(r'#/community/\d+', s['hash']) is not None and h1 == title and bd == r[1] and all(x in meta for x in (r[2], r[3], r[4]))
        return ok, (f"누른 줄 {r} → {where(s)} · 게시판 「{bd}」 · {meta}" if ok else nav_fail(s, 'cmud #/community/{번호}') + f" · 상세 「{h1}」 {bd} {meta}")

    @R.step('글 아래에 댓글이 보임(목록의 댓글 수와 같음 · 작성자 이름은 가려짐) → 댓글을 적고 「댓글 달기」를 누름 → 안내 「댓글을 달았습니다 — 시연이라 저장하지 않습니다」', critical=False)
    def _():
        n = D.count('#screen .plz-body .plz-cmt'); who = D.texts('#screen .plz-body .plz-cmt b'); h = norm(pg.locator('#screen .plz-body h2').first.inner_text())
        pg.fill('#screen .plz-body textarea', '흐름 점검 댓글입니다'); s = D.click('#screen .plz-body [data-plz=cmt]'); n2 = D.count('#screen .plz-body .plz-cmt')
        ok = n == int(C['ncm']) and n >= 1 and all(re.fullmatch(r'.OO', w) for w in who) and s['clicked'] and '댓글을 달았습니다' in s['toast']
        return ok, f"「{h}」 · 댓글 {n}개(목록 표시 [{C['ncm']}]) · 작성자 {who} · 안내 「{s['toast'][:40]}」 · 누른 뒤 댓글 {n2}개(시연 — 목록에 더해지지 않음)"

    @R.step('「← 목록으로」를 누름 → 소개광장 목록')
    def _():
        s = D.click('#screen .plz-body a.plz-back'); n = len(pg.evaluate(ROWS))
        return s['clicked'] and s['key'] == 'cmu' and s['hash'] == '#/community' and n == 10, (f"→ {where(s)} · 글 {n}줄" if s['key'] == 'cmu' else nav_fail(s, 'cmu'))

    @R.step('「글쓰기」를 누름 → 글쓰기 화면 · 제목 · 내용 칸 · 게시판 고르기 3개 · 「올리기」')
    def _():
        s = D.click('#screen .plz-write'); opts = D.texts('#screen [data-plz=opt]')
        ok = s['clicked'] and s['key'] == 'cmuw' and s['hash'] == '#/community/write' and D.count('#cmuT') == 1 and D.count('#cmuB') == 1 and opts == ['소개 후기', '업종 이야기', '질문'] and D.vis('#screen [data-plz=post]')
        return ok, (f"→ {where(s)} · 게시판 {opts} · 화면 아래 표시 「{norm(pg.locator('#screen .plz-sid').first.inner_text())[:40] if D.count('#screen .plz-sid') else ''}」" if ok else nav_fail(s, 'cmuw #/community/write'))

    @R.step('아무것도 적지 않고 「올리기」를 누름 → 올라가지 않고 「제목을 두 글자 이상 쓰십시오.」', critical=False)
    def _():
        s = D.click('#screen [data-plz=post]')
        return s['clicked'] and s['key'] == 'cmuw' and '제목' in s['toast'], f"화면 그대로 {s['key']} · 안내 「{s['toast'][:40]}」"

    @R.step('제목 · 내용을 적고 게시판 「질문」을 고른 뒤 「올리기」를 누름 → 등록 뒤: 목록으로 돌아오고 안내 「글을 올렸습니다. 첫 글이라 확인 후 다른 분들께 보입니다」')
    def _():
        pg.fill('#cmuT', '흐름 점검 글 — 소개비 세금계산서는 누가 끊나요'); pg.fill('#cmuB', '열 자를 넘기는 본문입니다. 흐름 점검으로 씁니다.')
        s0 = D.click('#screen [data-plz=opt][data-v="질문"]'); on = pg.locator('#screen [data-plz=opt][data-v="질문"]').get_attribute('aria-pressed')
        s = D.click('#screen [data-plz=post]'); rows = pg.evaluate(ROWS); found = any('흐름 점검 글' in r[0] for r in rows)
        ok = on == 'true' and s['clicked'] and s['key'] == 'cmu' and s['hash'] == '#/community' and '글을 올렸습니다' in s['toast'] and '확인 후' in s['toast']
        return ok, (f"→ {where(s)} · 안내 「{s['toast'][:60]}」 · 목록 {len(rows)}줄 · 목록에 방금 글 보임 {found}(시연 — 저장하지 않음)" if ok else nav_fail(s, 'cmu'))

    @R.step('게시판 탭 「이건 어때? 투표」를 누름 → 투표 화면 「이건 어때?」 · 투표 카드(진행 중 · 마감) · 아직 0명 참여')
    def _():
        s = D.click('#screen .plz-tabs a[data-polls-tab]'); cards = pg.evaluate("[...document.querySelectorAll('#screen .px-card')].map(c => [c.getAttribute('data-poll'), c.querySelector('.px-state').textContent.trim(), c.getAttribute('data-voted'), (c.querySelector('.px-total') || {}).textContent || ''])")
        C['cards'] = cards; live = [c for c in cards if c[1] == '진행 중']
        ok = s['clicked'] and s['key'] == 'cmupoll' and s['hash'] == '#/community/polls' and s['title'] == '이건 어때?' and len(live) >= 2 and all(c[2] == '0' and c[3].startswith('0명') for c in live)
        return ok, (f"→ {where(s)} · 카드 {len(cards)}장(진행 중 {len(live)} · 마감 {len(cards) - len(live)}) · 진행 중인 것 모두 0명 참여 · 화면 ID {s['sid']}" if ok else nav_fail(s, 'cmupoll #/community/polls') + f" · 카드 {cards}")

    @R.step('보기를 고르지 않고 「투표하기」를 누름 → 투표되지 않고 고르라는 안내가 뜸', critical=False)
    def _():
        s = D.click('#screen .px-card[data-poll="p2"] [data-px=vote]'); p = pg.evaluate(POLL, 'p2'); msg = norm(pg.locator('#screen .px-card[data-poll="p2"] [data-px-flash], #screen .px-card[data-poll="p2"] .px-msg, #screen .px-card[data-poll="p2"] [role=alert], #screen .px-card[data-poll="p2"] [role=status]').first.inner_text()) if D.count('#screen .px-card[data-poll="p2"] [data-px-flash], #screen .px-card[data-poll="p2"] .px-msg, #screen .px-card[data-poll="p2"] [role=alert], #screen .px-card[data-poll="p2"] [role=status]') else ''
        C['p2q'] = p['q']
        tail = p['text'][-40:]
        return s['clicked'] and s['changed'] and p['voted'] == '0' and ('골라' in p['text'] or '고르' in p['text'] or '선택' in p['text']), f"「{p['q']}」 · 투표 안 됨(voted {p['voted']}) · 카드에 뜬 안내 「{msg or tail}」"

    @R.step('보기 「써 본 사람의 후기」를 누름 → 그 보기가 골라짐 → 「투표하기」를 누름 → 결과: 그 보기 100% · 1표 · 「1명 참여」 · 「투표했습니다」')
    def _():
        s1_ = D.click('#screen .px-card[data-poll="p2"] [data-opt="p2b"]'); p1 = pg.evaluate(POLL, 'p2')
        s = D.click('#screen .px-card[data-poll="p2"] [data-px=vote]'); p = pg.evaluate(POLL, 'p2')
        ok = s1_['clicked'] and len(p1['picked']) == 1 and '써 본 사람의 후기' in p1['picked'][0] and s['clicked'] and p['voted'] == '1' and '써 본 사람의 후기 100% · 1표' in p['text'] and '1명 참여' in p['text'] and '투표했습니다' in p['text'] and s['key'] == 'cmupoll'
        return ok, f"고른 보기 {p1['picked']} → 결과 「{p['text'].split(p['q'])[-1].strip()[:150]}」"

    @R.step('탭 「전체」 → 목록 → 머리줄의 로고를 눌러 메인으로 → 메인의 「이건 어때?」 카드에도 방금 투표 결과(1명 참여)가 그대로', critical=False)
    def _():
        s0 = D.click('#screen .plz-tabs a', exact='전체'); s = D.click('#screen header.b2-hd a.b2-logo')
        cards = D.texts('#screen .home-pl'); mine = next((c for c in cards if C.get('p2q', '') and C['p2q'] in c), '')
        ok = s0['key'] == 'cmu' and s['key'] == 'main1' and '1명 참여' in mine and '투표했습니다' in mine and '100%' in mine
        return ok, f"전체 → {s0['key']} → 로고 → {where(s)} · 메인 카드 「{mine[:120]}」"

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S7 ═════════════════════════════════════════════
def s7(b):
    R = Run('S7 구독 — 요금제 → 결제 → 내 구독 → 해지', '시안의 견본 회원(소개하니 · 스탠다드 이용 중)'); D = Demo(b); pg = D.pg; C = {}
    BOX = '#screen [data-pb-box="my"] '
    acts = lambda: pg.eval_on_selector_all(BOX + '[data-pb]', 'e => e.map(x => x.getAttribute("data-pb"))')
    KO = {'cancel': '자동 갱신 해지', 'refund': '환불 신청', 'resume': '해지 철회', 'recheck': '환불 결과 다시 확인', 'reset': '처음 상태로'}
    ko = lambda a: [KO.get(x, x) for x in a]
    flash = lambda: pg.evaluate("(() => { const f = document.querySelector('#screen [data-pb-flash][data-pb-of=\"my\"]'); return f ? [f.getAttribute('data-pb-flash'), f.textContent.trim()] : null })()")
    refund = lambda: pg.evaluate("(() => { const f = document.querySelector('#screen [data-pb-refund]'); return f ? [f.getAttribute('data-pb-refund'), f.textContent.trim()] : null })()")
    box = lambda: norm(pg.locator(BOX).first.inner_text())

    @R.step('시안을 엶 → 머리줄 「로그인」 → 「로그인」을 누름 → 로그인된 메인 → 머리줄 「나의공간」 → 나의공간')
    def _():
        D.open(); s0 = D.click('#screen header button[data-auth=in]')
        if s0['key'] != 'login': return False, nav_fail(s0, 'login')
        pg.fill('#lg-mail', 'demo@sogae.test'); pg.fill('#lg-pw', 'Demo-pass-1234!'); s1_ = D.click('#screen button[data-auth=submit]')
        if s1_['key'] != 'main2': return False, nav_fail(s1_, 'main2')
        s = D.click('#screen header button[data-go=my]')
        return s['key'] == 'my' and s['hash'] == '#/my', (f"login → main2 → {where(s)}" if s['key'] == 'my' else nav_fail(s, 'my'))

    @R.step('바로가기 「구독 · 소개코드」를 누름 → 요금제 화면 · 요금제 3종(베이직 무료 · 스탠다드 49,000원/월 · 프로 149,000원/월) · 지금 요금제는 스탠다드')
    def _():
        s = D.click('#screen .mgrid .mcard[data-go=mysub]'); plans = D.texts('#screen .plans .plan'); t = D.text()
        ok = s['clicked'] and s['key'] == 'mysub' and s['hash'] == '#/my/subscription' and len(plans) == 3 and plans[0].startswith('베이직 무료') and '49,000원/월' in plans[1] and '149,000원/월' in plans[2] and '현재 요금제' in plans[1] and '스탠다드 · 49,000원/월' in t
        C['plans'] = [p[:26] for p in plans]
        return ok, (f"→ {where(s)} · 요금제 {C['plans']} · 화면 ID {s['sid']}" if ok else nav_fail(s, 'mysub') + f" · {plans}")

    @R.step('「프로」 요금제의 「이 요금제로」를 누름 → 결제 패널(v10.27 G-189 · 10/8 답 ③ — 처음 유료는 지금 결제 · 올리기 · 내리기는 다음 결제일부터 예약)')
    def _():
        s = D.click('#screen [data-ps="pick"][data-plan="PRO"]')
        pn = norm(pg.locator('#screen [data-ps-panel]').inner_text()) if pg.locator('#screen [data-ps-panel]').count() else ''
        return s['clicked'] and bool(pn) and ('구독 시작' in pn or '예약' in pn), (f"결제 패널 「{pn[:80]}」 · 화면 {s['key']}" if s['clicked'] else s['why'])

    # v10.27 (G-189) — 결제 화면이 생겨(결제 패널) 「결제 화면 없음」 건너뜀 줄은 뺐습니다

    @R.step('같은 화면의 「결제 내역」 표 — 정기결제 49,000원 · 초과 소개코드 30,000원이 「완료」로 보임', critical=False)
    def _():
        rows = pg.evaluate("(() => { const h = [...document.querySelectorAll('#screen h2, #screen h3')].find(x => x.textContent.includes('결제 내역')); let n = h ? h.nextElementSibling : null; while (n && !n.querySelector('tbody tr')) n = n.nextElementSibling; return n ? [...n.querySelectorAll('tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()) : [] })()")
        ok = len(rows) >= 3 and any('스탠다드 정기결제 49,000원 완료' in r for r in rows) and any('초과 소개코드 1건 30,000원 완료' in r for r in rows)
        return ok, f"결제 내역 {len(rows)}줄 — {rows[:2]}"

    @R.step('「내 구독」 — 요금제 「스탠다드 월 49,000원」 · 상태 「이용 중」 · 이용 기간 · 자동 갱신 · 다음 청구일 · 「자동 갱신 해지」 「환불 신청」')
    def _():
        t = box(); a = acts(); m = re.search(r'다음 청구 (\d{4}-\d{2}-\d{2})', t); C['next'] = m.group(1) if m else ''
        ok = '스탠다드 월 49,000원' in t and '상태 이용 중' in t and '이용 기간' in t and '자동 갱신 자동 갱신' in t and bool(m) and a == ['cancel', 'refund']
        return ok, f"「{t[:110]}」 · 단추 {ko(a)}"

    @R.step('「자동 갱신 해지」를 누름 → 「해지 예약」 안내 · 다음 청구 「청구 예정 없음」 · 단추가 「해지 철회」로 바뀜')
    def _():
        s = D.click(BOX + '[data-pb=cancel]'); t = box(); f = flash(); a = acts()
        ok = s['clicked'] and s['changed'] and '해지 예약' in t and '청구 예정 없음' in t and f and f[0] == 'ok' and a == ['resume', 'refund']
        return ok, f"안내 「{(f or ['', ''])[1][:60]}」 · 「해지 예약」 {'해지 예약' in t} · 다음 청구 「청구 예정 없음」 {'청구 예정 없음' in t} · 단추 {ko(a)}"

    @R.step('「해지 철회」를 누름 → 다시 자동 갱신 · 다음 청구일이 처음과 같음')
    def _():
        s = D.click(BOX + '[data-pb=resume]'); t = box(); a = acts()
        ok = s['clicked'] and s['changed'] and '해지 예약' not in t and f"다음 청구 {C['next']}" in t and a == ['cancel', 'refund']
        return ok, f"「해지 예약」 사라짐 {'해지 예약' not in t} · 다음 청구 {C['next']} · 단추 {ko(a)}"

    @R.step('환불 사유를 적지 않고 「환불 신청」을 누름 → 신청되지 않고 「환불 사유를 적어 주십시오」', critical=False)
    def _():
        s = D.click(BOX + '[data-pb=refund]'); f = flash()
        return s['clicked'] and s['changed'] and f and f[0] == 'err' and '사유' in f[1] and refund() is None, f"빨간 안내 「{(f or ['', ''])[1]}」 · 환불 상태 표시 {'없음' if refund() is None else refund()[1][:20]}"

    @R.step('사유를 적고(시연용 결제사 응답 「응답 없음」) 「환불 신청」을 누름 → 「환불 결과 확인 중」 · 「환불 완료」라고 하지 않음 · 단추는 「환불 결과 다시 확인」만')
    def _():
        pg.fill(BOX + '[data-pbv=reason]', '흐름 점검 — 잘못 결제'); pg.select_option(BOX + '[data-pbv=pg]', 'lost'); s = D.click(BOX + '[data-pb=refund]'); r = refund(); t = box(); a = acts()
        ok = s['clicked'] and r and r[0] == 'UNKNOWN' and '환불 결과 확인 중' in r[1] and '환불 완료' not in r[1] and a == ['recheck']
        return ok, f"상태 표시 「{(r or ['', ''])[1][:60]}」 · 「이용 · 갱신이 멈춥니다」 안내 {'멈춥니다' in t} · 단추 {ko(a)}"

    @R.step('시연용 결제사 응답을 「정상(취소 확인)」으로 바꾸고 「환불 결과 다시 확인」을 누름 → 「환불 완료」 · 「이용 중인 구독이 없습니다」')
    def _():
        pg.select_option(BOX + '[data-pbv=pg]', 'ok'); s = D.click(BOX + '[data-pb=recheck]'); r = refund(); t = box(); a = acts()
        ok = s['clicked'] and r and r[0] == 'SUCCEEDED' and '환불 완료' in r[1] and '이용 중인 구독이 없습니다' in t and a == ['reset']
        return ok, f"상태 표시 「{(r or ['', ''])[1][:60]}」 · 「이용 중인 구독이 없습니다」 {'이용 중인 구독이 없습니다' in t} · 단추 {ko(a)}"

    @R.step('「처음 상태로」를 누름 → 처음의 「내 구독」(이용 중 · 자동 갱신 해지 · 환불 신청)으로 돌아옴', critical=False)
    def _():
        s = D.click(BOX + '[data-pb=reset]'); t = box(); a = acts()
        return s['clicked'] and a == ['cancel', 'refund'] and refund() is None and '상태 이용 중' in t, f"단추 {ko(a)} · 상태 이용 중 {'상태 이용 중' in t}"

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S8 ═════════════════════════════════════════════
def s8(b):
    R = Run('S8 파트너센터 — 입점 신청 → 리드 → 이용료', '안심소개 파트너(시안의 견본 업체 「(주)한빛이사」)'); D = Demo(b); pg = D.pg; C = {}
    HN = '#screen header '

    @R.step('시안을 엶 → 메인 바닥줄의 「안심소개 파트너센터」를 누름 → 파트너센터 첫 화면 · 요약 4칸 · 머리줄 메뉴(입점 신청 · 내 매물 · 상담 신청 · … · 리드 이용료 · 정산)')
    def _():
        D.open(); s = D.click('#screen footer a[data-go=ptn]'); tiles = D.texts('#screen .tiles .tile .tl') or D.texts('#screen button.tile'); menu = D.texts(HN + '[data-go]')
        C['fee'] = (re.search(r'리드 이용료 잔액 ([\d,]+) 원', D.text()) or re.search(r'이번 달 이용료 ([\d,]+) 원', D.text()) or [0, ''])[1]   # v10.31 (10/10 결정 · 선불 충전) — 첫 화면 칸 「리드 이용료 잔액」
        ok = s['clicked'] and s['key'] == 'ptn' and s['hash'] == '#/partner' and len(tiles) == 4 and all(w in menu for w in ('입점 신청', '상담 신청', '리드 이용료', '정산', '사용자 화면으로'))
        return ok, (f"→ {where(s)} · 요약 {[t[:14] for t in tiles]} · 머리줄 메뉴 {menu[1:]}"[:300] if ok else nav_fail(s, 'ptn #/partner'))

    @R.step('머리줄 「입점 신청」을 누름 → 입점 신청 화면 · 3단계(사업자 확인 · 담당자 · 카테고리 · 약관 동의) · 입점할 축 표 4줄 · 사업자 확인 값')
    def _():
        s = D.click(HN + '[data-go=ptnapply]'); t = D.text(); rows = pg.evaluate("[...document.querySelectorAll('#screen table')].map(tb => tb.querySelectorAll('tbody tr').length)")
        ok = s['clicked'] and s['key'] == 'ptnapply' and s['hash'] == '#/partner/apply' and all(w in t for w in ('STEP 01 · 사업자 확인', 'STEP 02 · 담당자 · 카테고리', 'STEP 03 · 약관 동의', '입점할 축', '(주)한빛이사')) and rows[:1] == [4]
        return ok, (f"→ {where(s)} · 단계 3개 · 표의 줄 수 {rows} · 맨 아래 단추 {D.texts('#screen .wrap button.bp, #screen .wrap button.bo')[-2:]}" if ok else nav_fail(s, 'ptnapply'))

    @R.step('맨 아래 「입점 신청」 단추를 누름 → 안내 「신청은 pending 으로 저장됩니다. 승인은 본사 백오피스에서 합니다.」', critical=False)
    def _():
        s = D.click('#screen .wrap button.bp', exact='입점 신청')
        return s['clicked'] and 'pending' in s['toast'] and s['key'] == 'ptnapply', (f"안내 「{s['toast'][:60]}」 · 화면은 그대로 {s['key']}(접수 완료 화면으로 넘어가지 않음)" if s['clicked'] else s['why'])

    @R.step('머리줄 「상담 신청」을 누름 → 리드(상담 신청) 화면 · 리드 5건 · 등급 · 확인비용 표 8줄')
    def _():
        s = D.click(HN + '[data-go=ptnlead]'); t = D.text(); tabs = D.texts('#screen button.tb[data-x=ptab]'); ids = re.findall(r'L-\d{4}', t); grades = pg.evaluate("[...document.querySelectorAll('#screen table')].map(tb => tb.querySelectorAll('tbody tr').length)")
        m = re.search(r'(L-\d{4}) · .{0,60}?확인비용 ([\d,]+)원 연락처 열기', t); C['lead'] = (m.group(1), won(m.group(2))) if m else None
        ok = s['clicked'] and s['key'] == 'ptnlead' and s['hash'] == '#/partner/leads' and len(tabs) == 4 and tabs[0].startswith('전체 5') and len(set(ids)) >= 5 and 8 in grades and C['lead'] is not None
        return ok, (f"→ {where(s)} · 탭 {tabs} · 리드 {sorted(set(ids), reverse=True)[:5]} · 첫 리드 {C['lead'][0]} 확인비용 {C['lead'][1]:,}원 · 등급표 8줄" if ok else nav_fail(s, 'ptnlead') + f" · 탭 {tabs}")

    @R.step('탭 「확인 전」을 누름 → 확인 전인 리드만 남음(줄마다 「연락처 열기」)')
    def _():
        s = D.click('#screen button.tb[data-x=ptab][data-xv=new]'); n = len(pg.locator('#screen .wrap button', has_text='연락처 열기').all()); t = D.text(); ids = sorted(set(re.findall(r'L-\d{4}', t.split('등급 · 확인비용')[0])), reverse=True)
        ok = s['clicked'] and s['changed'] and n == 2 and len(ids) == 2
        return ok, f"탭 「{s['label']}」 · 남은 리드 {ids} · 「연락처 열기」 {n}개"

    @R.step('첫 리드의 「연락처 열기」를 누름 → 안내 글 「열면 리드 이용료에서 확인비용이 빠집니다 …」', critical=False)
    def _():
        s = D.click('#screen .wrap button', exact='연락처 열기'); n = len(pg.locator('#screen .wrap button', has_text='연락처 열기').all())
        return s['clicked'] and '확인비용이 빠집니다' in s['toast'], (f"안내 「{s['toast'][:54]}」 · 누른 뒤에도 「연락처 열기」 {n}개 그대로(시연 — 연락처가 열리거나 「확인 완료」로 바뀌지는 않음)" if s['clicked'] else s['why'])

    @R.step('머리줄 「리드 이용료」를 누름 → 리드 이용료 화면 · 총 잔액이 첫 화면의 「리드 이용료 잔액」(v10.31 선불 · 전: 이번 달 이용료)과 같음 · 사용 내역에 앞에서 본 리드의 확인비용이 같은 값으로 있음')
    def _():
        s = D.click(HN + '[data-go=ptncash]'); t = D.text(); m = re.search(r'총 잔액 ([\d,]+)원', t); lead = C['lead']
        use = re.search(r'리드 확인 %s -([\d,]+)' % re.escape(lead[0]), t)
        ok = s['clicked'] and s['key'] == 'ptncash' and s['hash'] == '#/partner/cash' and bool(m) and m.group(1) == C['fee'] and bool(use) and won(use.group(1)) == lead[1] and '사용 내역' in t
        return ok, (f"→ {where(s)} · 총 잔액 {m.group(1)}원(첫 화면 {C['fee']}원) · 사용 내역 「리드 확인 {lead[0]} -{use.group(1)}」 = 리드 화면의 확인비용 {lead[1]:,}원" if ok else nav_fail(s, 'ptncash') + f" · 잔액 {m and m.group(1)} / {C['fee']} · 사용 {use and use.group(0)}")

    @R.step('「설정 변경」을 누름 → 안내 글(자동 청구 설정은 아직 연동 전)', critical=False)
    def _():
        s = D.click('#screen .wrap button.bo', exact='설정 변경')
        return s['clicked'] and bool(s['toast']), (f"안내 「{s['toast'][:50]}」 · 화면은 그대로 {s['key']}" if s['clicked'] else s['why'])

    @R.step('머리줄 「정산」을 누름 → 정산 화면 · 정산월 표 · 이번 달 정산 예정 금액 · 수령 계좌', critical=False)
    def _():
        s = D.click(HN + '[data-go=ptnstl]'); t = D.text(); m = re.search(r'(\d{4}-\d{2}) 성사 (\d+)건 ([\d,]+)원 정산 예정', t)
        ok = s['clicked'] and s['key'] == 'ptnstl' and s['hash'] == '#/partner/settlement' and bool(m) and '정산 수령 계좌' in t
        return ok, (f"→ {where(s)} · {m.group(1)} 성사 {m.group(2)}건 {m.group(3)}원 정산 예정 · 정산 수령 계좌 있음" if ok else nav_fail(s, 'ptnstl'))

    @R.step('머리줄 「사용자 화면으로」를 누름 → 사용자 메인으로 돌아옴', critical=False)
    def _():
        s = D.click(HN + '[data-go=main2]')
        return s['clicked'] and s['key'] in ('main1', 'main2') and s['hash'] == '#/', (f"→ {where(s)}" if s['key'] in ('main1', 'main2') else nav_fail(s, 'main'))

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S9 ═════════════════════════════════════════════
def s9(b):
    R = Run('S9 운영 화면 — 검수 큐 → 승인 · 반려 → 정산 · 지급', '운영자(시안의 견본 회원으로 로그인 → 「관리자 페이지」)'); D = Demo(b); pg = D.pg; C = {}
    HN = '#screen header '
    kpi = lambda: pg.evaluate("[...document.querySelectorAll('#screen [data-kpi]')].map(x => x.textContent.trim())")
    flash = lambda: pg.evaluate("(() => { const f = document.querySelector('#screen [data-px-flash]'); return f ? [f.getAttribute('data-px-flash'), f.textContent.trim()] : null })()")
    leads = lambda: pg.evaluate("[...document.querySelectorAll('#screen [data-lead]')].map(x => [x.dataset.lead, x.dataset.state])")
    LK = {'UNMATCHED': '미배정', 'OPEN': '배정 대기', 'ASSIGNED': '배정 완료', 'CLOSED': '종료'}
    lk = lambda l: [f"{a} {LK.get(b, b)}" for a, b in l] or '없음'
    kp = lambda k: ' · '.join(f"{n} {v}" for n, v in zip(('지급 대기', '바로 보낼 수 있음', '확정 전', '미수금'), k))

    @R.step('시안을 엶 → 머리줄 「로그인」 → 「로그인」 → 머리줄 「관리자 페이지」를 누름 → 운영 대시보드 · 요약 5칸 · 운영 머리줄 메뉴')
    def _():
        D.open(); s0 = D.click('#screen header button[data-auth=in]')
        if s0['key'] != 'login': return False, nav_fail(s0, 'login')
        s1_ = D.click('#screen button[data-auth=submit]')
        if s1_['key'] != 'main2': return False, nav_fail(s1_, 'main2')
        s = D.click('#screen header button[data-go=adm]'); tiles = D.texts('#screen button.tile'); menu = D.texts(HN + '[data-go]'); C['tiles'] = tiles
        ok = s['clicked'] and s['key'] == 'adm' and s['hash'] == '#/admin' and len(tiles) == 5 and all(w in menu for w in ('검수', '파트너사', '정산', '사용자 화면으로'))
        return ok, (f"→ {where(s)} · 요약 {[t[:16] for t in tiles]} · 메뉴 {len(menu)}개"[:300] if ok else nav_fail(s, 'adm #/admin'))

    @R.step('요약 칸 「검수 대기」를 누름 → 검수 큐(리스팅 검수) · 탭(대기 · SLA 임박 · 반려) · 대기 줄마다 「열기」 「승인」')
    def _():
        s = D.click('#screen button.tile[data-go=admrev]'); tabs = D.texts('#screen button.tb[data-x=arev]'); n = D.count('#screen .wrap button[data-go=admrevd]'); t = D.text(); C['wait'] = tabs[0] if tabs else ''
        m = re.search(r'(V-\d+) · (.+?) · 접수', t); C['v'] = m.group(1) if m else ''
        q = pg.evaluate("(() => { const r = document.querySelector('#screen .wrap .qrow'); if (!r) return null; const b = r.querySelector('.qt > b'); return { row: r.innerText.replace(/\\s+/g, ' ').trim(), title: b ? b.textContent.trim() : '' } })()") or {'row': '', 'title': ''}
        row = q['row']; C['row'] = row; C['rtitle'] = q['title']
        ok = s['clicked'] and s['key'] == 'admrev' and s['hash'] == '#/admin/review' and len(tabs) == 3 and n >= 1 and bool(m)
        return ok, (f"→ {where(s)} · 탭 {tabs} · 화면에 보이는 대기 줄 {n}건 · 첫 줄 「{row[:70]}」" if ok else nav_fail(s, 'admrev'))

    @R.step('첫 줄의 「열기」를 누름 → 검수 상세 · 그 줄의 접수 번호 · 제목이 같음 · 자동 검사 4가지 · 반려 사유 6가지 · 사유를 고르기 전에는 「반려」가 꺼져 있음')
    def _():
        s = D.click('#screen .wrap button[data-go=admrevd]'); t = D.text(); n = D.count('#screen input[name=rej]')
        dis = pg.locator('#screen .wrap button', has_text='반려').last.is_disabled() if D.count('#screen .wrap button') else None
        ok = s['clicked'] and s['key'] == 'admrevd' and s['hash'] == '#/admin/review/' + C['v'].split('-')[1] and C['v'] in s['title'] and bool(C['rtitle']) and C['rtitle'] in t and n == 6 and all(w in t for w in ('제한업종 검사', '금칙 표현 검사', '중복 검사', '연락처 검증')) and dis is True
        return ok, (f"→ {where(s)} · 큐의 줄 제목 「{C['rtitle']}」이 상세에 그대로 · 자동 검사 4 · 반려 사유 {n}개 · 「반려」 꺼짐 {dis} · 화면 ID {s['sid']}" if ok else nav_fail(s, f"admrevd #/admin/review/{C['v'].split('-')[-1]}") + f" · 제목 「{C['rtitle']}」 있음 {C['rtitle'] in t} · 사유 {n} · 꺼짐 {dis}")

    @R.step('반려 사유 「R02 · 정보 불충분」을 고름 → 「반려」가 켜짐 → 「반려」를 누름 → 안내 「반려하면 사유 코드와 수정 가이드가 등록자에게 함께 갑니다.」')
    def _():
        s0 = D.click('#screen input[name=rej][data-xv=R02]'); rej = pg.locator('#screen .wrap button', has_text='반려').last; dis = rej.is_disabled()
        s = D.click('#screen .wrap button.bo', exact='반려')
        ok = s0['clicked'] and dis is False and s['clicked'] and '사유 코드' in s['toast'] and s['key'] == 'admrevd'
        return ok, f"사유를 고르자 「반려」 꺼짐 {dis} · 누름 → 안내 「{s['toast'][:50]}」 · 화면은 그대로 {s['key']}(시연 — 큐에서 빠지지 않음)"

    @R.step('「승인」을 누름 → 안내 「승인 → LIVE. 즉시 노출되고 감사 로그에 처리자와 시각이 남습니다.」')
    def _():
        s = D.click('#screen .wrap button.bp', exact='승인')
        return s['clicked'] and '승인 → LIVE' in s['toast'], (f"안내 「{s['toast'][:54]}」 · 화면은 그대로 {s['key']}" if s['clicked'] else s['why'])

    @R.step('머리줄 「검수」를 눌러 큐로 돌아옴(상세 화면에는 「목록으로」 단추가 없음) → 대기 건수는 처음과 같음(시연 — 승인 · 반려가 큐에 반영되지 않음)', critical=False)
    def _():
        back = D.count('#screen .wrap [data-back], #screen .wrap .bkl'); s = D.click(HN + '[data-go=admrev]'); tabs = D.texts('#screen button.tb[data-x=arev]')
        ok = s['clicked'] and s['key'] == 'admrev' and tabs and tabs[0] == C['wait']
        return ok, f"상세 화면의 돌아가기 단추 {back}개 · 머리줄 「검수」 → {where(s)} · 탭 {tabs}(처음 「{C['wait']}」)"

    @R.step('머리줄 「정산」을 누름 → 정산 승인 · 승인 대기 5건 · 소개비 합계 · 갈래 「정산 승인 | 지급 데스크」')
    def _():
        s = D.click(HN + '[data-go=admstl]'); t = D.text(); m = re.search(r'(\d+)건 · 소개비 합계 ([\d,]+)원', t); sub = D.texts('#screen [data-pay-tab] button'); n = len(pg.locator('#screen .wrap button.bp', has_text='승인').all())
        dash = next((x for x in C.get('tiles', []) if x.startswith('정산 승인 대기')), '')
        ok = s['clicked'] and s['key'] == 'admstl' and s['hash'] == '#/admin/settlement' and bool(m) and m.group(1) == '5' and sub == ['정산 승인', '지급 데스크'] and n >= 1
        return ok, (f"→ {where(s)} · {m.group(1)}건 · 소개비 합계 {m.group(2)}원 · 「승인」 단추 {n}개 · 갈래 {sub} · (대시보드 칸은 「{dash}」)" if ok else nav_fail(s, 'admstl'))

    @R.step('첫 줄의 「승인」을 누름 → 안내 「승인하면 지급 실행 대기로 넘어갑니다.」', critical=False)
    def _():
        s = D.click('#screen .wrap button.bp', exact='승인')
        return s['clicked'] and '지급 실행 대기' in s['toast'], (f"안내 「{s['toast'][:44]}」 · 화면은 그대로 {s['key']}(시연 — 줄이 빠지지 않음)" if s['clicked'] else s['why'])

    @R.step('갈래 「지급 데스크」를 누름 → 지급 데스크 · 지급 대기 2 · 바로 보낼 수 있음 1 · 확정 전 2 · 미수금 2 · 운영으로 볼 때는 「확정」 단추')
    def _():
        s = D.click('#screen [data-pay-tab] [data-go=admpay]'); k = kpi(); n = D.count('#screen [data-px=payconfirm]')
        ok = s['clicked'] and s['key'] == 'admpay' and k == ['2', '1', '2', '2'] and n == 2 and D.count('#screen [data-px=paypay]') == 0
        return ok, (f"→ {where(s)} · {kp(k)} · 「확정」 {n}개 · 지급 입력 칸 0(지급은 지급 담당) · 화면 ID {s['sid']}" if ok else nav_fail(s, 'admpay') + f" · {kp(k)}")

    @R.step('확정 전 첫 건의 「확정」을 누름 → 지급 대기 3 · 확정 전 1 · 안내 「확정했습니다」')
    def _():
        s = D.click('#screen [data-pay-draft=d1] [data-px=payconfirm]'); k = kpi(); f = flash()
        ok = s['clicked'] and k[:3] == ['3', '2', '1'] and f and f[0] == 'ok' and '확정했습니다' in f[1]
        return ok, f"{kp(k)} · 안내 「{(f or ['', ''])[1][:70]}」"

    @R.step('보는 사람을 「지급 담당」으로 바꿈 → 이체 참조를 적지 않고 「지급 기록」 → 거절 → 이체 참조를 적고 「지급 기록」 → 지급 대기가 하나 줄고 「최근 지급」 맨 위에 그 기록')
    def _():
        s0 = D.click('#screen [data-px=payrole][data-id=PAYOUT]'); n = D.count('#screen [data-px=paypay]')
        s1_ = D.click('#screen [data-pay-queue=q1] [data-px=paypay]'); f1 = flash()
        pg.fill('#px-ref_q1', 'KB-FLOW-0001'); s = D.click('#screen [data-pay-queue=q1] [data-px=paypay]'); k = kpi(); f = flash()
        paid = norm(pg.locator('#screen [data-pay-paid] tbody tr').first.inner_text()) if D.count('#screen [data-pay-paid] tbody tr') else ''
        ok = s0['clicked'] and n == 3 and f1 and f1[0] == 'err' and '이체 참조' in f1[1] and s['clicked'] and k[0] == '2' and 'KB-FLOW-0001' in paid and '소개하니' in paid and f and f[0] == 'ok'
        return ok, f"「지급 기록」 {n}개 · 참조 없이 → 「{(f1 or ['', ''])[1]}」 · 참조를 적고 → 지급 대기 {k[0]} · 최근 지급 맨 위 「{paid[:70]}」"

    @R.step('머리줄 「파트너사」 → 갈래 「리드 배정」을 누름 → 리드 배정 · 「손이 필요한 것」 2건(미배정 · 배정 대기)')
    def _():
        s0 = D.click(HN + '[data-go=admptn]')
        if s0['key'] != 'admptn': return False, nav_fail(s0, 'admptn')
        s = D.click('#screen .tabs2 [data-go=admlasg]'); l = leads()
        ok = s['clicked'] and s['key'] == 'admlasg' and l == [['L-1042', 'UNMATCHED'], ['L-1041', 'OPEN']]
        return ok, (f"파트너사 → {where(s)} · 손이 필요한 것 {lk(l)} · 화면 ID {s['sid']}" if ok else nav_fail(s, 'admlasg') + f" · {lk(l)}")

    @R.step('미배정 건의 「후보 · 배정」을 누름 → 후보 3곳(보낼 수 있음 2 · 탈락 1) → 한 곳을 고르고 「고른 업체에 보내기」 → 배정 완료 · 「손이 필요한 것」에서 빠짐')
    def _():
        s0 = D.click('#screen [data-lead=L-1042] [data-px=leadopen]')
        cands = pg.evaluate("[...document.querySelectorAll('[data-lead=\"L-1042\"] [data-candidate]')].map(r => [r.children[1] ? r.children[1].textContent.trim() : r.dataset.candidate, !!r.querySelector('input'), r.lastElementChild.textContent.trim()])")
        s1_ = D.click('[data-candidate=c3] input'); lab = norm(pg.locator('[data-lead=L-1042] [data-px=leadsend]').first.inner_text())
        s = D.click('[data-lead=L-1042] [data-px=leadsend]'); f = flash(); l = leads()
        ok = s0['clicked'] and len(cands) == 3 and sum(1 for c in cands if c[1]) == 2 and '보내기 1' in lab and s['clicked'] and f and f[0] == 'ok' and l == [['L-1041', 'OPEN']]
        return ok, f"후보 {[c[0] + '(' + c[2] + ')' for c in cands]} · 「새집이사」를 고름 · 단추 「{lab}」 → 안내 「{(f or ['', ''])[1][:50]}」 · 남은 것 {lk(l)}"

    @R.step('「지금 배정 돌리기」를 누름 → 남은 배정 대기 1건이 순번대로 배정되고 「손이 필요한 것」이 비워짐', critical=False)
    def _():
        s = D.click('#screen [data-px=leadrun]'); f = flash(); l = leads()
        return s['clicked'] and f and f[0] == 'ok' and '1건 배정' in f[1] and l == [], f"안내 「{(f or ['', ''])[1][:60]}」 · 남은 것 {lk(l)}"

    @R.step('머리줄 「사용자 화면으로」를 누름 → 사용자 메인으로 돌아옴', critical=False)
    def _():
        s = D.click(HN + '[data-go=main2]')
        return s['clicked'] and s['key'] == 'main2' and s['hash'] == '#/', (f"→ {where(s)}" if s['key'] == 'main2' else nav_fail(s, 'main2'))

    R.errors(D); D.close()


# ═════════════════════════════════════════════ S10 ═════════════════════════════════════════════
def s10(b):
    R = Run('S10 머리줄 · 바닥줄로 관 사이 이동', '방문자(로그인하지 않음)'); D = Demo(b); pg = D.pg; C = {}
    HS = '#screen header nav a'; HM = '#hltapp header.b2-hd nav a'

    def to_mall(sel=HS):
        s = D.click(sel, exact='소개몰', limit=5000); pg.wait_for_timeout(500); return {**s, **D.st()}

    @R.step('시안을 엶 → 메인 · 머리줄 메뉴 6개(소개장터 · 안심소개 · 소개창업 · 소개몰 · 소개광장 · 이용안내) · 바닥줄에 약관 · 고객센터 링크')
    def _():
        s = D.open(); nav = D.texts(HS); ft = D.texts('#screen footer.home-ft a[data-go]')
        ok = s['key'] == 'main1' and nav == MENU6 and all(w in ft for w in ('이용약관', '개인정보처리방침', '운영정책', '고객센터'))
        return ok, f"{where(s)} · 머리줄 {nav} · 바닥줄 {ft}"[:300]

    for name, key, hsh in (('소개장터', 'list', '#/g/mny'), ('안심소개', 'listl', '#/g/mal'), ('소개창업', 'listb', '#/g/biz')):
        @R.step(f'머리줄 「{name}」{josa(name, "을", "를")} 누름 → {name} 화면 · 머리줄의 「{name}」{josa(name, "이", "가")} 켜짐 · 메뉴 6개는 그대로')
        def _(name=name, key=key, hsh=hsh):
            s = D.click(HS, exact=name); nav = D.texts(HS)
            ok = s['clicked'] and s['key'] == key and s['hash'] == hsh and s['cur'] == name and nav == MENU6 and not s['nf']
            return ok, (f"→ {where(s)} · 켜진 메뉴 「{s['cur']}」 · 창 제목 「{s['docTitle'][:16]}」" if ok else nav_fail(s, f'{key} {hsh}') + f" · 켜진 메뉴 「{s['cur']}」")

    @R.step('머리줄 「소개몰」을 누름 → 소개몰이 겹쳐 뜸 · 전용 머리줄 · 켜진 메뉴 「소개몰」 · 메뉴 6개는 그대로')
    def _():
        s = to_mall(); nav = D.texts(HM)
        ok = s['open'] and s['key'] == 'SB-HLT-HUB-010' and s['hash'] == '#/health' and s['cur'] == '소개몰' and nav == MENU6
        return ok, (f"→ {where(s)} · 주소 {s['hash']} · 머리줄 {s['hcls']} · 켜진 메뉴 「{s['cur']}」" if ok else nav_fail(s, '소개몰') + f" · 메뉴 {nav}")

    @R.step('소개몰의 전용 머리줄에서 「소개광장」을 누름 → 소개몰이 닫히고 소개광장 · 전용 머리줄 · 켜진 메뉴 「소개광장」')
    def _():
        s = D.click(HM, exact='소개광장', limit=5000); nav = D.texts(HS)
        ok = s['clicked'] and not s['open'] and s['key'] == 'cmu' and s['hash'] == '#/community' and s['cur'] == '소개광장' and 'b2-hd' in s['hcls'] and nav == MENU6
        return ok, (f"→ {where(s)} · 소개몰 닫힘 · 머리줄 {s['hcls']} · 켜진 메뉴 「{s['cur']}」" if ok else nav_fail(s, 'cmu #/community'))

    @R.step('소개광장의 전용 머리줄에서 로고를 누름 → 메인으로(한 바퀴: 메인 → 소개장터 → 안심소개 → 소개창업 → 소개몰 → 소개광장 → 메인)')
    def _():
        s = D.click('#screen header.b2-hd a.b2-logo')
        return s['clicked'] and s['key'] == 'main1' and s['hash'] == '#/', (f"→ {where(s)} · 창 제목 「{s['docTitle'][:30]}」" if s['key'] == 'main1' else nav_fail(s, 'main1 #/'))

    @R.step('소개몰의 전용 머리줄에서 다른 관으로 나가기 — 「소개장터」 · 「안심소개」 · 「소개창업」 · 「이용안내」를 하나씩(매번 메인에서 소개몰로 들어간 뒤) 누름 → 모두 소개몰이 닫히고 그 화면으로')
    def _():
        out = []; bad = []
        for name, key in (('소개장터', 'list'), ('안심소개', 'listl'), ('소개창업', 'listb'), ('이용안내', 'guide')):
            m = to_mall(HS)
            if not m['open']: bad.append(f'소개몰로 들어가지 못함({name} 앞)'); break
            s = D.click(HM, exact=name, limit=5000); out.append(f"{name}→{s['key']}")
            if s['open'] or s['key'] != key or s['nf']: bad.append(f"{name}: {where(s)} 소개몰 열림 {s['open']}")
        return not bad and len(out) == 4, (bad or f"소개몰에서 {out} · 매번 소개몰이 닫힘")

    @R.step('소개광장의 전용 머리줄에서 다른 관으로 나가기 — 「소개장터」 · 「안심소개」 · 「소개창업」 · 「소개몰」 · 「이용안내」를 하나씩(매번 머리줄 「소개광장」으로 돌아간 뒤) 누름 → 모두 그 화면으로')
    def _():
        out = []; bad = []
        for name, key in (('소개장터', 'list'), ('안심소개', 'listl'), ('소개창업', 'listb'), ('소개몰', 'SB-HLT-HUB-010'), ('이용안내', 'guide')):
            c = D.click(HM if D.st()['open'] else HS, exact='소개광장', limit=5000)
            if c['key'] != 'cmu': bad.append(f"소개광장으로 돌아가지 못함({name} 앞): {where(c)}"); break
            s = to_mall('#screen header.b2-hd nav a') if name == '소개몰' else D.click('#screen header.b2-hd nav a', exact=name)
            out.append(f"{name}→{s['key']}")
            if s['key'] != key or s['nf']: bad.append(f"{name}: {where(s)}")
        return not bad and len(out) == 5, (bad or f"소개광장에서 {out}")

    @R.step('머리줄 로고(또는 「메인으로」)를 눌러 메인으로 → 바닥줄 「이용약관」을 누름 → 이용안내 화면 · 「약관 · 정책」 표(이용약관 · 개인정보처리방침 … 11줄 — v10.31 파트너 이용약관 발행 · D090)')
    def _():
        st0 = D.st()
        s0 = D.click('#hltapp header.b2-hd a.b2-logo' if st0['open'] else '#screen header a.b2-logo, #screen header a.lg, #screen header a.home-logo', limit=5000)
        if s0['key'] != 'main1': return False, nav_fail(s0, 'main1')
        s = D.click('#screen footer.home-ft a[data-go=guide]', exact='이용약관'); t = D.text()
        docs = pg.evaluate("(() => { const h = [...document.querySelectorAll('#screen h2, #screen h3')].find(x => x.textContent.includes('약관')); let n = h ? h.nextElementSibling : null; return n ? [...n.querySelectorAll('tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()) : [] })()")
        C['docs'] = docs; C['links'] = pg.evaluate("(() => { const h = [...document.querySelectorAll('#screen h2, #screen h3')].find(x => x.textContent.includes('약관')); let n = h ? h.nextElementSibling : null; return n ? n.querySelectorAll('a, button, [data-go], [data-t], [onclick]').length : -1 })()")
        ok = s['clicked'] and s['key'] == 'guide' and s['hash'] == '#/guide' and s['title'] == '이용안내' and len(docs) == 11 and any(d.startswith('파트너 이용약관') for d in docs) and docs[0].startswith('이용약관') and docs[1].startswith('개인정보처리방침')
        return ok, (f"메인 → 「{s['label']}」 → {where(s)} · 약관 · 정책 표 {len(docs)}줄(「{docs[0]}」 · 「{docs[1]}」 …)" if ok else nav_fail(s, 'guide #/guide') + f" · 표 {len(docs)}줄")

    # v10.31 — 전에는 「시안에 이 화면이 없음」으로 건너뛰었으나 시안은 v10.27(G-199)부터 표의 문서 이름이 링크(data-go=termsv · 전문 화면)입니다 → 실제로 눌러 봄
    @R.step('이용안내의 「약관 · 정책」 표에서 「이용약관」 이름을 누름 → 약관 전문 화면(termsv · 조항이 보임) → 「← 돌아가기」로 이용안내')
    def _():
        s = D.click('#screen a.lnk[data-go=termsv]', exact='이용약관'); t = D.text()
        ok1 = s['clicked'] and s['key'] == 'termsv' and not s['nf'] and '이용약관' in t and '제1조' in t
        b = D.click('#screen .bkl')
        ok = ok1 and b['key'] == 'guide'
        return ok, (f"「{s['label']}」 → {where(s)} · 조항 「제1조」 {'있음' if '제1조' in t else '없음'} → 돌아가기 → {where(b)}" if ok1 else nav_fail(s, 'termsv') + f" · 글 「{t[:60]}」")

    @R.step('「← 메인(으)로 돌아가기」 → 메인 → 바닥줄 「개인정보처리방침」 → 이용안내 → 돌아가기 → 바닥줄 「고객센터」 → 고객센터 화면(자주 묻는 질문 · 문의하기)')
    def _():
        s0 = D.click('#screen button.bkl[data-back]')
        if s0['key'] != 'main1': return False, nav_fail(s0, 'main1')
        s1_ = D.click('#screen footer.home-ft a[data-go=guide]', exact='개인정보처리방침')
        if s1_['key'] != 'guide': return False, nav_fail(s1_, 'guide')
        s2_ = D.click('#screen button.bkl[data-back]')
        s = D.click('#screen footer.home-ft a[data-go=cs]', exact='고객센터'); t = D.text()
        ok = s2_['key'] == 'main1' and s['clicked'] and s['key'] == 'cs' and s['hash'] == '#/support' and s['title'] == '고객센터' and '자주 묻는 질문' in t and '문의하기' in t and D.vis('#screen button[data-go=csdone]')
        return ok, (f"개인정보처리방침 → {s1_['key']} → 돌아가기 → {s2_['key']} → 고객센터 → {where(s)} · 자주 묻는 질문 · 문의하기 · 「문의 접수하기」" if ok else nav_fail(s, 'cs #/support'))

    @R.step('관 화면(소개장터)의 바닥줄에서도 「이용약관」 → 이용안내 · 「고객센터」 → 고객센터', critical=False)
    def _():
        out = []
        for lab, key in (('이용약관', 'guide'), ('고객센터', 'cs')):
            c = D.click(HS, exact='소개장터')
            if c['key'] != 'list': return False, nav_fail(c, 'list')
            s = D.click('#screen footer.b2-ft a[data-go=%s]' % key, exact=lab); out.append((lab, s['key'], s['key'] == key))      # v10.30 — 소개장터 메인은 두 관 전용 바닥줄
        return all(o[2] for o in out), f"소개장터 바닥줄 {[(o[0], o[1]) for o in out]}"

    @R.step('소개몰의 바닥줄에서 「이용약관」 → 소개몰이 닫히고 이용안내 · 「고객센터」 → 고객센터 / 소개광장의 바닥줄에서도 같음', critical=False)
    def _():
        out = []; bad = []
        for lab, key in (('이용약관', 'guide'), ('고객센터', 'cs')):
            c = D.click(HS, exact='소개몰', limit=5000); pg.wait_for_timeout(500)
            if not D.st()['open']: return False, f'소개몰로 들어가지 못함: {where(D.st())}'
            s = D.click('#hltapp footer.b2-ft a[data-go=%s]' % key, exact=lab, limit=5000); out.append(f"소개몰 {lab}→{s['key']}")
            if s['open'] or s['key'] != key: bad.append(f"소개몰 {lab}: {where(s)} 열림 {s['open']}")
        for lab, key in (('이용약관', 'guide'), ('고객센터', 'cs')):
            c = D.click(HS, exact='소개광장')
            if c['key'] != 'cmu': return False, nav_fail(c, 'cmu')
            s = D.click('#screen footer.b2-ft a[data-go=%s]' % key, exact=lab); out.append(f"소개광장 {lab}→{s['key']}")
            if s['key'] != key: bad.append(f"소개광장 {lab}: {where(s)}")
        return not bad, (bad or f"{out}")

    @R.step('소개몰 바닥의 「이용안내 · 청약철회」를 누름 → 소개몰 이용안내(청약철회 · 판매자 정보 · 판매 약관 전문 제1조 ~ 제9조)', critical=False)
    def _():
        m = to_mall(HS)
        if not m['open']: return False, f'소개몰로 들어가지 못함: {where(m)}'
        s = D.click('#hltapp footer.hlt-ft a[data-go="#/guide"]', limit=5000); t = D.text()
        ok = s['clicked'] and s['open'] and s['key'] == 'SB-HLT-ETC-010' and s['route'] == '#/guide' and all(w in t for w in ('청약철회', '판매자 정보', '제1조 (판매자)', '제9조 (분쟁)'))
        return ok, (f"→ {where(s)} · 청약철회 · 판매자 정보 · 판매 약관 제1조 ~ 제9조가 화면에 있음" if ok else nav_fail(s, '소개몰 #/guide'))

    @R.step('같은 바닥의 「제3자 제공 동의」 · 「유료서비스 약관」을 누름 → 약관 전문 화면(그 약관 · v10.27 G-199)', critical=False)
    def _():
        out = []
        for lab, want in (('제3자 제공 동의', '제3자 제공 동의'), ('유료서비스 약관', '구독 환불 정책')):
            pg.goto('file://' + FILE + '#/health'); pg.wait_for_timeout(1500)
            a = pg.locator('#hltapp footer a[data-termsv]', has_text=lab)
            if not a.count(): out.append((lab, '단추 없음', '')); continue
            a.first.click(); pg.wait_for_timeout(900)
            scr = pg.evaluate("__VIEW.state.screen"); b = pg.locator('#screen [data-terms-body] b')
            out.append((lab, scr, b.first.inner_text() if b.count() else ''))
        return all(o[1] == 'termsv' and o[2] == w for o, (_, w) in zip(out, (('', '제3자 제공 동의'), ('', '구독 환불 정책')))), f"{out}"

    R.errors(D); D.close()


FLOWSET = [('S1', s1), ('S2', s2), ('S3', s3), ('S4', s4), ('S5', s5), ('S6', s6), ('S7', s7), ('S8', s8), ('S9', s9), ('S10', s10)]

if __name__ == '__main__':
    if not os.path.exists(FILE):
        Flow('시안 파일 열기', '').step(f'시안 파일이 있음 — {FILE}', HOW, False, f'파일을 찾지 못함(sgb/VERSION = {VER})'); finish('proto'); sys.exit(1)
    print(f'시안 {FILE} ({os.path.getsize(FILE) // 1024:,} KB · {VER})', file=sys.stderr)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, fn in FLOWSET:
            if ONLY and name not in ONLY: continue
            try: fn(b)
            except Exception as ex:
                import traceback; traceback.print_exc()
                FLOWS[-1]['steps'].append({'no': len(FLOWS[-1]['steps']) + 1, 'step': '실행 중 오류로 이 흐름을 끝까지 돌리지 못함(시험 쪽)', 'how': HOW, 'ok': False, 'detail': repr(ex)[:300]})
        b.close()
    finish('proto' if not ONLY else 'proto_part')
