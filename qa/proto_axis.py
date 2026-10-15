"""시안 v10.22 — 소개창업 「인력 · 운영지원 · 정보」 축의 상세 4종(공고 · 자문 서비스 · 정책 · 교육)과 주소 점검. 파일(file://)로 열어 실제로 눌러 봅니다. 결과: proto_axis.json

  10/7 지시 — 「공고 · 자문 서비스 · 정책 · 교육 상세를 만들고 주소도 항목마다 다르게(v10.21 매물 상세와 같은 방식)」
  답 — ① 인력 축 법무 회신(A-09): 「회신 완료 — 연다」  ② 같은 화면의 결함(G-139 · G-141)도 같이 고치기

  A. 축 · 갈래 주소   축 탭 · 갈래 단추가 주소를 바꾸고, 주소로 바로 열면 그 축 · 갈래
  B. 줄 → 상세        14줄(공고 4 · 자문 4 · 정책 3 · 교육 3)의 단추 · 제목을 눌러 그 항목의 상세 · 주소 14개 · 바로 열기
  C. 상세 구성        네 종류가 한 틀 · 견본 표시 · 맨 아래 줄 단추와 동작
  D. 인력(회신 완료)   「아직 열지 않았습니다」 문구 없음 · 업체 소개 요청 → 접수 → 「지원」 갈래에 쌓임 · 초단기만 보기
  E. 돌아가기         들어온 축 · 갈래로 / 바로 연 상세는 그 종류의 목록으로
  F. 함께 고친 것      배지 자리(G-139) · 옛 관 이름 · 지난 날짜 · 창업계획 등록(G-141) · 홈 퀵메뉴
  G. 그 밖            화면 수 · 390px · 안심소개 축 · 창업 축 카드 · 오류 0

사용:  python3 proto_axis.py       PROTO=/path/proto.html (기본 킷의 spec/proto.html)
"""
import datetime, json, os, re, sys
from playwright.sync_api import sync_playwright

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
ITEMS = []      # 줄 14개 — 종류 · 번호 · 구분 · 제목 · 값 · 상세 주소 · 상세 화면 (문서 · 엑셀의 항목표에 씁니다)
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)

CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
NOTOAST = "(()=>{const t=document.getElementById('toast'); if(t){t.classList.remove('on'); t.innerHTML=''}})()"
TOAST = "(()=>{const t=document.getElementById('toast');return t&&t.classList.contains('on')?t.textContent.trim():''})()"
ST = "()=>({screen:__VIEW.state.screen, hash:location.hash, axis:(document.querySelector('#screen .axt.on b')||{}).textContent||'', sub:(document.querySelector('#screen .axd.on')||{}).textContent||''})"
ROWS = """()=>[...document.querySelectorAll('#screen .axrows .axrow')].map((e,i)=>{const t=s=>{const x=e.querySelector(s); return x?(x.innerText||'').replace(/\\s+/g,' ').trim():''};
  return {i, no:e.getAttribute('data-axno')||'', badge:t('.axb'), title:t('.axl b'), price:t('.axr > b'), btn:t('.axr button, .axr a'), open:!!e.querySelector('[data-axopen]'), tt:!!e.querySelector('.axl [data-axopen]')}})"""
DETAIL = """()=>{const sc=document.getElementById('screen'), d=sc.querySelector('.axdt'); const t=s=>{const x=sc.querySelector(s); return x?(x.innerText||'').replace(/\\s+/g,' ').trim():''};
  const tx=sc.innerText||'';
  return {screen:__VIEW.state.screen, hash:location.hash, kind:d?d.getAttribute('data-kind'):'', no:d?d.getAttribute('data-no'):'', title:t('.axdt .dtt'), price:t('.axdt .dtprice'), badge:t('.axdt .axb'), num:t('.axdt .dtno'),
          spec:[...sc.querySelectorAll('.axdt dl.spec dt')].map(e=>e.innerText.trim()), bar:[...sc.querySelectorAll('.axdt .abar button, .axdt .abar a')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()),
          back:t('.bkl'), sample:!!sc.querySelector('.axdt .axsample'), bad:[...new Set((tx.match(/undefined|NaN|\\[object Object\\]/g)||[]))], text:tx.slice(0,6000)}}"""
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
strip = lambda s: re.sub(r'^[^가-힣A-Za-z0-9「]+', '', norm(s))
TODAY = datetime.date.today()

KINDS = {   # 종류: (목록 주소, 화면 키, 화면 ID, 상세 주소 앞부분, 줄 수, 축 이름, 갈래 이름)
    'job': ('#/g/biz/jobs',      'bjob', 'SB-BIZ-JOB-020', '#/g/biz/job/',      4, '인력',     '공고'),
    'svc': ('#/g/biz/advisory',  'bsvc', 'SB-BIZ-SVC-020', '#/g/biz/advisory/', 4, '운영지원', ''),
    'pol': ('#/g/biz/info',      'bpol', 'SB-BIZ-POL-020', '#/g/biz/policy/',   3, '정보',     '정책 소개'),
    'edu': ('#/g/biz/info/edu',  'bedu', 'SB-BIZ-EDU-020', '#/g/biz/edu/',      3, '정보',     '창업 교육'),
}
ADDR = [('#/g/biz/jobs', '인력', '공고'), ('#/g/biz/jobs/applied', '인력', '지원'), ('#/g/biz/jobs/quick', '인력', '빠른 매칭'), ('#/g/biz/jobs/urgent', '인력', '공고'),
        ('#/g/biz/advisory', '운영지원', ''), ('#/g/biz/info', '정보', '정책 소개'), ('#/g/biz/info/edu', '정보', '창업 교육')]


def past_dates(text):
    out = []
    for m in re.finditer(r'(20\d\d)-(\d\d)-(\d\d)', text):
        try:
            if datetime.date(*map(int, m.groups())) < TODAY: out.append(m.group(0))
        except ValueError: pass
    for m in re.finditer(r'(?<![\d.])(\d{1,2})/(\d{1,2})(?![\d/])', text):
        mo, da = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12 and 1 <= da <= 31:
            try:
                d = datetime.date(TODAY.year, mo, da)
                if d < TODAY and (TODAY - d).days < 180: out.append(m.group(0))
            except ValueError: pass
    return out


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1500, 'height': 900}); pg = ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        def goto(h, wait=320):
            pg.goto('file://' + FILE + h); pg.wait_for_timeout(wait); pg.evaluate(CLEAN); pg.evaluate(NOTOAST)
        def fresh(h):
            q = ctx.new_page(); q.on('pageerror', lambda e: errs.append(str(e)[:200]))
            q.goto('file://' + FILE + h); q.wait_for_timeout(900); q.evaluate(CLEAN)
            return q
        pg.goto('file://' + FILE); pg.wait_for_timeout(1500)
        keys = pg.evaluate("Object.keys(__VIEW.screens)")

        rows_by = {}; det = {}; texts = {}
        # ── A. 축 · 갈래 주소 ──
        def sec_A():
            nonlocal rows_by, det, texts
            goto('#/g/biz'); res = {}
            for nm, want in (('인력', '#/g/biz/jobs'), ('운영지원', '#/g/biz/advisory'), ('정보', '#/g/biz/info')):
                pg.evaluate("(nm)=>{[...document.querySelectorAll('#screen .axt')].find(e=>e.querySelector('b').textContent===nm).click()}", nm); pg.wait_for_timeout(300)
                res[nm] = pg.evaluate(ST)
            rec('A-1 축 탭 3개를 누르면 주소가 /jobs · /advisory · /info 로 바뀌고 그 축이 열림',
                res['인력']['hash'] == '#/g/biz/jobs' and res['운영지원']['hash'] == '#/g/biz/advisory' and res['정보']['hash'] == '#/g/biz/info' and all(res[k]['axis'] == k and res[k]['screen'] == 'listb' for k in res), res)
            res = {}
            for base, lab, want in (('#/g/biz/jobs', '지원', '#/g/biz/jobs/applied'), ('#/g/biz/jobs', '빠른 매칭', '#/g/biz/jobs/quick'), ('#/g/biz/jobs/quick', '공고', '#/g/biz/jobs'), ('#/g/biz/info', '창업 교육', '#/g/biz/info/edu'), ('#/g/biz/info/edu', '정책 소개', '#/g/biz/info')):
                goto(base)
                pg.evaluate("(lab)=>{[...document.querySelectorAll('#screen .axd')].find(e=>e.textContent.trim()===lab).click()}", lab); pg.wait_for_timeout(300)
                s = pg.evaluate(ST); res[base + '→' + lab] = (s['hash'] == want and s['sub'].strip() == lab, s['hash'], s['sub'])
            rec('A-2 갈래 단추 5번 — 주소가 /jobs/applied · /jobs/quick · /jobs · /info/edu · /info 로 바뀌고 그 갈래가 선택됨', all(v[0] for v in res.values()), res)
            res = {}
            for h, ax, sub in ADDR:
                q = fresh(h); s = q.evaluate(ST); q.close()
                res[h] = (s['screen'] == 'listb' and s['axis'] == ax and s['sub'].strip() == sub and s['hash'] == h, s)
            rec(f'A-3 주소 {len(ADDR)}개를 새 창에서 바로 열면 그 축 · 갈래가 열림', all(v[0] for v in res.values()), {k: v[1] for k, v in res.items() if not v[0]})
            goto('#/g/biz/info/edu'); goto('#/g/biz/jobs/quick'); goto('#/g/biz'); s = pg.evaluate(ST)
            cards = pg.evaluate("document.querySelectorAll('#screen [data-open]').length")
            rec('A-4 다른 축을 본 뒤에도 #/g/biz 는 「창업」 축(매물 카드가 보임)', s['axis'] == '창업' and cards >= 3, (s, cards))
            goto('#/g/biz/advisory'); pg.evaluate("()=>{[...document.querySelectorAll('#screen .axt')].find(e=>e.querySelector('b').textContent==='창업').click()}"); pg.wait_for_timeout(300); s = pg.evaluate(ST)
            rec('A-5 축 탭 「창업」을 누르면 #/g/biz', s['hash'] in ('#/g/biz', '#/g/biz/') and s['axis'] == '창업', s)

        # ── B. 줄 → 상세 ──
        def sec_B():
            nonlocal rows_by, det, texts
            miss = []; seen_hash = {}; n = 0
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                goto(lh); rows = pg.evaluate(ROWS); rows_by[kind] = rows
                if len(rows) != cnt: miss.append((kind, '줄 수', len(rows)))
                for r in rows:
                    goto(lh); pg.evaluate("(i)=>{document.querySelectorAll('#screen .axrows .axrow')[i].querySelector('.axr [data-axopen]').click()}", r['i']) if r['open'] else None
                    pg.wait_for_timeout(280); d = pg.evaluate(DETAIL); n += 1
                    bad = [k for k, a, bb in (('화면', d['screen'], sk), ('주소', d['hash'], pre + r['no']), ('제목', norm(d['title']), norm(r['title'])), ('구분', d['badge'], r['badge']), ('번호', d['no'], r['no'])) if a != bb or not a]
                    if bad or d['hash'] in seen_hash: miss.append((kind, r['title'][:16], bad, d['hash'], d['screen']))
                    seen_hash[d['hash']] = r['title']
                    ITEMS.append({'kind': kind, 'axis': ax, 'sub': sub, 'no': r['no'], 'badge': r['badge'], 'title': r['title'], 'price': r['price'], 'list': lh, 'btn': r['btn'], 'hash': d['hash'], 'screen': d['screen'], 'screen_id': sid, 'detail_price': d['price'], 'num': d['num']})
            rec(f'B-1 줄의 단추 {n}개를 하나씩 눌러 — 그 종류의 상세 화면 · 제목 · 구분 · 번호가 줄과 같음 · 주소 {len(seen_hash)}개가 서로 다름', n == 14 and len(seen_hash) == 14 and not miss, miss[:5])
            miss = []; n = 0
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                for r in rows_by.get(kind, []):
                    goto(lh)
                    if not r['tt']: miss.append((kind, r['title'][:16], '제목에 링크 없음')); continue
                    pg.evaluate("(i)=>{document.querySelectorAll('#screen .axrows .axrow')[i].querySelector('.axl [data-axopen]').click()}", r['i']); pg.wait_for_timeout(280); d = pg.evaluate(DETAIL); n += 1
                    if d['hash'] != pre + r['no'] or norm(d['title']) != norm(r['title']): miss.append((kind, r['title'][:16], d['hash']))
            rec(f'B-2 줄의 제목 {n}개를 눌러도 같은 상세', n == 14 and not miss, miss[:5])
            miss = []; n = 0; direct = {}
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                for r in rows_by.get(kind, []):
                    if not r['no']: miss.append((kind, '번호 없음')); continue
                    q = fresh(pre + r['no']); d = q.evaluate(DETAIL); q.close(); n += 1; direct.setdefault(kind, d)
                    if d['screen'] != sk or norm(d['title']) != norm(r['title']) or d['badge'] != r['badge']: miss.append((kind, r['no'], d['screen'], d['title'][:20]))
            rec(f'B-3 상세 주소 {n}개를 새 창에서 바로 열어도 그 항목', n == 14 and not miss, miss[:5])
            miss = []
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                first = (rows_by.get(kind) or [{}])[0]
                q = fresh(pre + '99999999'); d = q.evaluate(DETAIL); q.close()
                if d['screen'] != sk or not d['title'] or norm(d['title']) != norm(first.get('title', '')): miss.append((kind, d['screen'], d['title'][:20]))
            rec('B-4 없는 번호의 주소는 그 종류의 첫 항목(빈 화면 · 오류가 아님)', not miss, miss)
            meta = pg.evaluate("()=>{const o={}; for(const k of ['bjob','bsvc','bpol','bedu']){ const m=__VIEW.meta()[k]; o[k]=m?m.id:null } return o}")
            rec('B-5 새 화면 4장의 화면 ID — SB-BIZ-JOB-020 · SVC-020 · POL-020 · EDU-020', meta == {v[1]: v[2] for v in KINDS.values()}, meta)

        # ── C. 상세 구성 ──
        def sec_C():
            nonlocal rows_by, det, texts
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                no = (rows_by.get(kind) or [{'no': '0'}])[0]['no']; goto(pre + no); det[kind] = pg.evaluate(DETAIL)
                pg.screenshot(path=os.path.join(OUT, f'proto_axis_{kind}.png'), full_page=True)
            ok = all(d['kind'] == k and d['title'] and d['price'] and d['badge'] and d['num'] and len(d['spec']) >= 5 and len(d['bar']) >= 2 and '돌아가기' in d['back'] for k, d in det.items())
            rec('C-1 네 종류가 한 틀 — 돌아가기 · 구분 · 제목 · 값 · 번호 · 내용표(5줄 이상) · 맨 아래 줄', ok, {k: (d['kind'], bool(d['title']), d['price'], d['badge'], d['num'], len(d['spec']), d['bar'], d['back']) for k, d in det.items()})
            rec('C-2 정책 · 교육 상세에 「시연용 견본 — 실제 공고가 아닙니다」 표시', det['pol']['sample'] and det['edu']['sample'] and '시연용 견본' in det['pol']['text'] and '실제 공고가 아닙니다' in det['pol']['text'] and '시연용 견본' in det['edu']['text'], (det['pol']['sample'], det['edu']['sample']))
            want = {'job': ['공유하기', '신고', '업체 소개 요청'], 'svc': ['공유하기', '신고', '자문 요청'], 'pol': ['공유하기', '창업계획 등록', '원문 공고 보기'], 'edu': ['공유하기', '수강 신청']}
            got = {k: [strip(x) for x in d['bar']] for k, d in det.items()}
            rec('C-3 맨 아래 줄 — 공고 「공유하기 · 신고 · 업체 소개 요청」 / 자문 「공유하기 · 신고 · 자문 요청」 / 정책 「공유하기 · 창업계획 등록 · 원문 공고 보기」 / 교육 「공유하기 · 수강 신청」',
                all(len(got[k]) == len(want[k]) and all(got[k][i].startswith(want[k][i]) for i in range(len(want[k]))) for k in want), got)
            acts = {}
            for kind, lab in (('svc', '자문 요청'), ('pol', '원문 공고 보기'), ('edu', '수강 신청'), ('job', '공유하기'), ('job', '신고')):
                no = rows_by[kind][0]['no']; goto(KINDS[kind][3] + no); h0 = pg.evaluate("location.hash")
                pg.evaluate("(lab)=>{[...document.querySelectorAll('#screen .axdt .abar button, #screen .axdt .abar a')].find(e=>e.innerText.replace(/\\s+/g,' ').replace(/^[^가-힣A-Za-z0-9]+/,'').trim().startsWith(lab)).click()}", lab); pg.wait_for_timeout(300)
                pg.wait_for_timeout(400)
                acts[kind + ' ' + lab] = (pg.evaluate(TOAST), pg.evaluate("location.hash") == h0, pg.evaluate("__VIEW.state.screen"), pg.evaluate("location.hash"), no)
            # v10.27 (G-130) — 「원문 공고 보기」는 그 공고의 원문 화면(bpolsrc · 주소 /policy/{번호}/source)을 엶. 나머지는 안내 글 · 화면 그대로
            pol = acts['pol 원문 공고 보기']
            rest = {k: v for k, v in acts.items() if k != 'pol 원문 공고 보기'}
            rec('C-4 「자문 요청」 「수강 신청」 「공유하기」 「신고」 — 안내 글이 뜨고 화면은 그대로 · 「원문 공고 보기」 → 그 공고의 원문 화면(G-130)',
                all(v[0] and v[1] for v in rest.values()) and '연결 전' in acts['svc 자문 요청'][0] and '연동 전' in acts['edu 수강 신청'][0]
                and pol[2] == 'bpolsrc' and pol[3].endswith('/policy/' + str(pol[4]) + '/source'), acts)
            goto(KINDS['pol'][3] + rows_by['pol'][0]['no'])
            pg.evaluate("()=>{[...document.querySelectorAll('#screen .axdt .abar button, #screen .axdt .abar a')].find(e=>e.innerText.includes('창업계획 등록')).click()}"); pg.wait_for_timeout(350); s = pg.evaluate(ST)
            rec('C-5 정책 상세의 「창업계획 등록」 → 소개받기 등록 화면(#/request/new)', s['screen'] == 'reqn' and s['hash'].endswith('/request/new'), s)
            rec('C-6 상세 4종에 깨진 값(undefined · NaN) 0', not any(d['bad'] for d in det.values()), {k: d['bad'] for k, d in det.items()})

        # ── D. 인력 (A-09 회신 완료) ──
        def sec_D():
            nonlocal rows_by, det, texts
            for h, ax, sub in ADDR:
                goto(h); texts[h] = pg.evaluate("document.querySelector('#screen .gwl').innerText")
            for kind in KINDS:
                texts['상세 ' + kind] = det[kind]['text']
            gate = {k: [w for w in ('아직 열지 않았습니다', '화면만 미리 봅니다', 'A-09 회신 뒤') if w in t] for k, t in texts.items()}
            rec('D-1 세 축의 목록 7곳 · 상세 4종 어디에도 「아직 열지 않았습니다」 「화면만 미리 봅니다」 「A-09 회신 뒤」 없음', not any(gate.values()), {k: v for k, v in gate.items() if v})
            t = texts['#/g/biz/jobs']
            rec('D-2 「개인은 노출하지 않는다」는 안내와 탭의 「도급만 · 개인 노출 없음」은 그대로', '도급만 · 개인 노출 없음' in t and ('개인 구직자를 직접 노출하지 않고' in t or '개인은 노출하지 않습니다' in t) and '개인' in det['job']['text'] and '노출하지' in det['job']['text'], t[:200])
            q = fresh('#/g/biz/jobs/applied'); r0 = q.evaluate(ROWS); emp = q.evaluate("(document.querySelector('#screen .axempty')||{}).innerText||''")
            rec('D-3 「지원」 갈래 — 요청 전에는 0줄 · 「아직 소개 요청한 공고가 없습니다」 안내(전에는 「공고」와 같은 4줄)', len(r0) == 0 and '아직 소개 요청한 공고가 없습니다' in emp, (len(r0), emp[:60]))
            no2 = rows_by['job'][1]['no'] if len(rows_by.get('job', [])) > 1 else '0'; title2 = rows_by['job'][1]['title'] if len(rows_by.get('job', [])) > 1 else ''
            q.goto('file://' + FILE + '#/g/biz/job/' + no2); q.wait_for_timeout(350); q.evaluate(CLEAN); q.evaluate(NOTOAST)
            q.evaluate("()=>{[...document.querySelectorAll('#screen .axdt .abar button')].find(e=>e.innerText.includes('업체 소개 요청')).click()}"); q.wait_for_timeout(350)
            tz = q.evaluate(TOAST); bar = [strip(x) for x in q.evaluate(DETAIL)['bar']]
            rec('D-4 공고 상세 「업체 소개 요청」 → 「접수」 안내 글 · 단추가 「요청 접수됨」으로', '접수' in tz and any(x.startswith('요청 접수됨') for x in bar) and not any(x.startswith('업체 소개 요청') for x in bar), (tz, bar))
            q.goto('file://' + FILE + '#/g/biz/jobs/applied'); q.wait_for_timeout(350); r1 = q.evaluate(ROWS)
            ok = len(r1) == 1 and norm(r1[0]['title']) == norm(title2) and r1[0]['no'] == no2
            if ok:
                q.evaluate("()=>{document.querySelector('#screen .axrows .axrow [data-axopen]').click()}"); q.wait_for_timeout(300); d = q.evaluate(DETAIL)
                ok = d['hash'] == '#/g/biz/job/' + no2 and any(strip(x).startswith('요청 접수됨') for x in d['bar'])
            txt = q.evaluate("document.querySelector('#screen').innerText") if not ok else ''
            rec('D-5 그 뒤 「지원」 갈래에 요청한 공고 1줄(접수됨) — 누르면 그 공고 상세(요청 접수됨)', ok, (r1, txt[:80])); q.close()
            goto('#/g/biz/jobs'); pg.evaluate("()=>{document.querySelector('#screen .axurg button, #screen .axurg a').click()}"); pg.wait_for_timeout(300)
            s = pg.evaluate(ST); ur = pg.evaluate(ROWS)
            ok = s['hash'] == '#/g/biz/jobs/urgent' and len(ur) == 2 and all(r['badge'] == '초단기' for r in ur)
            if ok:
                pg.evaluate("()=>{[...document.querySelectorAll('#screen .axurg button, #screen .axurg a')].find(e=>e.innerText.includes('전체 보기')).click()}"); pg.wait_for_timeout(300)
                ok = pg.evaluate("location.hash") == '#/g/biz/jobs' and len(pg.evaluate(ROWS)) == 4
            rec('D-6 「초단기 급구 · 보러 가기」 → /jobs/urgent 에 초단기 2건만 · 「전체 보기」로 4건(전에는 일반 급구급매 화면으로 감)', ok, (s, [(r['badge'], r['title'][:14]) for r in ur]))
            goto('#/g/biz/jobs/quick'); qr = pg.evaluate(ROWS); tz = []
            for i in range(len(qr)):
                pg.evaluate(NOTOAST); pg.evaluate("(i)=>{document.querySelectorAll('#screen .axrows .axrow')[i].querySelector('button').click()}", i); pg.wait_for_timeout(200); tz.append(pg.evaluate(TOAST))
            rec('D-7 「빠른 매칭」의 「요청 보내기」 4개는 그대로 안내 글(상세가 아니라 요청 단추)', len(qr) == 4 and all('요청을 보냈습니다' in x for x in tz) and pg.evaluate("location.hash") == '#/g/biz/jobs/quick', tz)

        # ── E. 돌아가기 ──
        def sec_E():
            nonlocal rows_by, det, texts
            miss = []
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                goto('#/g/biz'); goto(lh); pg.evaluate("()=>{document.querySelector('#screen .axrows .axrow .axr [data-axopen]').click()}"); pg.wait_for_timeout(300)
                if pg.evaluate("__VIEW.state.screen") != sk: miss.append((kind, '상세가 열리지 않음')); continue
                pg.click('#screen .bkl'); pg.wait_for_timeout(350); s = pg.evaluate(ST)
                if s['hash'] != lh or s['axis'] != ax or s['sub'].strip() != sub: miss.append((kind, s))
            rec('E-1 상세의 「돌아가기」 — 들어온 축 · 갈래의 주소로 돌아감(네 종류 · 교육은 /info/edu)', not miss, miss)
            miss = []
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                q = fresh(pre + (rows_by.get(kind) or [{'no': '0'}])[0]['no'])
                if not q.locator('#screen .bkl').count(): miss.append((kind, '돌아가기 없음')); q.close(); continue
                q.click('#screen .bkl'); q.wait_for_timeout(400); s = q.evaluate(ST); q.close()
                if s['hash'] != lh or s['axis'] != ax: miss.append((kind, s))
            rec('E-2 주소로 바로 연 상세의 「돌아가기」 — 그 종류의 목록으로(창업 축이 아님)', not miss, miss)

        # ── F. 함께 고친 것 ──
        def sec_F():
            nonlocal rows_by, det, texts
            BADGE = "()=>[...document.querySelectorAll('#screen .axrows .axb')].map(e=>{const r=e.getBoundingClientRect(), w=e.closest('.axrow').getBoundingClientRect(), c=getComputedStyle(e); return {t:e.textContent, inside:r.top>=w.top-1&&r.bottom<=w.bottom+1&&r.left>=w.left-1, pos:c.position, hl:c.backgroundColor}})"
            bd = {}
            for h in ('#/g/biz/jobs', '#/g/biz/jobs/quick'):
                goto(h); bd[h] = pg.evaluate(BADGE)
            goto('#/g/mal'); pg.evaluate("()=>{const t=[...document.querySelectorAll('#screen .axt')].find(e=>e.getAttribute('data-xv')==='C'); t&&t.click()}"); pg.wait_for_timeout(300); bd['안심소개 상담'] = pg.evaluate(BADGE)
            out = {k: [x['t'] for x in v if not x['inside']] for k, v in bd.items()}
            hot = {k: sum(1 for x in v if x['hl'] == 'rgb(254, 226, 226)') for k, v in bd.items()}
            rec(f'F-1 강조 배지가 줄 안에 있음 — 인력 공고 「초단기」 · 빠른 매칭 「오늘」 · 안심소개 상담 축 「자격 확인」(강조 배지 {sum(hot.values())}개)', not any(out.values()) and hot['#/g/biz/jobs'] == 2 and hot['#/g/biz/jobs/quick'] == 2 and hot['안심소개 상담'] >= 10 and all(len(v) >= 4 for v in bd.values()), (out, hot))
            goto('#/g/biz'); texts['#/g/biz'] = pg.evaluate("document.querySelector('#screen .gwl').innerText")
            goto(KINDS['svc'][3] + rows_by['svc'][0]['no']); pg.evaluate("()=>{[...document.querySelectorAll('#screen .axdt .abar button')].find(e=>e.innerText.includes('자문 요청')).click()}"); pg.wait_for_timeout(250); texts['자문 요청 안내 글'] = pg.evaluate(TOAST)
            old = {k: [w for w in ('소개머니', '소개뱅크몰', '건강몰', '소개리드') if w in t] for k, t in texts.items()}      # v10.25 — 「소개몰」은 이제 쇼핑몰의 이름입니다(머리줄 메뉴). 옛 뜻(안심소개)으로 남은 것은 proto_mall.py N-3 이 봅니다
            rec(f'F-2 소개창업 4축 목록 · 상세 4종 · 안내 글 {len(texts)}곳에 옛 관 이름(소개머니 · 소개뱅크몰 · 건강몰 · 소개리드) 0', not any(old.values()) and len(texts) >= 13, {k: v for k, v in old.items() if v})
            pd = {k: past_dates(t) for k, t in texts.items()}
            for kind, (lh, sk, sid, pre, cnt, ax, sub) in KINDS.items():
                for r in rows_by.get(kind, []):
                    goto(pre + r['no']); x = past_dates(pg.evaluate("document.querySelector('#screen').innerText"))
                    if x: pd[pre + r['no']] = x
            rec('F-3 세 축의 목록 · 상세 14건에 지난 날짜 0(마감 · 기한이 오늘 뒤)', not any(pd.values()), {k: v for k, v in pd.items() if v})
            goto('#/g/biz/info'); pg.evaluate("()=>{document.querySelector('#screen .axcta button, #screen .axcta a').click()}"); pg.wait_for_timeout(350); s = pg.evaluate(ST)
            rec('F-4 정보 축의 「창업계획 등록」 → 소개받기 등록 화면(#/request/new · 전에는 요청 목록)', s['screen'] == 'reqn' and s['hash'].endswith('/request/new'), s)
            qm = pg.evaluate("()=>{const q=(window.__GAP||{}).qm||{}; return {a:q['창업 지원']||null, b:q['창업 상담']||null}}")
            rec('F-5 홈 퀵메뉴 배선 — 「창업 지원」→ 정보 축(#/g/biz/info) · 「창업 상담」→ 운영지원 축(#/g/biz/advisory)', bool(qm['a']) and qm['a'].get('href') == '#/g/biz/info' and bool(qm['b']) and qm['b'].get('href') == '#/g/biz/advisory', qm)

        # ── G. 그 밖 ──
        def sec_G():
            nonlocal rows_by, det, texts
            rec(f'G-1 화면 수 {len(keys)}장 — 206장(189 + 상세 4 + v10.24 의 상담 업종 상세 1 + v10.26 의 운영 「소개몰 상품」 1 + v10.27 의 약관 전문 1 · G-130 새 화면 7) · v10.28 의 3장(소개몰 주문 · 리뷰 · 문의 · 재동의) = 206 · 새 화면 키 bjob · bsvc · bpol · bedu · v10.31 시안 키 5장(admdspt 분쟁 처리 · dspu 분쟁 접수 · qna 공개 문의 · terms 약관 · verify 본인 · 사업자 인증) = 211', len(keys) == 211 and all(k in keys for k in ('admdspt', 'dspu', 'qna', 'terms', 'verify')) and 'termsv' in keys and all(k in keys for k in ('bjob', 'bsvc', 'bpol', 'bedu')), len(keys))
            pg.set_viewport_size({'width': 390, 'height': 800}); ow = {}
            for h, ax, sub in ADDR: goto(h); ow[h] = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
            for kind in KINDS:
                h = KINDS[kind][3] + (rows_by.get(kind) or [{'no': '0'}])[0]['no']; goto(h); ow[h] = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
                if kind == 'job': pg.screenshot(path=os.path.join(OUT, 'proto_axis_job_390.png'), full_page=True)
            pg.set_viewport_size({'width': 1500, 'height': 900})
            rec(f'G-2 390px — 목록 {len(ADDR)}곳 · 상세 4종 모두 문서 가로 스크롤 0', all(v <= 1 for v in ow.values()), {k: v for k, v in ow.items() if v > 1})
            goto('#/g/mal'); pg.evaluate("()=>{const t=[...document.querySelectorAll('#screen .axt')].find(e=>e.getAttribute('data-xv')==='C'); t&&t.click()}"); pg.wait_for_timeout(300)
            ml = pg.evaluate("document.querySelectorAll('#screen .axrows .axrow').length"); mh = pg.evaluate("location.hash")
            rec('G-3 안심소개의 축 탭은 그대로 — 「생활 · 금융 상담」 축에 업종 22줄', ml == 22, (ml, mh))
            goto('#/g/biz'); pg.evaluate("()=>{document.querySelector('#screen [data-open]').click()}"); pg.wait_for_timeout(300); s = pg.evaluate(ST)
            rec('G-4 「창업」 축의 매물 카드는 그대로 매물 상세(#/g/biz/l/번호)로', s['screen'] == 'detail' and re.match(r'^#/g/biz/l/\d+$', s['hash'] or '') is not None, s)
            for nm, h in (('jobs', '#/g/biz/jobs'), ('advisory', '#/g/biz/advisory'), ('info', '#/g/biz/info')):
                goto(h); pg.screenshot(path=os.path.join(OUT, f'proto_axis_list_{nm}.png'), full_page=True)
            rec('G-5 그리는 중 오류 0', not errs, errs[:3])
        for nm, fn in (('A. 축 · 갈래 주소', sec_A), ('B. 줄 → 상세', sec_B), ('C. 상세 구성', sec_C), ('D. 인력 (A-09 회신 완료)', sec_D), ('E. 돌아가기', sec_E), ('F. 함께 고친 것', sec_F), ('G. 그 밖', sec_G)):
            try: fn()
            except Exception as ex:
                rec(nm + ' — 실행 중 오류(이 묶음의 나머지 항목을 보지 못함)', False, repr(ex)[:300])
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R), 'rows': ITEMS}, open(os.path.join(OUT, 'proto_axis.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
