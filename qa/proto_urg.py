"""시안 v10.19 — 「급구 · 급매」 화면에서 소개하기 · 소개받고 싶어요 · 소개받기 버튼 삭제 점검. 파일(file://)로 열어 실제로 봅니다. 결과: proto_urg.json

  A. 구성          제목 v10.19 · 화면 목록은 앞 판과 같음
  B. 급구 · 급매    세 버튼과 그 아래 안내 글이 없음 · 제목 「급구, 급매」가 다른 것에 가리지 않음 · 빠른 메뉴 5칸 · 목록 · 거르기 그대로
  C. 다른 화면      같은 줄 틀을 쓰는 베스트매칭 · 사고예방 · 성공현황과 목록 화면에는 세 버튼이 그대로(요청 범위는 급구 · 급매뿐)
  D. 누르는 것      급구 · 급매의 버튼을 하나씩 눌러 무반응 0 · 오류 0 · 다른 화면에서 「급구 · 급매」로 들어와도 같음
  E. 좁은 화면      390px 가로 넘침 없음 · 세 버튼 없음
  F. 앞 판과 비교   v10.18 과 다른 화면은 urg 한 장뿐

사용:  python3 proto_urg.py          PROTO=/path/proto.html (기본 킷의 spec/proto.html) · BASE=/path/SGB_Prototype_v10_18.html (앞 판 · 기본 /mnt/user-data/outputs)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright
from proto_names import names as _names      # v10.25 — 앞 판의 글자에 이름 규칙(소개뱅크몰 → 소개몰 …)을 입혀 견줍니다

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_18.html')
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

# 줄(.qrow) 안의 세 버튼 · 제목 · 빠른 메뉴의 자리
ROW = """(()=>{
  const row=document.querySelector('#screen .rrow.qrow'); if(!row) return null;
  const box=e=>{const r=e.getBoundingClientRect(); return {l:Math.round(r.left), r:Math.round(r.right), t:Math.round(r.top), b:Math.round(r.bottom)}};
  const tabs=[...row.querySelectorAll('.tabs .tab')].map(e=>e.textContent.trim());
  const h2=row.querySelector('.whd h2'), sub=row.querySelector('.whd .sub'), qm=row.querySelector('.qmenu');
  const hb=h2?box(h2):null;
  /* 제목 글자 한가운데를 찍었을 때 맨 위에 있는 것이 제목인가(다른 것이 덮고 있지 않은가) */
  let top=null;
  if(hb){ const e=document.elementFromPoint((hb.l+hb.r)/2,(hb.t+hb.b)/2); top = e ? (e===h2||h2.contains(e)) : false; }
  /* 줄 안의 다른 조각이 제목 상자와 겹치는가 */
  const hit=(a,b)=>a&&b&&a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b;
  const over=[...row.querySelectorAll('.tabs .tab,.tabnote')].filter(e=>hit(box(e),hb)).map(e=>e.textContent.trim().slice(0,12));
  return {tabs, note: row.querySelectorAll('.tabnote').length, qtabs: row.querySelectorAll('.qtabs').length, title: h2?h2.textContent.trim():null, sub: sub?sub.textContent.trim():null,
          qmenu: qm?[...qm.querySelectorAll('a')].map(a=>a.textContent.trim()):[], qon: qm?[...qm.querySelectorAll('a.on')].map(a=>a.textContent.trim()):[],
          h2: hb, top, over, rowBox: box(row), mainL: row.querySelector('.qmain')?box(row.querySelector('.qmain')).l:null};
})()"""
THREE = ['소개하기', '소개받고 싶어요', '소개받기']
from v1027_changes import CHANGED as V1027, NEW as V1027_NEW, G116
LATER = ['detail', 'list'] + sorted(G116)      # v10.30 — 소개장터 메인(list)은 10/9 디자인의 바로가기 3장으로 바뀜 · v10.27 — G-116 세 화면도 뺌(10/8 답) · v10.19 뒤 판에서 같은 버튼을 뺀 화면(v10.20 — 상세). 세 버튼이 있는 화면 수를 셀 때 함께 빠집니다
# 그 뒤 판에서 내용이 달라진 화면 — v10.20 의 상세 + v10.21 의 16장. 기준 판(v10.18)과 견줄 때 함께 달라집니다
# v10.22 — 새 화면 4장(소개창업 축의 상세: bjob · bsvc · bpol · bedu)은 기준 판에 없으므로 함께 달라집니다. listb 는 이미 들어 있습니다. 언어 단추의 클래스 이름(lgb → lngb)은 같은 것으로 보고 견줍니다
V1022_NEW = ['bjob', 'bsvc', 'bpol', 'bedu']
# v10.24 — 안심소개 「생활 · 금융 상담」: 새 화면 malcsld(업종 상세) · 달라진 화면 malcsl(줄 단추 · 신청서 주소). malgive 는 내용이 같지만 이 비교가 화면을 순서대로 그리다 보니
#   「돌아가기」에 적히는 앞 화면 이름이 「상담 신청」에서 「상담 업종」(새 화면)으로 바뀌어 함께 달라집니다. proto_fin.py · proto_diff.py · proto_pixel.py 가 따로 봅니다
V1024_NEW = ['malcsld']; V1024 = ['malcsl', 'malgive']
V1026_NEW = ['admhpr']      # v10.26 — 운영 「소개몰 상품」(새 화면)
LATER_CHANGED = sorted(set(['detail'] + ['detail', 'dtlm', 'dtll', 'ask', 'asklock', 'list', 'listl', 'listb', 'lstm', 'lstl2', 'lstb2', 'urg', 'mylik', 'cmu', 'myacc', 'regb'] + V1022_NEW + ['commu', 'cmud', 'cmuw', 'cmupoll'] + V1024 + V1024_NEW + V1026_NEW + sorted(V1027) + V1027_NEW) - {'urg', 'regb'})      # v10.25 — regb 는 앞 판과의 차이가 옛 관 이름뿐이라 이름 규칙을 입히면 같습니다      # 끝의 넷(+ cmu) — v10.23 소개광장
GET = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
    let h=document.getElementById('screen').innerHTML;
    h=h.replace(/data-adbox="HERO"[\\s\\S]*?<\\/div><\\/div>/g,'AD').replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g,'T').replace(/SGB_Prototype_v10_[0-9]+\\.html/g,'PROTO').replace(/방문자 키: v-[a-z0-9]+/g,'방문자 키').replace(/class="lngb"/g,'class="lgb"').replace(/class="lngc"/g,'class="lgc"').replace(/data:image\\/[a-z]+;base64,[A-Za-z0-9+\\/=]+/g,'IMG').replace(/<span class="bell"[^>]*>/g,'<span class="bell">').replace(/<a href="#" data-(t="알림 정책\(G-03\)이 확정되면 붙입니다\."|go="myntf")>설정 · 알림/g,'<a>설정 · 알림');;  /* v10.27 — 머리줄 종 · 「설정 · 알림」(G-196) 한 줄만 같게 맞춤 */
    return h}"""

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900}); errs = []
        pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.on('dialog', lambda d: d.accept())
        pg.goto('file://' + FILE); pg.wait_for_timeout(1600); pg.evaluate(CLEAN)

        # ── A ──
        title = open(FILE, encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
        rec('A-1 파일 제목 v10.19 · 「급구 · 급매」 표기', bool(re.search(r'v10\.(19|[2-9]\d)', title)) and '급구' in title, title[:100])
        keys = pg.evaluate("Object.keys(__VIEW.screens)")
        base_keys = None; old = None
        if os.path.exists(BASE):
            old = b.new_page(viewport={'width': 1500, 'height': 900}); old.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
            old.goto('file://' + BASE); old.wait_for_timeout(1500); base_keys = old.evaluate("Object.keys(__VIEW.screens)")
        rec('A-2 화면 목록은 앞 판(v10.18) + v10.22 의 새 화면 4장 + v10.24 의 새 화면 1장 + v10.26 의 새 화면 1장 + v10.27 의 새 화면 1장(약관 전문 · 없앤 화면 없음)', base_keys is not None and sorted(keys) == sorted(list(base_keys) + V1022_NEW + V1024_NEW + V1026_NEW + V1027_NEW) and 'urg' in keys, (len(keys), base_keys and len(base_keys)))

        # ── B ──
        paint(pg, 'urg')
        r = pg.evaluate(ROW)
        rec('B-1 급구 · 급매: 「소개하기 · 소개받고 싶어요 · 소개받기」 버튼이 없음', r is not None and r['tabs'] == [] and r['qtabs'] == 0, r and r['tabs'])
        rec('B-2 버튼 아래 안내 글(「다양한 상품과 서비스를 소개하고…」)도 없음', r is not None and r['note'] == 0 and '다양한 상품과 서비스를 소개하고' not in pg.inner_text('#screen .rrow.qrow'), r and r['note'])
        rec('B-3 제목 「급구, 급매」 · 설명 글이 그대로 있고, 제목을 덮는 것이 없음', r is not None and r['title'] == '급구, 급매' and '급하게 구하거나' in (r['sub'] or '') and r['top'] is True and r['over'] == [], r and (r['title'], r['top'], r['over']))
        rec('B-4 버튼이 빠진 자리를 비워 두지 않음 — 제목이 줄의 왼쪽 끝에서 시작', r is not None and r['mainL'] is not None and abs(r['mainL'] - r['rowBox']['l']) <= 2, r and (r['mainL'], r['rowBox']))
        rec('B-5 빠른 메뉴 5칸 그대로 · 「급구 · 급매」가 켜져 있음', r is not None and len(r['qmenu']) == 5 and any('급구' in x for x in r['qon']) and len(r['qon']) == 1, r and (r['qmenu'], r['qon']))
        t = pg.inner_text('#screen')
        rec('B-6 나머지 내용 그대로 — 지역 설정 · 상품 분류 · 거르기(전체 · 급구 · 급매) · 매물 · 추천 매물', all(x in t for x in ('지역 설정', '상품 분류', '급구/급매 추천 매물')) and pg.locator('#screen .ufilt .uf').count() >= 3 and pg.locator('#screen .ufilt .uf.on').count() == 1, t[:120])
        n_all = pg.evaluate("document.querySelectorAll('#screen .body2 a, #screen .body2 button').length")
        # 거르기를 눌러도 버튼이 다시 생기지 않음
        pg.locator('#screen .ufilt .uf').nth(1).click(); pg.wait_for_timeout(200); r2 = pg.evaluate(ROW)
        pg.locator('#screen .ufilt .uf').nth(2).click(); pg.wait_for_timeout(200); r3 = pg.evaluate(ROW)
        rec('B-7 「급구」 · 「급매」로 걸러도(화면을 다시 그려도) 세 버튼이 다시 생기지 않음', r2 and r3 and r2['tabs'] == [] and r3['tabs'] == [] and r3['top'] is True, (r2 and r2['tabs'], r3 and r3['tabs']))
        pg.screenshot(path=os.path.join(OUT, 'proto_urg_1500.png'))

        # ── C ──
        sib = {}
        for k, name in (('bst', '베스트매칭'), ('saf', '사고예방'), ('win', '성공현황')):
            if k not in keys: sib[k] = None; continue
            paint(pg, k); sib[k] = pg.evaluate(ROW)
        rec('C-1 같은 줄 틀을 쓰는 베스트매칭 · 사고예방 · 성공현황에서도 세 버튼이 빠짐(v10.27 G-116 — 10/8 답 「세 화면에도 단추 삭제」) · 제목이 가리지 않음', all(sib.get(k) and sib[k]['tabs'] == [] and sib[k]['top'] is True for k in ('bst', 'saf', 'win')), {k: v and (v['tabs'], v['top']) for k, v in sib.items()})
        # 세 버튼이 있는 화면의 목록 — 앞 판에서 urg 한 장만 빠져야 합니다
        HAS = """(ks)=>{const out=[]; for(const k of ks){ location.hash=''; __VIEW.paint(k);
            const t=[...document.querySelectorAll('#screen .tabs .tab')].map(e=>e.textContent.trim());
            if(t.length>=3 && t[0]==='소개하기' && t[1]==='소개받고 싶어요' && t[2]==='소개받기') out.push(k);} return out}"""
        has_new = pg.evaluate(HAS, keys); has_old = old.evaluate(HAS, keys) if old is not None else None
        rec(f'C-2 세 버튼이 있는 화면: 기준 판(v10.18) {has_old and len(has_old)}장에서 urg 가 빠짐 (그 뒤 v10.20 에서 뺀 상세 화면 말고는 그대로)',
            has_old is not None and 'urg' in has_old and sorted(has_new) == sorted(k for k in has_old if k != 'urg' and k not in LATER) and len(has_new) >= 4, (has_old, has_new))

        # ── D ──
        paint(pg, 'bst'); pg.locator('#screen .qmenu a', has_text='급구').first.click(); pg.wait_for_timeout(350); pg.evaluate(CLEAN)
        r = pg.evaluate(ROW)
        rec('D-1 다른 화면(베스트매칭)의 빠른 메뉴로 들어와도 세 버튼이 없음', pg.evaluate("__VIEW.state.screen") == 'urg' and r and r['tabs'] == [] and r['top'] is True, (pg.evaluate("__VIEW.state.screen"), r and r['tabs']))
        dead = []
        paint(pg, 'urg')
        SEL = '#screen .rrow.qrow a:not(.on), #screen .rrow.qrow button, #screen .ufilt .uf:not(.on)'
        n = pg.locator(SEL).count()
        for i in range(n):
            paint(pg, 'urg')
            before = pg.inner_html('#screen') + '|' + pg.evaluate("__VIEW.state.screen")
            pg.locator(SEL).nth(i).click(); pg.wait_for_timeout(180)
            toast = pg.evaluate("(()=>{const t=document.getElementById('toast');return t&&t.classList.contains('on')?t.textContent.trim():''})()")
            after = pg.inner_html('#screen') + '|' + pg.evaluate("__VIEW.state.screen")
            if after == before and not toast: dead.append(i)
            pg.evaluate(NOTOAST)
        rec(f'D-2 줄 · 거르기의 누르는 것 {n}개(지금 켜져 있는 칸 제외)를 하나씩 — 무반응 0 · 오류 0', n >= 6 and not dead and not errs, (n, dead, errs[:2]))
        # 지금 켜져 있는 칸(빠른 메뉴 「급구 · 급매」 · 거르기 「전체」)을 눌러도 화면이 그대로 · 세 버튼이 생기지 않음
        paint(pg, 'urg'); pg.locator('#screen .rrow.qrow .qmenu a.on').click(); pg.wait_for_timeout(250); pg.evaluate(CLEAN)
        r_on = pg.evaluate(ROW); scr1 = pg.evaluate("__VIEW.state.screen")
        pg.locator('#screen .ufilt .uf.on').click(); pg.wait_for_timeout(200); r_on2 = pg.evaluate(ROW)
        rec('D-3 지금 켜져 있는 칸을 다시 눌러도 급구 · 급매 화면 그대로 · 세 버튼이 생기지 않음', scr1 == 'urg' and r_on and r_on['tabs'] == [] and r_on2 and r_on2['tabs'] == [] and not errs, (scr1, r_on and r_on['tabs'], errs[:2]))

        # ── E ──
        pg.set_viewport_size({'width': 390, 'height': 800}); paint(pg, 'urg')
        r = pg.evaluate(ROW)
        ov = pg.evaluate("(()=>{const b=document.querySelector('#screen .rrow.qrow');return b?b.scrollWidth-b.clientWidth:-1})()")
        rec('E-1 390px — 세 버튼 없음 · 줄 안에서 가로 넘침 없음', r and r['tabs'] == [] and 0 <= ov <= 1, (r and r['tabs'], ov))
        pg.screenshot(path=os.path.join(OUT, 'proto_urg_390.png'))
        pg.set_viewport_size({'width': 1500, 'height': 900})

        # ── F ── (앞에서 누른 것이 남지 않도록 두 판 모두 새로 열어 화면마다 그려서 견줍니다)
        if old is not None:
            old.close()
            def fresh(path):
                q = b.new_page(viewport={'width': 1280, 'height': 900}); q.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
                q.on('pageerror', lambda e: errs.append(str(e)[:200]))
                q.goto('file://' + path); q.wait_for_timeout(1600)
                out = {}
                for k in keys:
                    try: out[k] = q.evaluate(GET, k)
                    except Exception as ex: out[k] = 'ERR ' + str(ex)[:80]
                q.close(); return out
            o = {k_: _names(v_) for k_, v_ in fresh(BASE).items()}; nw = fresh(FILE)
            diff = sorted(k for k in keys if o.get(k) != nw.get(k))
            rec(f'F-1 기준 판(v10.18)과 다른 화면은 urg 와 그 뒤 판(v10.20 · v10.21 · v10.22 · v10.23 · v10.24 · v10.26)에서 바꾸거나 더한 {len(LATER_CHANGED)}장뿐 (전체 {len(keys)}장 중 {len(keys) - len(diff)}장은 글자 하나 같음)', diff == sorted(['urg'] + LATER_CHANGED), ([d for d in diff if d not in ['urg'] + LATER_CHANGED], [d for d in ['urg'] + LATER_CHANGED if d not in diff]))
            # v10.21 에서 카드가 자기 매물번호를 달고 상세와 같은 사진을 쓰게 됐습니다 — 카드의 링크 값 · 사진은 지우고 견줍니다(그 변경은 proto_item.py 가 봅니다)
            import re as _re2
            _n = lambda h: _re2.sub(r'<div class="uimg">(<img[^>]*>|<svg.*?</svg>)?', '<div class="uimg">PHOTO', _re2.sub(r' data-(open|g)="[^"]*"', '', h), flags=_re2.S)
            old_h, new_h = _n(o['urg']), _n(nw['urg'])
            rec('F-2 urg 에서 빠진 것은 세 버튼 칸뿐 — 본문(목록 · 옆 칸)은 글자 하나 같음',
                '<div class="body2">' in new_h and new_h.split('<div class="body2">', 1)[-1] == old_h.split('<div class="body2">', 1)[-1] and len(new_h) < len(old_h), (len(old_h), len(new_h)))
            # 줄 틀에서 달라진 것: 세 버튼 칸(.qtabs)이 통째로 빠지고 줄에 noq 가 붙은 것뿐
            import re as _re
            head_old = old_h.split('<div class="body2">', 1)[0]; head_new = new_h.split('<div class="body2">', 1)[0]
            cut = _re.sub(r'<div class="qtabs">.*?(?=<div class="qmain">)', '', head_old, flags=_re.S).replace('class="rrow qrow"', 'class="rrow qrow noq"')
            rec('F-3 줄 틀에서 달라진 것은 세 버튼 칸이 빠진 것 하나 — 제목 · 설명 · 빠른 메뉴는 글자 하나 같음', cut == head_new and head_old != head_new, (len(head_old), len(head_new)))
        else:
            R.append({'step': f'F 비교 기준 파일이 없어 건너뜀 — {BASE}', 'ok': True, 'skip': True, 'detail': ''})
        rec('G-1 그리는 중 오류 0', not errs, errs[:3])
        b.close()

if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'] and not r.get('skip')); sk = sum(1 for r in R if r.get('skip'))
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_urg.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R) - sk}' + (f' · 건너뜀 {sk}(앞 판 시안 파일 없음)' if sk else ''))
