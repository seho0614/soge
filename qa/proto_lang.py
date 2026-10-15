"""시안 v10.22 — 머리줄 언어 단추와 로그인 화면의 스타일 이름 겹침(G-138) 점검. 파일(file://)로 열어 잽니다. 결과: proto_lang.json

  원인 — 언어 단추와 로그인 화면이 같은 이름(.lgb · .lgc)을 써서 서로의 스타일을 받았습니다.
         언어 단추의 「▾」가 로그인 상자 스타일(안쪽 여백 30px · 테두리)을 받아 63×73 상자가 되고(단추 87px),
         로그인 화면은 언어 단추 스타일을 받아 제목이 회색 · 단추가 32px 로 납작해졌습니다.

  A. 언어 단추   모든 화면에서 단추가 머리줄 안 · 「▾」는 글자 크기 · 눌러서 목록이 열리고 언어가 바뀜
  B. 로그인 화면  상자 글자색 · 「로그인」 「사업자로 회원가입」 「성향 분석」 단추의 높이와 가운데 정렬
  C. 이름 겹침   언어 단추가 로그인 화면의 이름을 쓰지 않음(소스)
  D. 그 밖       390px · 그리는 중 오류 0

사용:  python3 proto_lang.py       PROTO=/path/proto.html (기본 킷의 spec/proto.html)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
# 머리줄 언어 단추 — 단추 · 「▾」 · 머리줄(단추를 감싼 줄)의 자리
LANG = """()=>{const l=document.querySelector('#screen .lang'); if(!l || l.offsetParent===null) return null;
  const b=l.querySelector('button'), c=b && b.lastElementChild, bar=l.closest('.hdin') || l.closest('.b2-in') || l.parentElement;
  const r=e=>{const x=e.getBoundingClientRect(); return {w:Math.round(x.width), h:Math.round(x.height), top:Math.round(x.top), bottom:Math.round(x.bottom)}};
  const cs=c?getComputedStyle(c):{};
  return {btn:r(b), caret:c?r(c):null, bar:r(bar), caretPad:cs.paddingTop, caretBorder:cs.borderTopWidth, btnClass:b.className, caretClass:c?c.className:''}}"""
LOGIN = """()=>{const g=(sel)=>{const e=document.querySelector(sel); if(!e) return null; const r=e.getBoundingClientRect(), c=getComputedStyle(e);
    return {w:Math.round(r.width), h:Math.round(r.height), pad:c.paddingTop, fs:c.fontSize, color:c.color, disp:c.display, ta:c.textAlign, jc:c.justifyContent}};
  const b=[...document.querySelectorAll('#screen .lgw button.jb')].map(e=>{const r=e.getBoundingClientRect(), c=getComputedStyle(e), t=document.createRange(); t.selectNodeContents(e); const tr=t.getBoundingClientRect();
    return {t:(e.innerText||'').trim(), h:Math.round(r.height), pad:c.paddingTop, mid:Math.abs((tr.left+tr.right)/2-(r.left+r.right)/2)<3}});
  return {card:g('#screen .lgw > div'), h2:g('#screen .lgw h2'), btns:b}}"""


def main():
    src = open(FILE, encoding='utf-8').read()
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.goto('file://' + FILE); pg.wait_for_timeout(1500)
        keys = pg.evaluate("Object.keys(__VIEW.screens)")

        # A. 언어 단추 — 모든 화면
        seen = 0; bad = []; b2 = 0
        for k in keys:
            try:
                pg.evaluate("location.hash=''"); pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(40); pg.evaluate(CLEAN)
                m = pg.evaluate(LANG)
            except Exception as ex:
                bad.append((k, 'err ' + repr(ex)[:60])); continue
            if not m: continue
            seen += 1
            # v10.23 — 소개광장 화면의 머리줄(두 관 전용 · 75px)은 제시 디자인의 알약 단추(46px)입니다. 그 밖의 화면은 40px 이하 그대로
            # v10.30 — 소개장터 메인(list)도 두 관 전용 머리줄이고, 그 디자인(2026-10-09)의 알약 단추는 49px 입니다
            lim = (49 if k == 'list' else 46) if 'b2-lngb' in m['btnClass'] else 40
            if 'b2-lngb' in m['btnClass']: b2 += 1
            if m['btn']['h'] > lim or m['btn']['bottom'] > m['bar']['bottom'] + 1 or m['btn']['top'] < m['bar']['top'] - 1: bad.append((k, m['btn'], m['bar']))
        rec(f'A-1 언어 단추가 있는 화면 {seen}장 모두 — 머리줄 안 · 단추 높이 40px 이하(두 관 전용 머리줄 {b2}장은 제시 디자인의 알약 단추 — 소개광장 5장 46px · 소개장터 메인 1장 49px 이하)', seen >= 80 and not bad and b2 == 6, (seen, b2, bad[:4]))
        pg.goto('file://' + FILE + '#/g/mal'); pg.wait_for_timeout(700); pg.evaluate(CLEAN)      # v10.30 — 공통 머리줄의 보기를 안심소개 메인으로(소개장터 메인은 10/9 디자인의 머리줄 — proto_mny.py 가 봄)
        m = pg.evaluate(LANG) or {}
        rec('A-2 「▾」는 글자 크기 — 상자(안쪽 여백 · 테두리)가 아님', bool(m.get('caret')) and m['caret']['w'] <= 16 and m['caret']['h'] <= 24 and m.get('caretPad') == '0px' and m.get('caretBorder') == '0px', m.get('caret'))
        rec('A-3 단추 너비가 글자에 맞음(120px 이하)', bool(m.get('btn')) and m['btn']['w'] <= 120, m.get('btn'))
        pg.click('#screen .lang > button'); pg.wait_for_timeout(250)
        lst = pg.evaluate("()=>{const u=document.querySelector('#screen .lang ul'); if(!u) return null; const r=u.getBoundingClientRect(), b=document.querySelector('#screen .lang > button').getBoundingClientRect(); return {n:u.querySelectorAll('button').length, below:r.top>=b.bottom, gap:Math.round(r.top-b.bottom), right:Math.round(r.right), vw:innerWidth}}")
        rec('A-4 누르면 언어 목록이 단추 바로 아래(12px 안)에 열림', bool(lst) and lst['n'] >= 2 and lst['below'] and lst['gap'] <= 12 and lst['right'] <= lst['vw'], lst)
        before = pg.evaluate("()=>document.querySelector('#screen .lang > button').innerText.trim()")
        pg.evaluate("()=>{const bs=[...document.querySelectorAll('#screen .lang ul button')]; (bs.find(x=>!x.classList.contains('on'))||bs[0]).click()}"); pg.wait_for_timeout(300)
        after = pg.evaluate("()=>document.querySelector('#screen .lang > button').innerText.trim()")
        m2 = pg.evaluate(LANG) or {}
        rec('A-5 다른 언어를 고르면 단추 글자가 바뀌고 목록이 닫힘 · 단추는 그대로 머리줄 안', before != after and not pg.evaluate("!!document.querySelector('#screen .lang ul')") and m2.get('btn', {}).get('h', 99) <= 40, (before, after, m2.get('btn')))
        pg.goto('file://' + FILE + '#/g/mal'); pg.wait_for_timeout(500)
        pg.evaluate("()=>{const bt=document.querySelector('#screen .lang > button'); bt.click()}"); pg.wait_for_timeout(200)
        pg.evaluate("()=>{const bs=[...document.querySelectorAll('#screen .lang ul button')]; bs[0].click()}"); pg.wait_for_timeout(250)

        # B. 로그인 화면
        pg.goto('file://' + FILE + '#/login'); pg.wait_for_timeout(700); pg.evaluate(CLEAN)
        lg = pg.evaluate(LOGIN)
        rec('B-1 로그인 상자의 글자가 회색 10px 가 아님(언어 단추의 스타일을 받지 않음)', bool(lg['card']) and lg['card']['fs'] != '10px' and lg['card']['color'] != 'rgb(156, 163, 175)', lg['card'])
        rec('B-2 제목 「로그인」이 본문 글자색', bool(lg['h2']) and lg['h2']['color'] != 'rgb(156, 163, 175)', lg['h2'])
        big = [x for x in lg['btns'] if x['t'] in ('로그인', '사업자로 회원가입', '회원가입') or x['t'].startswith('성향') or x['t'].startswith('등록한 성향')]      # v10.27 (G-199) — 개인 회원도 가입하므로 「회원가입」 단추
        rec(f'B-3 로그인 화면의 큰 단추 {len(big)}개 — 높이 44px 이상(안쪽 여백 13px)', len(big) >= 3 and all(x['h'] >= 44 and x['pad'] == '13px' for x in big), big)
        rec('B-4 그 단추들의 글자가 가운데', len(big) >= 3 and all(x['mid'] for x in big), big)
        pg.screenshot(path=os.path.join(OUT, 'proto_lang_login.png'), full_page=True)

        # C. 이름 겹침 (소스)
        css_lgb = re.findall(r'(?:^|[}\n\s])\.lgb\s*\{', src); css_lgc = re.findall(r'(?:^|[}\n\s])\.lgc\s*\{', src)
        rec('C-1 스타일 .lgb · .lgc 의 정의가 로그인 것 하나씩뿐(.lgc 는 좁은 화면용 1개 더)', len(css_lgb) == 1 and len(css_lgc) == 2, (len(css_lgb), len(css_lgc)))
        mk = re.search(r"'<div class=\"lang\">' \+\s*'<button class=\"([\w ]+)\"", src)
        rec('C-2 언어 단추의 클래스가 로그인 화면의 이름(lgb · lgc)이 아님', bool(mk) and 'lgb' not in mk.group(1).split() and m.get('caretClass') not in ('lgc', None, ''), (mk.group(1) if mk else None, m.get('caretClass')))

        # D. 그 밖
        pg.set_viewport_size({'width': 390, 'height': 800})
        ow = {}
        for h in ('#/g/mny', '#/login', '#/g/biz'):
            pg.goto('file://' + FILE + h); pg.wait_for_timeout(500); mm = pg.evaluate(LANG)
            ow[h] = (pg.evaluate("document.documentElement.scrollWidth - innerWidth"), mm['btn']['h'] if mm else None)
        pg.set_viewport_size({'width': 1500, 'height': 900})
        rec('D-1 390px — 가로 스크롤 0 · 언어 단추가 보이면 40px 이하', all(v[0] <= 1 and (v[1] is None or v[1] <= 40) for v in ow.values()), ow)
        pg.goto('file://' + FILE + '#/g/biz'); pg.wait_for_timeout(600); pg.evaluate(CLEAN)
        pg.screenshot(path=os.path.join(OUT, 'proto_lang_header.png'), clip={'x': 0, 'y': 0, 'width': 1500, 'height': 110})
        rec('D-2 그리는 중 오류 0', not errs, errs[:3])
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_lang.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
