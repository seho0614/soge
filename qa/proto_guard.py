"""시안 v10.22 — 「시연 보장」(누르면 무엇이든 보인다)이 소개뱅크몰에서 빠지는 곳 점검. 결과: proto_guard.json

  소개뱅크몰의 「고민별」 화면에서 이미 골라져 있는 갈래 단추(「전체」)를 누르면 화면은 다시 그려지지만 보이는 변화가 없습니다.
  이럴 때는 안내 글이 떠야 하는데(시연 보장), 「변화가 있었는지」를 화면 글자를 다섯 자마다 하나씩만 보고 판정해
  그림(SVG)의 일련번호(id="ar37" → "ar40")가 우연히 걸리면 「변화 있음」으로 보고 안내를 띄우지 않았습니다.
  v10.22 에서 언어 단추의 이름이 두 글자 길어지면서 이 우연이 뒤집혀 전수 누르기에서 「무반응 1」로 드러났습니다.

  A. 그 단추를 누르면 — 화면 앞쪽에 글자를 0 ~ 4자 끼워 넣어 자리를 밀어 가며 — 언제나 안내 글이 뜸
  B. 다른 갈래 단추를 누르면 전처럼 목록이 바뀜(안내 글이 아니라 진짜 변화)

사용:  python3 proto_guard.py       PROTO=/path/proto.html (기본 킷의 spec/proto.html)
"""
import json, os, sys
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

GO = """(h)=>{const b=document.createElement('a');b.setAttribute('data-go',h);b.textContent='x';document.getElementById('hltapp').appendChild(b);b.click();}"""
TOAST = "()=>document.getElementById('hlttoast').innerText.trim()"
CLEAR = "(()=>{const t=document.getElementById('hlttoast');if(t)t.innerHTML=''})()"
ON = "()=>[...document.querySelectorAll('#hltapp .hlt-catchip')].filter(e=>e.offsetParent!==null).map(e=>({t:e.innerText.trim(), on:e.classList.contains('on')}))"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); errs = []
        def page(route, shift=0):
            pg = b.new_page(); pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
            pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
            pg.goto('file://' + FILE + '#/health'); pg.wait_for_timeout(1300)
            pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
            pg.evaluate(GO, route); pg.wait_for_timeout(300)
            if shift:   # 몰 화면 앞쪽에 글자를 끼워 넣어 뒤의 글자 자리를 밉니다(다시 그려도 남는 자리)
                pg.evaluate("(n)=>{const r=document.getElementById('hltroot')||document.getElementById('hlthost'); r.insertBefore(document.createComment('x'.repeat(n)), r.firstChild)}", shift)
            return pg
        res = {}
        for n in range(5):
            pg = page('#/w/IMMUNE', n); chips = pg.evaluate(ON)
            sel = [c for c in chips if c['on']]
            pg.evaluate(CLEAR)
            pg.evaluate("()=>{[...document.querySelectorAll('#hltapp .hlt-catchip.on')].filter(e=>e.offsetParent!==null)[0].click()}"); pg.wait_for_timeout(450)
            res[n] = (pg.evaluate(TOAST)[:40], sel[0]['t'] if sel else None, len(chips)); pg.close()
        rec('A-1 소개뱅크몰 「고민별 · 면역」에서 이미 골라진 「전체」를 누르면 안내 글이 뜸 — 화면 앞쪽을 0 ~ 4자 밀어 가며 5번 모두', all(v[0] and v[1] == '전체' and v[2] >= 3 for v in res.values()), res)
        pg = page('#/w/IMMUNE'); chips = pg.evaluate(ON)
        cards0 = pg.evaluate("document.getElementById('hltapp').innerText")
        pg.evaluate(CLEAR)
        pg.evaluate("()=>{[...document.querySelectorAll('#hltapp .hlt-catchip')].filter(e=>e.offsetParent!==null && !e.classList.contains('on'))[0].click()}"); pg.wait_for_timeout(450)
        chips1 = pg.evaluate(ON); cards1 = pg.evaluate("document.getElementById('hltapp').innerText"); tz = pg.evaluate(TOAST)
        rec('B-1 다른 갈래 단추를 누르면 그 단추가 골라지고 목록이 바뀜(안내 글이 아니라 진짜 변화)', [c['t'] for c in chips1 if c['on']] != [c['t'] for c in chips if c['on']] and cards0 != cards1 and '시안은 표시만' not in tz, ([c for c in chips1 if c['on']], tz[:40]))
        pg.close()
        rec('C-1 그리는 중 오류 0', not errs, errs[:3])
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_guard.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
