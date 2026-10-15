"""시안 v10.24 — 안심소개 「생활 · 금융 상담」: 축 주소 · 목록 · 업종 상세(새 화면) · 신청서 · 접수. 파일(file://)로 열어 실제로 눌러 봅니다. 결과: proto_fin.json

  10/7 지시 — 「안심소개 → 생활금융 부분(리스트 및 상세 보기 · 상담하기) 등을 작동 가능하게 · 디자인 모두 적용 · 시안 및 개발 적용」
  답 — ① 상세 보기 = 업종 상세  ② 디자인 = 지금 안심소개 모양으로 다듬기  ③ 준비 중 업종 = 규칙 그대로 + 시험용 업체

  A. 축 주소     안심소개의 세 축이 주소를 가짐(#/g/mal · /realty · /consult) · 새로 열어도 그 축 · 다른 화면에 갔다 와도 그 축
  B. 목록        22줄 · 줄마다 「상세 보기」 + 「상담 신청」(법률 · 세무는 「사무소 보기」) · 단추가 늘어나지 않음
  C. 업종 상세   20업종을 하나씩 눌러 그 업종의 상세 · 주소 20개 · 구성(표시 · 요약 세 칸 · 받는 지역 · 진행 순서 · 알아 둘 것 · 맨 아래 줄)
  D. 신청서      입력 칸 모양 · 검증 5가지 → 접수 · 돌아가기
  E. 법률 · 세무  사무소 목록(광고) 그대로
  F. 그 밖       화면 수 · 업종 고르기 화면 · 390px · 오류 0
  G. 같은 결함   작은 링크 단추가 늘어나던 것(전 화면) · 운영 화면의 입력 칸

사용:  python3 proto_fin.py       PROTO=/path/proto.html (기본 킷의 spec/proto.html)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
SHOT = os.environ.get('SHOT', '')
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
ST = "()=>({screen:__VIEW.state.screen, hash:location.hash, axis:((document.querySelector('#screen .axt.on b')||{}).textContent||'').trim(), h1:((document.querySelector('#screen h1')||{}).innerText||'').trim()})"
ROWS = """()=>[...document.querySelectorAll('#screen .axrows .axrow')].map(e=>{const t=s=>{const x=e.querySelector(s); return x?(x.innerText||'').replace(/\\s+/g,' ').trim():''};
  return {code:e.getAttribute('data-csl')||'', badge:t('.axb'), name:t('.axl b'), sub:t('.axl .ls'), nameHref:(e.querySelector('.axl b a')||{getAttribute(){return null}}).getAttribute('href'),
          btns:[...e.querySelectorAll('.axr a, .axr button')].map(a=>[(a.innerText||'').trim(), a.getAttribute('href'), Math.round(a.getBoundingClientRect().width), !!a.disabled])}})"""
DET = """()=>{const sc=document.getElementById('screen'), d=sc.querySelector('.cslD'); const t=s=>{const x=sc.querySelector(s); return x?(x.innerText||'').replace(/\\s+/g,' ').trim():''}; const tx=sc.innerText||'';
  return {screen:__VIEW.state.screen, hash:location.hash, code:d?d.getAttribute('data-csl'):'', title:t('.cslD .dtt'), sub:t('.cslD .dtsub'), badges:[...sc.querySelectorAll('.cslD .axdhl .axb')].map(e=>e.innerText.trim()),
    cells:[...sc.querySelectorAll('.cslD .csls .cell')].map(c=>[(c.querySelector('.k')||{}).innerText||'', (c.querySelector('.v')||{}).innerText||'']),
    regs:[...sc.querySelectorAll('.cslD .cslreg li')].map(li=>li.innerText.replace(/\\s+/g,' ').trim()), steps:[...sc.querySelectorAll('.cslD .nsteps li b')].map(e=>e.innerText.trim()),
    notes:[...sc.querySelectorAll('.cslD .axul li')].map(e=>e.innerText.trim()), go:(sc.querySelector('.cslD .abar a.go')||{getAttribute(){return null}}).getAttribute('href'),
    list:(sc.querySelector('.cslD .abar a.bo')||{getAttribute(){return null}}).getAttribute('href'), back:t('.bkl'), id:t('.cslD .dtno'),
    bad:[...new Set((tx.match(/undefined|NaN|\\[object Object\\]/g)||[]))], sample:/시연/.test(tx)}}"""
CSS = "([sel, prop]) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null }"
px = lambda v: float(re.sub(r'[^0-9.]', '', v or '0') or 0)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        def go(h, wait=500):
            pg.goto('file://' + FILE + h); pg.wait_for_timeout(wait); pg.evaluate(CLEAN)
        def shot(name, full=True):
            if SHOT: os.makedirs(SHOT, exist_ok=True); pg.evaluate(CLEAN); pg.screenshot(path=f'{SHOT}/{name}.png', full_page=full)
        def tab(name):
            pg.locator('#screen .axt', has_text=name).first.click(); pg.wait_for_timeout(350); pg.evaluate(CLEAN)

        go('#/g/mal', 1500)
        cats = pg.evaluate("window.__LEADCAT")
        lead = [c for c in cats if c[5] != 'dir']; dirs = [c for c in cats if c[5] == 'dir']

        # ── A ── 축 주소
        s0 = pg.evaluate(ST); tab('생활 · 금융 상담'); s1 = pg.evaluate(ST)
        rec('A-1 축 탭 「생활 · 금융 상담」 → 주소가 #/g/mal/consult', s0['axis'] == '기계 · 설비 · 시설' and s1['hash'] == '#/g/mal/consult' and s1['axis'] == '생활 · 금융 상담', (s0, s1))
        pg.reload(); pg.wait_for_timeout(1200); pg.evaluate(CLEAN); s2 = pg.evaluate(ST)
        rec('A-2 그 주소에서 새로 고침 → 그대로 「생활 · 금융 상담」 축(전에는 「기계 · 설비 · 시설」로 돌아감)', s2['hash'] == '#/g/mal/consult' and s2['axis'] == '생활 · 금융 상담', s2)
        tab('부동산'); s3 = pg.evaluate(ST); tab('기계 · 설비 · 시설'); s4 = pg.evaluate(ST)
        rec('A-3 「부동산」 → #/g/mal/realty · 「기계 · 설비 · 시설」 → #/g/mal', s3['hash'] == '#/g/mal/realty' and s3['axis'] == '부동산' and s4['hash'] == '#/g/mal' and s4['axis'] == '기계 · 설비 · 시설', (s3, s4))
        res = []
        for h, ax in (('#/g/mal/consult', '생활 · 금융 상담'), ('#/g/mal/realty', '부동산'), ('#/g/mal', '기계 · 설비 · 시설'), ('#/g/mal/consult', '생활 · 금융 상담'), ('#/g/mal', '기계 · 설비 · 시설')):
            go(h, 900); s = pg.evaluate(ST); res.append((h, s['screen'], s['axis'], s['axis'] == ax and s['screen'] == 'listl'))
        rec('A-4 주소 세 개를 바로 열면 그 축 · 상담 축을 본 뒤 #/g/mal 을 열면 기계 · 설비 축(앞에서 본 축이 남지 않음)', all(x[3] for x in res), res)
        go('#/g/mal/consult', 900); pg.locator('#screen button.mylist', has_text='소개합니다').click(); pg.wait_for_timeout(400); sa = pg.evaluate(ST)
        pg.locator('#screen .bkl').first.click(); pg.wait_for_timeout(500); sb = pg.evaluate(ST)
        rec('A-5 상담 축에서 「✚ 소개합니다」에 갔다가 돌아오면 다시 상담 축(#/g/mal/consult)', sa['screen'] == 'malgive' and sb['hash'] == '#/g/mal/consult' and sb['axis'] == '생활 · 금융 상담', (sa, sb))

        # ── B ── 목록
        go('#/g/mal/consult', 900); rows = pg.evaluate(ROWS); bad = []
        for r in rows:
            c = next((x for x in cats if x[0] == r['code']), None)
            if not c: bad.append((r['code'], '모르는 업종')); continue
            got = [[x[0], x[1]] for x in r['btns']]
            want = [['사무소 보기', f'#/mal/consult/{c[0]}']] if c[5] == 'dir' else [['상세 보기', f'#/mal/consult/{c[0]}'], ['상담 신청', f'#/mal/consult/{c[0]}/apply']]
            if got != want or r['name'] != c[1]: bad.append((r['code'], got))
        rec(f'B-1 줄 {len(cats)}개 — 리드형 20줄은 「상세 보기」(→ #/mal/consult/코드) + 「상담 신청」(→ …/apply) · 법률 · 세무는 「사무소 보기」', len(rows) == len(cats) == 22 and not bad, (len(rows), bad[:3]))
        rec('B-2 업종 이름을 눌러도 그 업종의 상세로 감', all(r['nameHref'] == f"#/mal/consult/{r['code']}" for r in rows) and len(rows) > 0, [(r['code'], r['nameHref']) for r in rows][:3])
        ws = sorted({x[2] for r in rows for x in r['btns']})
        pad = px(pg.evaluate(CSS, ['#screen .cslL', 'paddingLeft']))
        rec('B-3 단추가 막대처럼 늘어나지 않음(폭 80 ~ 120px · 전에는 195px) · 상자 안쪽 여백이 있음(전에는 0)', bool(ws) and 80 <= ws[0] and ws[-1] <= 120 and pad >= 14, (ws, pad))
        shot('proto_list')

        # ── C ── 업종 상세
        hashes = []; bad = []; sample = None
        for c in lead:
            go('#/g/mal/consult', 350)
            pg.locator(f'#screen .axrow[data-csl="{c[0]}"] .axr a', has_text='상세 보기').click(); pg.wait_for_timeout(300); d = pg.evaluate(DET); hashes.append(d['hash'])
            ok = d['screen'] == 'malcsld' and d['hash'] == f'#/mal/consult/{c[0]}' and d['code'] == c[0] and d['title'] == c[1] and d['sub'] == c[3] and d['cells'][:1] == [['받을 수 있는 인증업체', f'{c[4]}곳']] and not d['bad']
            if not ok: bad.append((c[0], d['screen'], d['hash'], d['title'], d['cells'][:1], d['bad']))
            if c[0] == 'CSL_MOVING': sample = d
        rec('C-1 리드형 20줄의 「상세 보기」를 하나씩 눌러 — 그 업종의 상세(이름 · 설명 · 인증업체 수가 그 줄과 같음) · 깨진 글자 없음', len(lead) == 20 and not bad, bad[:3])
        rec('C-2 상세 주소가 업종마다 다름(20개)', len(set(hashes)) == 20, len(set(hashes)))
        res = []
        for code in ('CSL_INSURANCE', 'CSL_CLEANING', 'CSL_TRADE'):
            go(f'#/mal/consult/{code}', 900); d = pg.evaluate(DET); c = next(x for x in cats if x[0] == code); res.append((code, d['screen'], d['title'] == c[1], d['id']))
        rec('C-3 주소로 바로 열어도 그 업종의 상세 · 화면 번호 SB-MAL-CSL-025', all(x[1] == 'malcsld' and x[2] and 'SB-MAL-CSL-025' in x[3] for x in res), res)
        go('#/g/mal/consult', 400); pg.locator('#screen .axrow[data-csl="CSL_MOVING"] .axr a', has_text='상세 보기').click(); pg.wait_for_timeout(300); d = pg.evaluate(DET); mv = next(x for x in cats if x[0] == 'CSL_MOVING')
        rec('C-4 구성 — 표시(자격 확인 + 상담신청형) · 요약 세 칸 · 받는 지역 · 진행 순서 3단계 · 알아 둘 것(1곳에만 전달) · 「시연」 표시',
            d['badges'] == ['자격 확인', '상담신청형'] and [x[0] for x in d['cells']] == ['받을 수 있는 인증업체', '받는 지역', '신청 정보 전달'] and d['cells'][1][1] == f"{len(d['regs'])}곳" and d['cells'][2][1] == '1곳에만'
            and len(d['regs']) >= 1 and len(d['steps']) == 3 and '상담 신청' in d['steps'][0] and '휴대폰 확인' in d['steps'][1] and '연락' in d['steps'][2] and len(d['notes']) >= 4 and '1곳에만 전달' in ' '.join(d['notes']) and d['sample'], d)
        rec('C-5 맨 아래 줄 — 「상담 신청」(→ #/mal/consult/CSL_MOVING/apply) · 「목록으로」(→ #/g/mal/consult)', d['go'] == '#/mal/consult/CSL_MOVING/apply' and d['list'] == '#/g/mal/consult', (d['go'], d['list']))
        shot('proto_detail')
        pg.locator('#screen .bkl').first.click(); pg.wait_for_timeout(450); s = pg.evaluate(ST)
        go('#/mal/consult/CSL_MOVING', 900); bk = norm(pg.inner_text('#screen .bkl')); pg.locator('#screen .bkl').first.click(); pg.wait_for_timeout(450); s2 = pg.evaluate(ST)
        rec('C-6 돌아가기 — 목록에서 들어왔으면 상담 축으로 · 주소로 바로 열었어도 「생활 · 금융 상담」으로(전에는 「메인」)', s['hash'] == '#/g/mal/consult' and s['axis'] == '생활 · 금융 상담' and '생활 · 금융 상담' in bk and s2['hash'] == '#/g/mal/consult' and s2['axis'] == '생활 · 금융 상담', (s, bk, s2))
        go('#/mal/consult/CSL_NOPE', 900); t = norm(pg.inner_text('#screen'))
        rec('C-7 없는 업종의 주소 — 안내와 목록으로 가는 길 · 깨진 글자 없음', '없는 업종' in t and pg.locator('#screen a[href="#/g/mal/consult"]').count() >= 1 and not re.search(r'undefined|NaN', t), t[:160])
        pg.evaluate("(()=>{location.hash=''})()"); pg.wait_for_timeout(400); pg.evaluate("__VIEW.paint('malcsld')"); pg.wait_for_timeout(200); d8 = pg.evaluate(DET)      # 주소를 먼저 비우고(주소가 바뀌면 화면을 다시 그리므로 기다린 뒤) 화면만 엽니다
        t8 = {'d': d8['screen'] == 'malcsld' and bool(d8['code']), 'h': d8['title'], 'go': pg.evaluate("(document.querySelector('#screen .cslD a[href$=\"/apply\"]')||{getAttribute(){return ''}}).getAttribute('href')"), 't': pg.inner_text('#screen')}
        rec('C-8 주소 없이 화면만 열어도(점검 도구 · 화면 목록) 첫 업종의 상세가 보임 — 「없는 업종」 안내가 아님(소개창업 축 상세 4종과 같은 규칙)', t8['d'] and bool(t8['h']) and t8['go'].endswith('/apply') and '없는 업종' not in t8['t'], (t8['d'], t8['h'], t8['go']))

        # ── D ── 신청서
        go('#/mal/consult/CSL_MOVING', 900); pg.locator('#screen .cslD .abar a.go').click(); pg.wait_for_timeout(400); s = pg.evaluate(ST)
        rec('D-1 상세의 「상담 신청」 → 신청서(#/mal/consult/CSL_MOVING/apply · 제목 「이사짐 상담 신청」)', s['screen'] == 'malcsl' and s['hash'] == '#/mal/consult/CSL_MOVING/apply' and s['h1'] == '이사짐 상담 신청' and pg.locator('#csl-name').count() == 1, s)
        st = {k: pg.evaluate(CSS, ['#csl-name', k]) for k in ('height', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius', 'paddingLeft')}
        st2 = {k: pg.evaluate(CSS, [f'#csl-{k}', 'height']) for k in ('tel', 'area', 'memo')}
        ag = (pg.evaluate(CSS, ['#screen .cslf .chk b', 'fontSize']), pg.evaluate(CSS, ['#screen .cslf .chk b', 'fontWeight']))
        pad = px(pg.evaluate(CSS, ['#screen .cslP', 'paddingLeft']))
        rec('D-2 입력 칸 모양 — 높이 38px 이상 · 테두리 1px 실선 · 둥근 모서리 6px 이상 · 안쪽 여백(전에는 브라우저 기본 모양 21px) · 상자 여백 · 동의 문구 굵은 글씨 14px 이하',
            px(st['height']) >= 38 and st['borderTopWidth'] == '1px' and st['borderTopStyle'] == 'solid' and px(st['borderTopLeftRadius']) >= 6 and px(st['paddingLeft']) >= 8 and px(st2['tel']) >= 38 and px(st2['area']) >= 38 and px(st2['memo']) >= 70
            and pad >= 14 and px(ag[0]) <= 14 and int(ag[1] or 0) <= 700, (st, st2, ag, pad))
        shot('proto_apply')
        err = lambda: norm(pg.inner_text('#screen .cslerr')) if pg.locator('#screen .cslerr').count() else ''
        sub = lambda: (pg.locator('#screen [data-csl-submit]').click(), pg.wait_for_timeout(200))
        seq = []
        sub(); seq.append(err())
        pg.fill('#csl-name', '김시안'); pg.fill('#csl-tel', '010-1234-5678'); sub(); seq.append(err())
        if pg.locator('#csl-mail').count(): pg.fill('#csl-mail', 'kim@example.com'); sub(); seq.append(err())      # v10.28 — 이메일(필수 · 지시서 4절)
        pg.locator('#screen [data-csl-otp]').click(); pg.wait_for_timeout(200); sub(); seq.append(err())
        pg.select_option('#csl-area', index=1); sub(); seq.append(err())
        pg.check('#csl-agree'); sub(); pg.wait_for_timeout(200); s = pg.evaluate(ST); t = norm(pg.inner_text('#screen'))
        rec('D-3 검증 5가지(이름 · 이메일(v10.28) · 휴대폰 확인 · 지역 · 동의)를 차례로 막고, 다 채우면 접수 화면(SB-MAL-CSL-040 · 접수번호)',
            seq == ['이름을 적어 주십시오.', '이메일을 확인해 주십시오 (예: name@example.com).', '휴대폰 확인을 먼저 해 주십시오.', '지역을 골라 주십시오.', '개인정보 제3자 제공에 동의해야 신청할 수 있습니다.'] and s['h1'] == '상담 신청 접수' and 'SB-MAL-CSL-040' in t and re.search(r'접수번호 C-\d{6}-\d{4}', t), (seq, s['h1']))
        shot('proto_done')
        pg.locator('#screen a, #screen button', has_text='안심소개로').first.click(); pg.wait_for_timeout(450); s = pg.evaluate(ST)
        rec('D-4 접수 화면의 「안심소개로」 → 상담 축(#/g/mal/consult)', s['hash'] == '#/g/mal/consult' and s['axis'] == '생활 · 금융 상담', s)
        go('#/mal/consult/CSL_MOVING/apply', 900); bk = norm(pg.inner_text('#screen .bkl')); pg.locator('#screen .bkl').first.click(); pg.wait_for_timeout(450); s = pg.evaluate(ST)
        rec('D-5 신청서의 돌아가기 — 그 업종의 상세로(「이사짐」)', '이사짐' in bk and s['hash'] == '#/mal/consult/CSL_MOVING' and s['screen'] == 'malcsld', (bk, s))
        go('#/g/mal/consult', 400); pg.locator('#screen .axrow[data-csl="CSL_CLEANING"] .axr a', has_text='상담 신청').click(); pg.wait_for_timeout(350); s = pg.evaluate(ST)
        rec('D-6 목록의 「상담 신청」은 바로 신청서로(#/mal/consult/CSL_CLEANING/apply)', s['hash'] == '#/mal/consult/CSL_CLEANING/apply' and s['h1'] == '청소 상담 신청', s)

        # ── E ── 법률 · 세무
        res = []
        for c in dirs:
            for suf in ('', '/apply'):
                go(f'#/mal/consult/{c[0]}{suf}', 800); t = norm(pg.inner_text('#screen'))
                res.append((c[0] + suf, '광고' in t and '추천하거나 연결하지 않습니다' in t and pg.locator('#screen a[href^="tel:"]').count() == c[4] and pg.locator('#csl-name').count() == 0))
        rec('E-1 법률 · 세무 — 상세 주소 · 신청서 주소 모두 사무소 목록(「광고」 · 전화 링크) · 신청서 없음', len(res) == 4 and all(x[1] for x in res), res)

        # ── F ── 그 밖
        keys = pg.evaluate("Object.keys(__VIEW.screens)")
        rec('F-1 화면 206장(v10.24 의 193 + 업종 상세 malcsld · v10.26 의 운영 「소개몰 상품」 admhpr · v10.27 의 약관 전문 termsv · G-130 새 화면 7장 · v10.28 의 admhor · admhrv · trmagr) · v10.31 시안 키 5장(admdspt 분쟁 처리 · dspu 분쟁 접수 · qna 공개 문의 · terms 약관 · verify 본인 · 사업자 인증) = 211', len(keys) == 211 and all(k in keys for k in ('admdspt', 'dspu', 'qna', 'terms', 'verify')) and 'trmagr' in keys and 'malcsld' in keys and 'admhpr' in keys and 'termsv' in keys, len(keys))
        go('#/mal/consult', 800); rows = pg.evaluate(ROWS)
        okp = all(([x[0] for x in r['btns']] == (['사무소 보기'] if next(c for c in cats if c[0] == r['code'])[5] == 'dir' else ['상세 보기', '상담 신청'])) for r in rows)
        rec('F-2 업종 고르기 화면(#/mal/consult — 메인의 「전문가 소개」 등이 여는 곳)도 같은 줄 · 같은 단추', len(rows) == 22 and okp and pg.evaluate(ST)['screen'] == 'malcsl', (len(rows), [r['btns'] for r in rows[:1]]))
        m = b.new_page(viewport={'width': 390, 'height': 844}); wide = []
        for h in ('#/g/mal/consult', '#/mal/consult/CSL_MOVING', '#/mal/consult/CSL_MOVING/apply'):
            m.goto('file://' + FILE + h); m.wait_for_timeout(1000); m.evaluate(CLEAN)
            o = m.evaluate("()=>{const out=[]; document.querySelectorAll('#screen .axrows *, #screen .cslD *, #screen .cslf *, #screen .cslP, #screen .cslL').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width>0 && (r.right>391 || r.left<-1)) out.push(e.tagName+'.'+e.className+' '+Math.round(r.left)+'~'+Math.round(r.right))}); return [document.documentElement.scrollWidth, out.slice(0,4)]}")
            if o[0] > 391 or o[1]: wide.append((h, o))
            if SHOT: m.screenshot(path=f"{SHOT}/proto_390_{re.sub(r'[^A-Za-z]+', '_', h).strip('_')}.png", full_page=False)
        rec('F-3 390px — 목록 · 업종 상세 · 신청서의 내용이 화면 밖으로 나가지 않음', not wide, wide)
        m.close()
        # ── G ── 같은 종류의 결함(10/7 답 「같이 고침」)
        go('#/g/mal', 800); left = {}
        for k in keys:
            n = pg.evaluate("(k)=>{ location.hash=''; __VIEW.paint(k); return [...document.querySelectorAll('#screen a.bo.sm, #screen a.bp.sm')].filter(e=>e.offsetParent!==null && getComputedStyle(e).display==='grid').length }", k)
            if n: left[k] = n
        rec(f'G-1 화면 {len(keys)}장 모두 — 작은 링크 단추(a.bo.sm · a.bp.sm)가 3칸 격자로 늘어난 곳 0 (.sm 이름 겹침 · 전에는 알림 화면 3 · 소개자 홈 1 · 상담 줄 22)', not left, left)
        pg.evaluate("location.hash=''; __VIEW.paint('admptnw')"); pg.wait_for_timeout(200)
        st = {k: pg.evaluate(CSS, ['#screen #dirfee-in', k]) for k in ('height', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius')}
        rec('G-2 운영 화면 「월 노출료 기준 금액」의 입력 칸도 같은 모양(높이 38px 이상 · 1px 실선 · 둥근 모서리 — 전에는 브라우저 기본 모양)', px(st['height']) >= 38 and st['borderTopWidth'] == '1px' and st['borderTopStyle'] == 'solid' and px(st['borderTopLeftRadius']) >= 6, st)
        bh = pg.evaluate("()=>{const e=document.querySelector('#screen [data-dirfee-save]'); const r=e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]}")
        rec('G-3 그 옆의 「기준 금액 저장」 단추가 한 줄(높이 44px 이하 · 글자가 두 줄로 접히지 않음)', bh[1] <= 44 and bh[0] >= 90, bh)
        rec('Z-0 화면 오류 0', not errs, errs[:3])
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_fin.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
