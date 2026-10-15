"""시안 v10.20 — 매물 「상세」 화면에서 소개하기 · 소개받고 싶어요 · 소개받기 버튼 삭제 점검. 파일(file://)로 열어 실제로 봅니다. 결과: proto_detail.json

  A. 구성          제목 v10.20 · 화면 목록은 앞 판과 같음
  B. 상세          세 버튼과 그 아래 안내 글이 없음 · 돌아가기 · 검색 · 본문(사진 · 제목 · 소개자 · 실적 · 설명 · 질문하기 · 전화하기)은 그대로 · 빈 자리를 남기지 않음
  C. 다른 화면      세 버튼이 있던 나머지 화면에는 그대로(요청 범위는 상세뿐)
  D. 누르는 것      소개창업에서 매물을 눌러 들어와도 없음 · 돌아가기가 소개창업으로 감 · 상세의 누르는 것 전부 무반응 0 · 오류 0
  E. 좁은 화면      390px 세 버튼 없음 · 문서 가로 스크롤 0 · 넘침이 앞 판보다 늘지 않음
  F. 앞 판과 비교   v10.19 와 다른 화면은 detail 한 장뿐 · 빠진 것은 세 버튼과 안내 글뿐

사용:  python3 proto_detail.py       PROTO=/path/proto.html (기본 킷의 spec/proto.html) · BASE=/path/SGB_Prototype_v10_19.html (앞 판 · 기본 /mnt/user-data/outputs)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright
from proto_names import names as _names      # v10.25 — 앞 판의 글자에 이름 규칙(소개뱅크몰 → 소개몰 …)을 입혀 견줍니다

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_19.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    # v10.31 — 앞 판 시안(BASE)이 이 작업 환경에 없으면 그것과 견주는 단계는 「건너뜀」(통과로 세지 않음 · 전에는 None 과 견줘 실패로 셈)
    if not ok and not os.path.exists(BASE) and ('앞 판' in step or '기준 판' in step) and 'None' in str(detail):
        R.append({'step': step, 'ok': False, 'skip': True, 'detail': f'앞 판 시안 없음 — {BASE}'}); print('SKIP', step, file=sys.stderr); return
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240], file=sys.stderr)

CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
NOTOAST = "(()=>{const t=document.getElementById('toast'); if(t){t.classList.remove('on'); t.innerHTML=''}})()"
def paint(pg, k):
    pg.evaluate("location.hash=''"); pg.wait_for_timeout(120); pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(250); pg.evaluate(CLEAN); pg.evaluate(NOTOAST)

THREE = ['소개하기', '소개받고 싶어요', '소개받기']
# v10.21 에서 달라진 화면 16장 — 앞 판(v10.19)과 견줄 때 함께 달라집니다. 상세 자체도 한 틀로 바뀌어(맨 아래 줄에 「신고」 추가 등) 글자 비교는 proto_item.py · proto_diff.py 가 맡습니다
# v10.22 — 새 화면 4장(bjob · bsvc · bpol · bedu)은 앞 판에 없으므로 함께 달라집니다. 언어 단추의 클래스 이름(lgb → lngb)은 같은 것으로 보고 견줍니다
from v1027_changes import CHANGED as V1027, NEW as V1027_NEW, G116
LATER_CHANGED = ['detail', 'dtlm', 'dtll', 'ask', 'asklock', 'list', 'listl', 'listb', 'lstm', 'lstl2', 'lstb2', 'urg', 'mylik', 'cmu', 'myacc', 'bjob', 'bsvc', 'bpol', 'bedu',      # v10.25 — regb(사업자 등록)는 뺐습니다: 앞 판과의 차이가 옛 관 이름뿐이라, 앞 판에 이름 규칙을 입히면 같습니다
                 'commu', 'cmud', 'cmuw', 'cmupoll',      # 이 줄의 넷(+ cmu) — v10.23 소개광장 제시 디자인
                 'malcsl', 'malcsld', 'malgive',      # v10.24
                 'admhpr'] + sorted(V1027) + V1027_NEW      # v10.27 — 29장 + 새 화면 termsv(v1027_changes.py) · v10.26 — 운영 「소개몰 상품」(새 화면) · 위 줄 주석: v10.24 — 상담 업종(malcsld 는 새 화면 · malgive 는 「돌아가기」에 적히는 앞 화면 이름만 달라짐)
# 상세 화면 위쪽 — 세 버튼 · 안내 글 · 돌아가기 · 검색 · 본문 상자의 자리
TOP = """(()=>{
  const sc=document.getElementById('screen'); const box=e=>{const r=e.getBoundingClientRect(); return {t:Math.round(r.top), b:Math.round(r.bottom), l:Math.round(r.left), r:Math.round(r.right)}};
  const tabs=[...sc.querySelectorAll('.tabs .tab')].map(e=>e.textContent.trim());
  const byText=[...sc.querySelectorAll('button,a')].map(e=>e.textContent.trim()).filter(t=>['소개하기','소개받고 싶어요','소개받기'].includes(t));
  const back=sc.querySelector('.bkl'); const panel=sc.querySelector('.panel');
  const wraps=[...sc.querySelectorAll('.wrap')].filter(w=>!w.classList.contains('hdin'));
  const first=wraps[0]; const kids=first?[...first.children].filter(c=>c.getBoundingClientRect().height>0):[];
  const last=kids.length?kids[kids.length-1]:null;
  return {tabs, byText, note: sc.querySelectorAll('.tabnote').length, noteText: /다양한 상품과 서비스를 소개하고/.test(sc.innerText),
          back: back?back.textContent.trim():null, hasSearch: !!sc.querySelector('input[placeholder*="검색"]'),
          lastTop: last?last.className:null, lastBox: last?box(last):null, panel: panel?box(panel):null, ow: sc.scrollWidth-sc.clientWidth};
})()"""
GET = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
    let h=document.getElementById('screen').innerHTML;
    h=h.replace(/data-adbox="HERO"[\\s\\S]*?<\\/div><\\/div>/g,'AD').replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g,'T').replace(/SGB_Prototype_v10_[0-9]+\\.html/g,'PROTO').replace(/방문자 키: v-[a-z0-9]+/g,'방문자 키').replace(/class="lngb"/g,'class="lgb"').replace(/class="lngc"/g,'class="lgc"').replace(/data:image\\/[a-z]+;base64,[A-Za-z0-9+\\/=]+/g,'IMG').replace(/<span class="bell"[^>]*>/g,'<span class="bell">').replace(/<a href="#" data-(t="알림 정책\(G-03\)이 확정되면 붙입니다\."|go="myntf")>설정 · 알림/g,'<a>설정 · 알림');;  /* v10.27 — 머리줄 종 · 「설정 · 알림」(G-196) 한 줄만 같게 맞춤 */
    return h}"""
HAS = """(ks)=>{const out=[]; for(const k of ks){ location.hash=''; __VIEW.paint(k);
    const t=[...document.querySelectorAll('#screen .tabs .tab')].map(e=>e.textContent.trim());
    if(t.length>=3 && t[0]==='소개하기' && t[1]==='소개받고 싶어요' && t[2]==='소개받기') out.push(k);} return out}"""

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900}); errs = []
        block = lambda r: r.abort() if r.request.url.startswith('http') else r.continue_()
        pg.route('**/*', block)
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.on('dialog', lambda d: d.accept())
        pg.goto('file://' + FILE); pg.wait_for_timeout(1600); pg.evaluate(CLEAN)

        # ── A ──
        title = open(FILE, encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
        rec('A-1 파일 제목 v10.20 뒤 판 · 「상세」 표기', bool(re.search(r'v10\.(2\d|[3-9]\d)', title)) and '상세' in title, title[:100])
        keys = pg.evaluate("Object.keys(__VIEW.screens)")
        old = None; base_keys = None
        if os.path.exists(BASE):
            old = b.new_page(viewport={'width': 1500, 'height': 900}); old.route('**/*', block)
            old.goto('file://' + BASE); old.wait_for_timeout(1500); base_keys = old.evaluate("Object.keys(__VIEW.screens)")
        rec('A-2 화면 목록은 앞 판(v10.19) + v10.22 의 새 화면 4장 + v10.24 의 새 화면 1장 + v10.26 의 새 화면 1장 + v10.27 의 새 화면 1장(약관 전문 · 없앤 화면 없음)', base_keys is not None and sorted(keys) == sorted(list(base_keys) + ['bjob', 'bsvc', 'bpol', 'bedu', 'malcsld', 'admhpr'] + V1027_NEW) and 'detail' in keys, (len(keys), base_keys and len(base_keys)))

        # ── B ──
        paint(pg, 'detail'); t = pg.evaluate(TOP); txt = pg.inner_text('#screen')
        rec('B-1 상세: 「소개하기 · 소개받고 싶어요 · 소개받기」 버튼이 없음', t['tabs'] == [] and t['byText'] == [], (t['tabs'], t['byText']))
        rec('B-2 버튼 아래 안내 글(「다양한 상품과 서비스를 소개하고…」)도 없음', t['note'] == 0 and not t['noteText'], (t['note'], t['noteText']))
        rec('B-3 돌아가기 · 검색은 그대로', bool(t['back']) and '돌아가기' in t['back'] and t['hasSearch'], (t['back'], t['hasSearch']))
        need = ['특A급 프리미엄 고깃집', '소개자 실적', '총 소개', '성사율', '누적수익', '소개 상품 상세 설명', '질문하기', '전화하기']
        rec('B-4 본문 그대로 — 사진 · 제목 · 소개자 · 실적 · 상세 설명 · 질문하기 · 전화하기', all(x in txt for x in need) and pg.locator('#screen .dtimg').count() == 1, [x for x in need if x not in txt])
        gap = (t['panel']['t'] - t['lastBox']['b']) if t['panel'] and t['lastBox'] else None
        rec('B-5 버튼이 빠진 자리를 비워 두지 않음 — 검색 바로 아래(40px 안)에서 본문 상자가 시작', gap is not None and 0 <= gap <= 40 and 'tabs' not in (t['lastTop'] or '') and 'tabnote' not in (t['lastTop'] or ''), (gap, t['lastTop'], t['lastBox'], t['panel']))
        pg.screenshot(path=os.path.join(OUT, 'proto_detail_1500.png'))

        # ── C ──
        has_new = pg.evaluate(HAS, keys); has_old = old.evaluate(HAS, keys) if old is not None else None
        rec(f'C-1 세 버튼이 있는 화면: 앞 판 {has_old and len(has_old)}장에서 detail 한 장만 빠짐 (나머지 화면의 세 버튼은 그대로)',
            has_old is not None and 'detail' in has_old and sorted(has_new) == sorted(k for k in has_old if k != 'detail' and k not in G116 and k != 'list') and len(has_new) >= 1, (has_old, has_new))      # v10.27 — G-116 세 화면(bst · saf · win)도 뺌 · v10.30 — 소개장터 메인(list)은 10/9 디자인의 바로가기 3장으로 바뀜
        # 다른 상세(모바일 상세 · 요청 상세)의 내용은 그대로 — 세 버튼 유무가 앞 판과 같음
        others = {}
        for k in ('dtm', 'reqd', 'reqdm'):
            if k in keys:
                paint(pg, k); others[k] = pg.evaluate("[...document.querySelectorAll('#screen .tabs .tab')].map(e=>e.textContent.trim()).slice(0,3)")
        rec('C-2 요청 상세(reqd)의 세 버튼은 그대로', others.get('reqd') == THREE, others)

        # ── D ──
        # 보내 주신 화면과 같은 길 — 소개창업(#/g/biz) → 매물을 누름 → 상세(「← 소개창업(으)로 돌아가기」)
        pg.evaluate("location.hash='#/g/biz'"); pg.wait_for_timeout(450); pg.evaluate(CLEAN)
        s0 = pg.evaluate("__VIEW.state.screen")
        pg.locator('#screen [data-open], #screen [data-go="detail"]').first.click(); pg.wait_for_timeout(450); pg.evaluate(CLEAN)
        tt = pg.evaluate(TOP); s1 = pg.evaluate("__VIEW.state.screen")
        rec('D-1 소개창업에서 매물을 눌러 들어와도(「← 소개창업(으)로 돌아가기」) 세 버튼 · 안내 글이 없음', s0 == 'listb' and s1 == 'detail' and tt['tabs'] == [] and tt['byText'] == [] and tt['note'] == 0 and '소개창업' in (tt['back'] or ''), (s0, s1, tt['tabs'], tt['back']))
        pg.locator('#screen .bkl').click(); pg.wait_for_timeout(450)
        rec('D-2 「← 소개창업(으)로 돌아가기」를 누르면 소개창업으로 돌아감', pg.evaluate("__VIEW.state.screen") == 'listb', pg.evaluate("__VIEW.state.screen"))
        dead = []
        paint(pg, 'detail')
        SEL = '#screen a, #screen button, #screen [data-go], #screen [data-t]'
        n = pg.locator(SEL).count(); n_old = None
        if old is not None:
            old.evaluate("location.hash=''; __VIEW.paint('detail')"); old.wait_for_timeout(250); n_old = old.locator(SEL).count()
        for i in range(n):
            paint(pg, 'detail'); el = pg.locator(SEL).nth(i)
            if not el.is_visible(): continue
            before = pg.inner_html('#screen') + '|' + pg.evaluate("__VIEW.state.screen") + '|' + pg.evaluate("document.querySelectorAll('.modal.on,.mask.on,.sheet.on,[data-modal].on').length+''")
            try: el.click(timeout=3000)
            except Exception as ex: dead.append((i, 'click ' + str(ex)[:60])); continue
            pg.wait_for_timeout(180)
            toast = pg.evaluate("(()=>{const t=document.getElementById('toast');return t&&t.classList.contains('on')?t.textContent.trim():''})()")
            after = pg.inner_html('#screen') + '|' + pg.evaluate("__VIEW.state.screen") + '|' + pg.evaluate("document.querySelectorAll('.modal.on,.mask.on,.sheet.on,[data-modal].on').length+''")
            body_changed = pg.evaluate("document.body.innerHTML.length")
            if after == before and not toast: dead.append((i, (el.text_content() or '').strip()[:20], body_changed))
            pg.evaluate(NOTOAST); pg.keyboard.press('Escape')
        rec(f'D-3 상세의 누르는 것 {n}개(앞 판 {n_old}개 − 세 버튼 3 + v10.21 의 「신고」 1)를 하나씩 — 눌리지 않는 것 0 · 오류 0', n_old is not None and n == n_old - 3 + 1 and not [d for d in dead if str(d[1]).startswith('click')] and not errs, (n, n_old, dead[:6], errs[:2]))
        R.append({'step': f'D-4 (참고) 눌러도 화면 · 안내가 그대로인 것 {len([d for d in dead if not str(d[1]).startswith("click")])}개 — 앞 판과 같은지는 누르기 전수(sweep)가 봅니다', 'ok': True, 'detail': str(dead[:8])[:300]})

        # ── E ──
        pg.set_viewport_size({'width': 390, 'height': 800}); paint(pg, 'detail'); t = pg.evaluate(TOP)
        doc_ow = pg.evaluate("document.documentElement.scrollWidth - innerWidth"); ow_old = None
        if old is not None:
            old.set_viewport_size({'width': 390, 'height': 800}); old.evaluate("location.hash=''; __VIEW.paint('detail')"); old.wait_for_timeout(250)
            ow_old = old.evaluate("(()=>{const s=document.getElementById('screen');return s.scrollWidth-s.clientWidth})()"); old.set_viewport_size({'width': 1500, 'height': 900})
        # 시안의 데스크톱 화면은 390px 에서 머리줄 등이 화면 상자 안에서 넘칩니다(앞 판도 같음 · 모바일은 따로 그린 화면 dtm). 여기서는 「이번 변경으로 늘지 않았는지」와 문서 전체의 가로 스크롤만 봅니다
        rec('E-1 390px — 세 버튼 없음 · 문서 가로 스크롤 0 · 화면 상자 안의 넘침이 앞 판보다 늘지 않음', t['tabs'] == [] and t['byText'] == [] and doc_ow <= 1 and ow_old is not None and t['ow'] <= ow_old, (t['tabs'], doc_ow, t['ow'], ow_old))
        pg.screenshot(path=os.path.join(OUT, 'proto_detail_390.png'))
        pg.set_viewport_size({'width': 1500, 'height': 900})

        # ── F ── (두 판 모두 새로 열어 화면마다 그려서 견줍니다)
        if old is not None:
            old.close()
            def fresh(path):
                q = b.new_page(viewport={'width': 1280, 'height': 900}); q.route('**/*', block)
                q.on('pageerror', lambda e: errs.append(str(e)[:200]))
                q.goto('file://' + path); q.wait_for_timeout(1600)
                out = {}
                for k in keys:
                    try: out[k] = q.evaluate(GET, k)
                    except Exception as ex: out[k] = 'ERR ' + str(ex)[:80]
                q.close(); return out
            o = {k_: _names(v_) for k_, v_ in fresh(BASE).items()}; nw = fresh(FILE)
            diff = sorted(k for k in keys if o.get(k) != nw.get(k))
            want = sorted(set(['detail'] + LATER_CHANGED))
            rec(f'F-1 앞 판(v10.19)과 다른 화면은 detail 과 그 뒤 판(v10.21 · v10.22 · v10.23 · v10.24 · v10.26)에서 바꾸거나 더한 화면뿐 — {len(want)}장 (전체 {len(keys)}장 중 {len(keys) - len(diff)}장은 글자 하나 같음)', diff == want, ([d for d in diff if d not in want], [d for d in want if d not in diff]))
            rec('F-2 detail 에 세 버튼 · 안내 글 조각이 앞 판에는 있고 지금은 없음(나머지 글자 비교는 v10.21 에서 상세가 한 틀로 바뀌어 proto_item.py 가 맡음)',
                'class="tabnote"' in o['detail'] and 'class="tabnote"' not in nw['detail'] and '<div class="tabs">' in o['detail'].split('class="panel"')[0] and '<div class="tabs">' not in nw['detail'].split('class="panel"')[0], (len(o['detail']), len(nw['detail'])))
        else:
            R.append({'step': f'F 비교 기준 파일이 없어 건너뜀 — {BASE}', 'ok': True, 'skip': True, 'detail': ''})
        rec('G-1 그리는 중 오류 0', not errs, errs[:3])
        b.close()

if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'] and not r.get('skip')); sk = sum(1 for r in R if r.get('skip'))
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_detail.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R) - sk}' + (f' · 건너뜀 {sk}(앞 판 시안 파일 없음)' if sk else ''))
