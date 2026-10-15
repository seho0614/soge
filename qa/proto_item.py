"""시안 v10.21 — 매물 상세가 「누른 매물」의 내용으로 열리는지 점검. 파일(file://)로 열어 실제로 눌러 봅니다. 결과: proto_item.json

  A. 카드 → 상세   소개장터 · 안심소개 · 소개창업의 랜딩 · 전체 목록 · 급구급매 카드를 하나씩 눌러 제목 · 분류 · 금액 · 지역 · 사진이 상세와 같은지
  B. 주소          매물마다 주소가 다름 · 같은 매물은 어디서 눌러도 같은 주소 · 주소로 바로 열어도 같은 매물
  C. 형식          세 관의 상세가 같은 틀(사진 · 제목 · 소개자 · 실적 · 설명 · 문의 · 후기 · 맨 아래 줄) · 화면 ID 는 그대로
  D. 맨 아래 줄     「관심 담기 · 질문 N · 공유하기 · 신고 · 1:1 문의 시작」 한 줄 · 눌렀을 때의 동작
  E. 관별 안내      안심소개의 소개코드 공유 상자 · 노출료 안내 / 소개장터의 소개비 협의 안내 / 귀속 안내
  F. 마이 관심      「보기」가 항목의 관에 맞는 상세로 · 그 항목의 내용으로
  G. 문의방 왕복    상세 → 1:1 문의 → 「리스팅 보기」 / 「돌아가기」가 처음 보던 매물로
  H. 견본 · 없는 번호  앞 판의 견본 주소 3개는 그대로 열림 · 없는 번호는 그 관의 견본
  I. 내용           견본이 아닌 매물에 고깃집 견본 글이 나오지 않음 · 깨진 글자 0
  K. 소개광장       글 목록에 글이 보이고 제목을 누르면 그 글의 상세 · 글마다 주소
  L. 누적수익 공개   마이 > 프로필의 선택 칸(기본 꺼짐) · 상세의 설명
  J. 그 밖          돌아가기 · 좁은 화면 · 화면 수 · 오류 0

사용:  python3 proto_item.py       PROTO=/path/proto.html (기본 킷의 spec/proto.html)
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
NOTOAST = "(()=>{const t=document.getElementById('toast'); if(t){t.classList.remove('on'); t.innerHTML=''}})()"
TOAST = "(()=>{const t=document.getElementById('toast');return t&&t.classList.contains('on')?t.textContent.trim():''})()"
GW = {'mny': ('MNY', 'dtlm', '소개장터', 'SB-MNY-DTL-010'), 'mal': ('MAL', 'dtll', '안심소개', 'SB-MAL-DTL-010'), 'biz': ('BIZ', 'detail', '소개창업', 'SB-BIZ-DTL-010')}
PAGES = [('랜딩', ''), ('전체 목록', '/list'), ('급구급매', '/urgent')]

# 카드에 보이는 값 — 제목 · 분류 · 금액 · 지역 · 사진(그림 자료의 길이와 앞뒤 글자로 견줌)
CARDS = """()=>{const sig=i=>{if(!i) return ''; const s=i.getAttribute('src')||''; return s.length+':'+s.slice(0,48)+':'+s.slice(-24)};
  const tx=(e,s)=>{const x=e.querySelector(s); return x?(x.innerText||'').replace(/\\s+/g,' ').trim():''};
  return [...document.querySelectorAll('#screen .pgc, #screen .pc, #screen .uc')].filter(e=>e.offsetParent!==null).map((e,i)=>{
    if(e.classList.contains('pgc')) return {i, kind:'pgc', title:tx(e,'.tt'), cat:tx(e,'.cc'), price:tx(e,'.pr'), region:tx(e,'.mt2 span').split(' · ')[0], img:sig(e.querySelector('.pgt img'))};
    if(e.classList.contains('pc'))  return {i, kind:'pc',  title:tx(e,':scope > b'), cat:tx(e,'.ck'), price:tx(e,'.pf2 span'), region:tx(e,':scope > .ls').split(' · ')[0], img:sig(e.querySelector('.pcimg img'))};
    return {i, kind:'uc', title:tx(e,'.ut'), cat:tx(e,'.uct'), price:tx(e,'.up'), region:tx(e,'.ul').replace(/^[^가-힣A-Za-z0-9]+/,''), img:sig(e.querySelector('.uimg img'))}; })}"""
CLICKCARD = "(i)=>{[...document.querySelectorAll('#screen .pgc, #screen .pc, #screen .uc')].filter(e=>e.offsetParent!==null)[i].click()}"
DETAIL = """()=>{const sc=document.getElementById('screen'); const sig=i=>{if(!i) return ''; const s=i.getAttribute('src')||''; return s.length+':'+s.slice(0,48)+':'+s.slice(-24)};
  const tx=s=>{const x=sc.querySelector(s); return x?(x.innerText||'').replace(/\\s+/g,' ').trim():''};
  const t=sc.innerText||'';
  return {screen:__VIEW.state.screen, hash:location.hash, title:tx('.dtt'), cat:tx('.dtcat'), price:tx('.dtprice'), region:tx('.dtloc').replace(/^[^가-힣A-Za-z0-9]+/,''),
          img:sig(sc.querySelector('.dtimg img')), bad:[...new Set((t.match(/undefined|NaN|\\[object Object\\]/g)||[]))], text:t.slice(0,9000)}}"""
PARTS = """()=>{const sc=document.getElementById('screen'); const n=s=>sc.querySelectorAll(s).length;
  return {dt:n('.dt'), dtimg:n('.dt .dtimg'), dtprof:n('.dtprof'), stat:n('.stat > div'), dsec:n('.dsec'), qna:n('.qna'), qi:n('.qna .qi'), revs:n('.revs .rv2'), abar:n('.abar'), dact:n('.dact'), table:n('.wrap table'),
          abtn:[...sc.querySelectorAll('.abar button')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()), prof:[...sc.querySelectorAll('.dtprof button')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()),
          back:(sc.querySelector('.bkl')||{}).innerText||'', search:!!sc.querySelector('input[placeholder*="검색"]')}}"""
TABS = """()=>[...document.querySelectorAll('#screen *')].filter(e=>e.offsetParent!==null && (e.hasAttribute('data-xv') || e.getAttributeNames().some(n=>/^data-[a-z]*tab$/.test(n)))).length"""
TABCLICK = """(j)=>{[...document.querySelectorAll('#screen *')].filter(e=>e.offsetParent!==null && (e.hasAttribute('data-xv') || e.getAttributeNames().some(n=>/^data-[a-z]*tab$/.test(n))))[j].click()}"""
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
strip = lambda s: re.sub(r'^[^가-힣A-Za-z0-9]+', '', norm(s))          # 앞의 그림 글자(♡ 💬 ↗ ⭐)를 뗌


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); errs = []
        block = lambda r: r.abort() if r.request.url.startswith('http') else r.continue_()
        def newpage(w=1500, h=900):
            q = b.new_page(viewport={'width': w, 'height': h}); q.route('**/*', block)
            q.on('pageerror', lambda e: errs.append(str(e)[:200])); q.on('dialog', lambda d: d.accept())
            q.goto('file://' + FILE); q.wait_for_timeout(1600); q.evaluate(CLEAN); return q
        pg = newpage()
        def goto(h, wait=380):
            pg.evaluate("location.hash=''"); pg.wait_for_timeout(60); pg.evaluate("h=>{location.hash=h}", h); pg.wait_for_timeout(wait); pg.evaluate(CLEAN); pg.evaluate(NOTOAST)

        title = open(FILE, encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
        rec('M-1 파일 제목 v10.21 이상', bool(re.search(r'v10\.(2[1-9]|[3-9]\d)', title)), title[:90])
        keys = pg.evaluate("Object.keys(__VIEW.screens)")

        # ── A · B ── 카드를 하나씩 눌러 상세와 견줍니다
        seen = {}          # (관, 제목) → 주소
        by_hash = {}       # 주소 → (관, 제목)
        all_cards = 0; bad_fmt = []; bad_text = []; samples = {}
        for g, (code, skey, gname, sid) in GW.items():
            for pname, path in PAGES:
                base = '#/g/' + g + path
                goto(base); src_screen = pg.evaluate("__VIEW.state.screen")
                states = [(None, c) for c in pg.evaluate(CARDS)]
                for j in range(min(pg.evaluate(TABS), 10)):
                    goto(base)
                    try: pg.evaluate(TABCLICK, j); pg.wait_for_timeout(200)
                    except Exception: continue
                    if pg.evaluate("__VIEW.state.screen") != src_screen: continue
                    states += [(j, c) for c in pg.evaluate(CARDS)]
                done = set(); miss = []; n = 0
                for j, c in states:
                    if c['title'] in done: continue
                    goto(base)
                    if j is not None: pg.evaluate(TABCLICK, j); pg.wait_for_timeout(200)
                    now = pg.evaluate(CARDS); hit = next((x for x in now if x['title'] == c['title']), None)
                    if hit is None: continue
                    done.add(c['title']); n += 1
                    pg.evaluate(CLICKCARD, hit['i']); pg.wait_for_timeout(300); pg.evaluate(CLEAN)
                    d = pg.evaluate(DETAIL)
                    why = []
                    if d['screen'] != skey: why.append(f"화면 {d['screen']}")
                    for f, nm in (('title', '제목'), ('cat', '분류'), ('price', '금액'), ('region', '지역')):
                        if norm(d[f]) != norm(hit[f]): why.append(f"{nm} 「{hit[f][:24]}」→「{d[f][:24]}」")
                    if not hit['img'] or d['img'] != hit['img']: why.append('사진 다름')
                    if why: miss.append((c['title'][:20], why[:3]))
                    if not re.fullmatch(r'#/g/%s/l/\d+' % g, d['hash']): bad_fmt.append((c['title'][:16], d['hash']))
                    if d['bad']: bad_text.append((c['title'][:16], d['bad']))
                    key = (g, c['title'])
                    if key in seen and seen[key] != d['hash']: miss.append((c['title'][:20], ['같은 매물인데 주소가 다름', seen[key], d['hash']]))
                    seen.setdefault(key, d['hash'])
                    if d['hash'] in by_hash and by_hash[d['hash']] != key: miss.append((c['title'][:20], ['다른 매물과 주소가 같음', d['hash']]))
                    by_hash.setdefault(d['hash'], key)
                    if d['screen'] == skey and not why: samples.setdefault(g, []).append((d['hash'], hit))
                all_cards += n
                rec(f'A {gname} {pname}({base}) — 카드 {n}장을 하나씩: 제목 · 분류 · 금액 · 지역 · 사진이 상세와 같음', n >= 6 and not miss, miss[:4])
        rec(f'B-1 매물마다 주소가 다르고(서로 다른 매물 {len(seen)}건 → 주소 {len(by_hash)}개), 같은 매물은 랜딩 · 목록 어디서 눌러도 같은 주소', len(seen) >= 44 and len(by_hash) == len(seen), (all_cards, len(seen), len(by_hash)))
        rec('B-2 주소 모양 #/g/{관}/l/{매물번호}', not bad_fmt and len(seen) > 0, bad_fmt[:4])
        # 주소로 바로 열기 — 새 창에서 (관마다 3건)
        q = newpage(); miss = []; n = 0
        for g, lst in samples.items():
            for h, c in lst[1:4]:
                q.evaluate("h=>{location.hash=h}", h); q.wait_for_timeout(350); d = q.evaluate(DETAIL); n += 1
                if not (norm(d['title']) == norm(c['title']) and norm(d['price']) == norm(c['price']) and norm(d['cat']) == norm(c['cat']) and d['img'] == c['img']): miss.append((h, c['title'][:16], d['title'][:16]))
        q.close()
        rec(f'B-3 주소로 바로 열어도(새 창 · {n}건) 같은 매물 — 제목 · 분류 · 금액 · 사진', n >= 9 and not miss, miss[:4])

        # ── C ── 형식
        fm = {}; ids = pg.evaluate("(()=>{const m=__VIEW.meta(); const o={}; for(const k of ['detail','dtlm','dtll']) o[k]=m[k]&&m[k].id; return o})()")
        for g, (code, skey, gname, sid) in GW.items():
            h = samples.get(g, [(None, None)])[min(1, len(samples.get(g, [])) - 1)][0] if samples.get(g) else '#/g/%s/l/1' % g
            goto(h); fm[g] = pg.evaluate(PARTS); fm[g]['screen'] = pg.evaluate("__VIEW.state.screen")
        okc = lambda x: x['dt'] == 1 and x['dtimg'] == 1 and x['dtprof'] == 1 and x['stat'] == 4 and x['dsec'] >= 2 and x['qna'] == 1 and x['qi'] >= 3 and x['revs'] == 3 and x['abar'] == 1 and x['dact'] == 0 and x['table'] == 0
        rec('C-1 세 관의 상세가 같은 틀 — 사진 · 제목 · 소개자 줄 · 실적 4칸 · 상세 설명 · 문의 내용 · 후기 3건 · 맨 아래 줄(표 모양 · 따로 떨어진 버튼 줄 없음)', all(okc(fm[g]) for g in GW), {g: {k: v for k, v in fm[g].items() if k in ('dt', 'dtprof', 'stat', 'qna', 'revs', 'abar', 'dact', 'table')} for g in GW})
        rec('C-2 화면은 관마다 따로 — 소개장터 dtlm · 안심소개 dtll · 소개창업 detail, 화면 ID 그대로', all(fm[g]['screen'] == GW[g][1] for g in GW) and all(ids.get(GW[g][1]) == GW[g][3] for g in GW), (ids, {g: fm[g]['screen'] for g in GW}))
        rec('C-3 돌아가기 · 검색 · 소개자 줄의 「질문하기 · 전화하기」가 세 관 모두 있음', all('돌아가기' in fm[g]['back'] and fm[g]['search'] and [strip(x) for x in fm[g]['prof']] == ['질문하기', '전화하기'] for g in GW), {g: (fm[g]['back'][:20], fm[g]['prof']) for g in GW})

        # ── D ── 맨 아래 줄
        want = ['관심 담기', '질문', '공유하기', '신고', '1:1 문의 시작']
        def bar_ok(x):
            t = [strip(v) for v in x['abtn']]
            return len(t) == 5 and t[0] == '관심 담기' and re.fullmatch(r'질문 \d+', t[1] or '') and t[2] == '공유하기' and t[3] == '신고' and t[4].startswith('1:1 문의 시작')
        rec('D-1 맨 아래 줄이 세 관 모두 「관심 담기 · 질문 N · 공유하기 · 신고 · 1:1 문의 시작」 한 줄', all(bar_ok(fm[g]) for g in GW), {g: fm[g]['abtn'] for g in GW})
        rec('D-2 「지금 바로 문의하기」 · 「♡ 관심 18」은 합쳐져 없음', all(not any('지금 바로 문의하기' in v or re.search(r'관심 \d+', v) for v in fm[g]['abtn']) for g in GW), {g: fm[g]['abtn'] for g in GW})
        acts = {}
        for g, (code, skey, gname, sid) in GW.items():
            h = samples[g][1][0] if len(samples.get(g, [])) > 1 else '#/g/%s/l/1' % g
            a = {}
            goto(h); btn = pg.locator('#screen .abar button')
            if btn.count() == 5:
                btn.nth(0).click(); pg.wait_for_timeout(200); a['like'] = strip(pg.locator('#screen .abar button').nth(0).inner_text()); a['like_toast'] = pg.evaluate(TOAST); pg.evaluate(NOTOAST)
                pg.locator('#screen .abar button').nth(0).click(); pg.wait_for_timeout(200); a['unlike'] = strip(pg.locator('#screen .abar button').nth(0).inner_text()); pg.evaluate(NOTOAST)
                y0 = pg.evaluate("scrollY"); pg.locator('#screen .abar button').nth(1).click(); pg.wait_for_timeout(500); a['q_scroll'] = pg.evaluate("(()=>{const e=document.getElementById('qsec'); if(!e) return null; const r=e.getBoundingClientRect(); return r.top>=-5 && r.top<innerHeight})()"); a['q_same'] = pg.evaluate("__VIEW.state.screen") == skey
                pg.locator('#screen .abar button').nth(2).click(); pg.wait_for_timeout(250); a['share'] = bool(pg.evaluate(TOAST)) or pg.evaluate("document.querySelectorAll('.modal.on,.mask.on,.sheet.on,.shr.on,.shm').length") > 0; pg.keyboard.press('Escape'); pg.evaluate(NOTOAST)
                goto(h); pg.locator('#screen .abar button').nth(3).click(); pg.wait_for_timeout(250); a['report'] = pg.evaluate(TOAST); a['report_same'] = pg.evaluate("__VIEW.state.screen") == skey; pg.evaluate(NOTOAST)
                goto(h); pg.locator('#screen .abar button').nth(4).click(); pg.wait_for_timeout(350); a['ask'] = pg.evaluate("__VIEW.state.screen")
            acts[g] = a
        rec('D-3 「관심 담기」를 누르면 「관심 담김」으로 바뀌고, 다시 누르면 돌아옴', all(acts[g].get('like') == '관심 담김' and acts[g].get('unlike') == '관심 담기' for g in GW), {g: (acts[g].get('like'), acts[g].get('unlike')) for g in GW})
        rec('D-4 「질문 N」은 문의 내용 자리로 내려감 · 「공유하기」는 공유 안내가 뜸', all(acts[g].get('q_scroll') and acts[g].get('q_same') and acts[g].get('share') for g in GW), {g: (acts[g].get('q_scroll'), acts[g].get('share')) for g in GW})
        rec('D-5 「신고」를 누르면 접수 안내가 뜨고 화면은 그대로', all('신고' in (acts[g].get('report') or '') and acts[g].get('report_same') for g in GW), {g: acts[g].get('report') for g in GW})
        rec('D-6 「1:1 문의 시작」을 누르면 문의방으로 감', all(acts[g].get('ask') == 'ask' for g in GW), {g: acts[g].get('ask') for g in GW})

        # ── E ── 관별 안내
        tx = {}
        for g in GW:
            goto(samples[g][1][0] if len(samples.get(g, [])) > 1 else '#/g/%s/l/1' % g); tx[g] = pg.inner_text('#screen')
        rec('E-1 안심소개 상세 — 「이 매물 소개하기」(소개코드 공유) 상자와 부동산 노출료 안내가 그대로 있음', '이 매물 소개하기' in tx['mal'] and '노출료' in tx['mal'] and '이 매물 소개하기' not in tx['mny'] and '이 매물 소개하기' not in tx['biz'], ('이 매물 소개하기' in tx['mal'], '노출료' in tx['mal']))
        rec('E-2 소개장터 상세 — 「소개비는 요율표로 산정하지 않습니다」 안내가 그대로 있음', '요율표로 산정하지 않습니다' in tx['mny'], '')
        rec('E-3 세 관 모두 — 「1:1 대화가 시작되는 순간 소개코드가 발급」 귀속 안내', all('1:1 대화가 시작되는 순간' in tx[g] for g in GW), {g: '1:1 대화가 시작되는 순간' in tx[g] for g in GW})

        # ── F ── 마이 관심
        goto('#/my/likes'); rows = pg.evaluate("""()=>[...document.querySelectorAll('#screen table tbody tr')].map((tr,i)=>({i, g:(tr.querySelector('.gt')||{}).innerText||'', t:(tr.querySelector('b')||{}).innerText||'', id:(tr.querySelector('.ls')||{}).innerText||''}))""")
        NAME2 = {'소개장터': ('mny', 'dtlm'), '안심소개': ('mal', 'dtll'), '소개창업': ('biz', 'detail')}
        miss = []
        for r in rows:
            goto('#/my/likes'); pg.locator('#screen table tbody tr').nth(r['i']).get_by_text('보기', exact=True).click(); pg.wait_for_timeout(320)
            d = pg.evaluate(DETAIL); g, sk = NAME2.get(norm(r['g']), ('?', '?')); num = re.sub(r'\D', '', r['id'])
            if not (d['screen'] == sk and norm(d['title']) == norm(r['t']) and d['hash'] == f'#/g/{g}/l/{num}'): miss.append((r['g'], r['t'][:14], d['screen'], d['hash'], d['title'][:14]))
        rec(f'F-1 마이 「관심」 {len(rows)}건의 「보기」 — 항목의 관에 맞는 상세로, 그 항목의 제목 · 번호로 열림', len(rows) >= 4 and not miss, miss)
        rec('F-2 관심 목록에 세 관이 다 있음(소개창업 · 안심소개 · 소개장터)', {norm(r['g']) for r in rows} >= {'소개창업', '안심소개', '소개장터'}, [r['g'] for r in rows])

        # ── G ── 문의방 왕복
        for g, (code, skey, gname, sid) in GW.items():
            h, c = samples[g][2] if len(samples.get(g, [])) > 2 else ('#/g/%s/l/1' % g, {'title': '', 'price': ''})
            res = {}
            goto(h)
            if pg.locator('#screen .abar button').count() == 0 or pg.locator('#screen .dtprof button').count() == 0:
                rec(f'G {gname} — 상세에 맨 아래 줄 · 소개자 줄이 없어 왕복을 볼 수 없음', False, h); continue
            pg.locator('#screen .abar button').last.click(); pg.wait_for_timeout(350)
            res['ask'] = pg.evaluate("__VIEW.state.screen"); bar = pg.evaluate("(()=>{const e=document.querySelector('#screen .askbar'); return e?(e.innerText||'').replace(/\\s+/g,' '):''})()")
            res['bar'] = norm(c['title']) in bar and norm(c['price']) in bar
            ct = pg.inner_text('#screen')
            res['side'] = ('거래금액 ' + norm(c['price']) + ' 기준') in re.sub(r'\s+', ' ', ct)
            res['no_sample_text'] = ('고깃집' in c['title']) or not any(x in ct for x in ['강남 고깃집 문의', '1,275,000원', '8,500만원 선에서'])
            lk = pg.locator('#screen .askbar .lk')
            if lk.count(): lk.click(); pg.wait_for_timeout(350)
            d = pg.evaluate(DETAIL); res['lk'] = (d['hash'] == h and norm(d['title']) == norm(c['title']))
            goto(h); pg.locator('#screen .dtprof button').first.click(); pg.wait_for_timeout(350); res['ask2'] = pg.evaluate("__VIEW.state.screen")
            bk = pg.locator('#screen .bkl'); res['back_label'] = bk.inner_text() if bk.count() else ''
            if bk.count(): bk.click(); pg.wait_for_timeout(400)
            d = pg.evaluate(DETAIL); res['back'] = (d['hash'] == h and norm(d['title']) == norm(c['title']))
            rec(f'G {gname} — 상세 → 「1:1 문의 시작」: 문의방 위쪽에 그 매물의 제목 · 금액, 「리스팅 보기」와 「돌아가기」 모두 처음 매물로({h})', res['ask'] == 'ask' and res['ask2'] == 'ask' and res['bar'] and res['lk'] and res['back'], res)
            rec(f'G {gname} — 문의방의 대화 · 예상 소개비 상자가 그 매물 기준(고깃집 견본 대화 · 1,275,000원이 다른 매물에 나오지 않음)', res.get('side') and res.get('no_sample_text'), res)
            rec(f'G {gname} — 문의방의 돌아가기 글에 옛 이름(소개머니 · 소개몰)이 없음', res['back_label'] and '소개머니' not in res['back_label'] and '소개몰' not in res['back_label'], res['back_label'])
        goto('#/chat/8821'); lk = pg.locator('#screen .askbar .lk')
        if lk.count(): lk.click(); pg.wait_for_timeout(350)
        d = pg.evaluate(DETAIL)
        rec('G-7 매물 없이 연 문의방(#/chat/8821)의 「리스팅 보기」는 견본 매물(소개창업 고깃집)로 감', d['screen'] == 'detail' and '특A급 프리미엄 고깃집' in d['title'], (d['screen'], d['hash'], d['title'][:20]))

        # ── H ── 견본 · 없는 번호
        want = {'#/g/biz/l/1042': ('detail', '특A급 프리미엄 고깃집'), '#/g/mny/l/4471': ('dtlm', '강남 소재 프랜차이즈 본사 식자재 공급처'), '#/g/mal/l/4468': ('dtll', '수도권 물류창고 3,300㎡ 임대 이전 건')}
        miss = []
        for h, (sk, t) in want.items():
            goto(h); d = pg.evaluate(DETAIL)
            if not (d['screen'] == sk and t in d['title']): miss.append((h, d['screen'], d['title'][:20]))
        rec('H-1 앞 판의 견본 주소 3개는 그대로 — 소개창업 고깃집 · 소개장터 식자재 공급처 · 안심소개 물류창고', not miss, miss)
        goto('#/g/biz/l/1042'); t = pg.inner_text('#screen')
        rec('H-2 소개창업 견본(그림 1)의 본문은 그대로 — 설명 · 조건표 · 문의 7건 · 후기', all(x in t for x in ['강남 핵심 상권에 위치한 프리미엄 고깃집', '99.2㎡ (약 30평)', '8,000만원 내외', '초보자도 창업 가능한가요?', '김사장', '소개자 실적', '누적수익']) and pg.locator('#screen .qna .qi').count() == 7, [x for x in ['강남 핵심 상권에 위치한 프리미엄 고깃집', '99.2㎡ (약 30평)', '초보자도 창업 가능한가요?', '김사장'] if x not in t])
        miss = []
        for g, (code, skey, gname, sid) in GW.items():
            goto('#/g/%s/l/99999999' % g); d = pg.evaluate(DETAIL)
            if not (d['screen'] == skey and d['title'] and not d['bad']): miss.append((g, d['screen'], d['title'][:16], d['bad']))
        rec('H-3 없는 번호(#/g/{관}/l/99999999)는 그 관의 견본 매물이 열림(빈 화면 · 깨진 글자 없음)', not miss, miss)

        # ── I ── 내용
        miss = []
        for g in GW:
            for h, c in samples.get(g, [])[:6]:
                if '고깃집' in c['title']: continue
                goto(h, 260); t = pg.inner_text('#screen')
                if any(x in t for x in ['강남 핵심 상권에 위치한 프리미엄 고깃집', '초보자도 창업 가능한가요?', '인수 후 운영 지원도 가능한가요?', '99.2㎡']): miss.append((h, c['title'][:16]))
        rec('I-1 견본이 아닌 매물의 상세에 고깃집 견본 글(설명 · 조건표 · 질문)이 나오지 않음', not miss, miss[:4])
        rec('I-2 눌러 본 상세 전부 — 깨진 글자(undefined · NaN) 0', not bad_text, bad_text[:4])
        goto(samples['mny'][0][0] if samples.get('mny') else '#/g/mny/l/1'); t = pg.inner_text('#screen'); c = samples['mny'][0][1] if samples.get('mny') else {'cat': '?', 'price': '?', 'region': '?'}
        rec('I-3 상세 설명 · 조건표에 넘겨받은 분류 · 지역 · 금액이 들어 있음', pg.evaluate("(()=>{const e=document.querySelector('#screen .dsec'); return e?e.innerText:''})()").count(c['price']) >= 1 and c['region'] in pg.evaluate("(()=>{const e=document.querySelector('#screen .dsec'); return e?e.innerText:''})()"), (c['price'], c['region']))

        # v10.23 — 소개광장이 제시 디자인으로 바뀌어 제목(.plz-post h1) · 돌아가기(.plz-back)의 자리가 달라졌습니다. 보는 내용은 같습니다
        # ── K ── 소개광장 글 목록 → 글 상세 (목록표 E-05)
        goto('#/community'); sc = pg.evaluate("__VIEW.state.screen")
        posts = pg.evaluate("()=>[...document.querySelectorAll('#screen table tbody tr')].map((tr,i)=>{const a=tr.querySelector('a[href]'); const td=[...tr.querySelectorAll('td')].map(x=>(x.innerText||'').trim()); return {i, link:a?(a.innerText||'').trim():'', href:a?a.getAttribute('href'):'', cat:td[1]||'', who:td[2]||''}})")
        rec(f'K-1 소개광장(#/community) 글 목록에 글 {len(posts)}건이 보이고 제목마다 글 상세 링크가 있음', sc == 'cmu' and len(posts) >= 6 and all(x['link'] and x['href'] for x in posts), (sc, len(posts), [x['href'] for x in posts][:3]))
        miss = []; hs = set()
        for x in posts:
            goto('#/community'); pg.locator('#screen table tbody tr').nth(x['i']).locator('a[href]').click(); pg.wait_for_timeout(320)
            t = pg.evaluate("(()=>{const sc=document.getElementById('screen'); const h=sc.querySelector('.plz-post h1, .wrap h1, .wrap h2'); return {s:__VIEW.state.screen, h:location.hash, t:h?(h.innerText||'').trim():'', body:sc.innerText.slice(0,1500)}})()")
            hs.add(t['h'])
            if not (t['s'] == 'cmud' and norm(x['link']) in norm(t['t']) and x['who'] in t['body'] and x['cat'] in t['body']): miss.append((x['link'][:16], t['s'], t['h'], t['t'][:16]))
        rec(f'K-2 글 {len(posts)}건을 하나씩 — 누른 글의 제목 · 분류 · 작성자로 글 상세가 열리고 주소가 글마다 다름', len(posts) >= 6 and not miss and len(hs) == len(posts), (miss[:3], len(hs)))
        if len(posts) >= 3 and posts[2]['href']:
            q = newpage(); q.evaluate("h=>{location.hash=h}", posts[2]['href']); q.wait_for_timeout(400)
            t3 = q.evaluate("(()=>{const h=document.querySelector('#screen .plz-post h1, #screen .wrap h1, #screen .wrap h2'); return h?(h.innerText||'').trim():''})()")
            bk = q.locator('#screen .plz-back, #screen .bkl'); bk.click() if bk.count() else None; q.wait_for_timeout(350); back_sc = q.evaluate("__VIEW.state.screen"); q.close()
            rec('K-3 글 주소로 바로 열어도 그 글이 열림', norm(posts[2]['link']) in norm(t3), (posts[2]['href'], t3[:20]))
        else:
            rec('K-3 글 주소로 바로 열어도 그 글이 열림', False, '글 링크 없음')
        goto('#/community'); a0 = pg.locator('#screen table tbody tr a[href]')
        if a0.count():
            a0.first.click(); pg.wait_for_timeout(300); pg.locator('#screen .plz-back').click(); pg.wait_for_timeout(350)   # v10.23 — 소개광장의 돌아가기는 「← 목록으로」 단추
        rec('K-4 글 상세의 돌아가기 — 소개광장 글 목록으로', a0.count() > 0 and pg.evaluate("__VIEW.state.screen") == 'cmu', pg.evaluate("__VIEW.state.screen"))

        # ── L ── 누적수익 공개 설정 (10/7 답 「본인이 켠 경우만 공개」)
        goto('#/my/account'); box = pg.locator('#screen input[name=earningsPublic]')
        t0 = pg.inner_text('#screen')
        rec('L-1 마이 > 프로필 · 사업자 정보에 「누적수익 공개」 선택 칸 — 기본은 꺼짐 · 설명 글', box.count() == 1 and not box.is_checked() and '누적수익 공개' in t0 and '소개자 실적' in t0, box.count())
        if box.count():
            box.check(); pg.locator('#screen [data-earnsave]').click(); pg.wait_for_timeout(250)
        ts = pg.evaluate(TOAST); pg.evaluate(NOTOAST)
        goto('#/my'); goto('#/my/account')
        rec('L-2 켜고 저장하면 안내가 뜨고, 다른 화면에 다녀와도 켜진 채', '공개' in ts and pg.locator('#screen input[name=earningsPublic]').count() == 1 and pg.locator('#screen input[name=earningsPublic]').is_checked(), ts)
        goto('#/g/biz/l/1042'); tip = pg.evaluate("(()=>{const c=[...document.querySelectorAll('#screen .stat > div')].find(e=>e.innerText.includes('누적수익')); return c?(c.getAttribute('title')||''):''})()")
        rec('L-3 상세의 누적수익 칸에 「소개자가 공개를 켠 경우에만 보입니다」 설명', '공개' in tip and '켠 경우' in tip, tip)

        # ── J ── 그 밖
        miss = []
        for g, (code, skey, gname, sid) in GW.items():
            for pname, path, want_sc in (('랜딩', '', {'mny': 'list', 'mal': 'listl', 'biz': 'listb'}[g]), ('전체 목록', '/list', {'mny': 'lstm', 'mal': 'lstl2', 'biz': 'lstb2'}[g])):
                goto('#/g/' + g + path); pg.evaluate(CLICKCARD, 1); pg.wait_for_timeout(300)
                bk = pg.locator('#screen .bkl')
                if not bk.count(): miss.append((g, pname, '돌아가기 없음')); continue
                bk.click(); pg.wait_for_timeout(350); s = pg.evaluate("__VIEW.state.screen")
                if s != want_sc: miss.append((g, pname, s))
        rec('J-1 상세의 돌아가기 — 눌러 들어온 랜딩 · 전체 목록으로 돌아감(세 관)', not miss, miss)
        ow = {}
        pg.set_viewport_size({'width': 390, 'height': 800})
        for g in GW:
            goto(samples[g][1][0] if len(samples.get(g, [])) > 1 else '#/g/%s/l/1' % g); ow[g] = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        pg.set_viewport_size({'width': 1500, 'height': 900})
        rec('J-2 390px — 세 관 상세 모두 문서 가로 스크롤 0', all(v <= 1 for v in ow.values()), ow)
        rec(f'J-3 화면 수 {len(keys)}장 — 매물 상세 · 문의방 화면은 그대로(v10.21 때 189장 · v10.22 에서 소개창업 축의 상세 4장 · v10.24 에서 상담 업종 상세 1장 · v10.26 에서 운영 「소개몰 상품」 1장 · v10.27 에서 약관 전문 1장 · G-130 새 화면 7장이 늘어 203장 · v10.28 에서 운영 「소개몰 주문」 · 「소개몰 리뷰 · 문의」 · 약관 동의 · 재동의 3장이 늘어 206장) · v10.31 시안 키 5장(admdspt 분쟁 처리 · dspu 분쟁 접수 · qna 공개 문의 · terms 약관 · verify 본인 · 사업자 인증) = 211', len(keys) == 211 and all(k in keys for k in ('admdspt', 'dspu', 'qna', 'terms', 'verify')) and 'termsv' in keys and all(k in keys for k in ('detail', 'dtlm', 'dtll', 'ask')), len(keys))
        for g in GW:
            goto(samples[g][1][0] if len(samples.get(g, [])) > 1 else '#/g/%s/l/1' % g); pg.screenshot(path=os.path.join(OUT, f'proto_item_{g}.png'), full_page=True)
        rec('J-4 그리는 중 오류 0', not errs, errs[:3])
        b.close()

if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_item.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
