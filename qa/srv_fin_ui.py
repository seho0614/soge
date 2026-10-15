"""v10.24 안심소개 「생활 · 금융 상담」 — 실제 웹 점검(브라우저로 열어 눌러 봄). 결과: srv_fin_ui.json

  L. 목록          /mall?axis=consult · /mal/consult — 줄마다 「상세 보기」 · 「상담 신청」 · 법률 · 세무는 「사무소 보기」 · /consult 는 그대로
  D. 업종 상세     /mal/consult/{code} — 이름 · 설명 · 인증업체 수 · 받는 지역 · 진행 순서 · 알아 둘 것 · 맨 아래 줄 (값은 API 와 같음)
  A. 신청서        /mal/consult/{code}/apply — 신청서 · 돌아가기 · 법률 · 세무는 상세로 · 없는 업종
  F. 상담하기      상세 → 「상담 신청」 → 이름 · 휴대폰 · 지역 → 인증번호 → 접수(업체 1곳 전달)
  M. 좁은 화면     390px 에서 가로 넘침 없음
  O. 그 밖         다른 화면은 그대로 · 화면 오류 0

사용:  python3 srv_fin_ui.py      SITE=http://localhost:5174 · API=http://localhost:3000
"""
import json, os, random, re, sys
from playwright.sync_api import sync_playwright
from detail_fixture import call, login

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__))
SHOT = os.environ.get('SHOT', '')        # 폴더를 주면 화면을 찍어 둡니다
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:260], file=sys.stderr)

norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
ROWS = """() => [...document.querySelectorAll('.mal-row[data-csl]')].map(li => ({ code: li.getAttribute('data-csl'), mode: li.getAttribute('data-csl-mode'),
  name: (li.querySelector('.mal-row-l b') || {}).textContent || '', links: [...li.querySelectorAll('.mal-row-r a, .mal-row-r button')].map(a => [a.tagName, a.textContent.trim(), a.getAttribute('href'), !!a.disabled]),
  title: (li.querySelector('.mal-row-l a') || {getAttribute(){return null}}).getAttribute('href') }))"""
OVER = "() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })"


def main():
    st, cats = call('GET', '/consult/categories'); assert st == 200, st
    by = {c['code']: c for c in cats}
    is_open = lambda c: c['status'] == 'APPROVED' and c['consultMode'] == 'LEAD' and c['partnerCount'] > 0
    is_dir = lambda c: c['status'] == 'APPROVED' and c['consultMode'] == 'LISTING_FEE'
    opens = [c for c in cats if is_open(c)]; dirs = [c for c in cats if is_dir(c)]; shut = [c for c in cats if not is_open(c) and not is_dir(c)]
    # 사용자 웹은 서버 자료를 60초 기억하고, 그 뒤 **처음 여는 사람에게는 예전 것을 주면서 뒤에서 새로 받아 둡니다**(Next 의 자료 기억 방식).
    #   오래 열지 않은 쪽은 몇 분 전 자료가 한 번 나옵니다 — 다른 시험이 업체 · 사무소를 넣고 뺀 직후에는 API 와 어긋나 보입니다(G-161).
    #   그래서 견줄 쪽을 먼저 한 번씩 열어 새 자료를 받게 한 뒤에 봅니다. (화면 결함이 아니라 견주는 때의 문제입니다)
    import time, urllib.request
    for u in ['/mall?axis=consult', '/mal/consult', '/consult'] + [f"/mal/consult/{c['code']}" for c in cats] + [f"/mal/consult/{c['code']}/apply" for c in cats]:
        try: urllib.request.urlopen(urllib.request.Request(SITE + u, headers={'User-Agent': 'Mozilla/5.0 srv_fin_ui prime'}), timeout=60).read()
        except Exception: pass
    time.sleep(3)
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        def shot(name):
            if SHOT: os.makedirs(SHOT, exist_ok=True); pg.screenshot(path=f'{SHOT}/{name}.png', full_page=True)

        # ── L ── 목록
        for tag, url in (('L-1', '/mall?axis=consult'), ('L-2', '/mal/consult')):
            pg.goto(SITE + url, wait_until='networkidle'); rows = pg.evaluate(ROWS); bad = []
            for r in rows:
                c = by.get(r['code']); L = r['links']; code = r['code']
                if not c: bad.append((code, '모르는 업종')); continue
                if is_dir(c): want = [['A', '사무소 보기', f'/mal/consult/{code}', False]]
                elif is_open(c): want = [['A', '상세 보기', f'/mal/consult/{code}', False], ['A', '상담 신청', f'/mal/consult/{code}/apply', False]]
                else: want = [['A', '상세 보기', f'/mal/consult/{code}', False], ['BUTTON', '준비 중', None, True]]
                if L != want: bad.append((code, L))
            rec(f'{tag} {url} — 줄 {len(cats)}개 · 받는 업종은 「상세 보기」 + 「상담 신청」(→ …/apply) · 못 받는 업종은 「상세 보기」 + 막힌 「준비 중」 · 법률 · 세무는 「사무소 보기」',
                len(rows) == len(cats) and not bad, (len(rows), bad[:3]))
            if tag == 'L-1':
                rec('L-1b 업종 이름을 눌러도 그 업종의 상세로 감', all(r['title'] == f"/mal/consult/{r['code']}" for r in rows) and len(rows) > 0, [(r['code'], r['title']) for r in rows if r['title'] != f"/mal/consult/{r['code']}"][:3])
                shot('web_list')
        pg.goto(SITE + '/mall?axis=consult', wait_until='networkidle')
        first = opens[0] if opens else None
        if first:
            pg.locator(f'.mal-row[data-csl="{first["code"]}"] .mal-row-r a', has_text='상세 보기').click(); pg.wait_for_url(f'**/mal/consult/{first["code"]}', timeout=15000)
            rec('L-3 「상세 보기」를 누르면 그 업종의 상세(/mal/consult/{code})', pg.url.endswith(f'/mal/consult/{first["code"]}') and pg.locator(f'[data-consult-detail="{first["code"]}"]').count() == 1, pg.url)
        else: rec('L-3 「상세 보기」를 누르면 그 업종의 상세', False, '받는 업종이 없음')
        pg.goto(SITE + '/consult', wait_until='networkidle'); rows = pg.evaluate(ROWS)
        # v10.31 (w2 시안 CSL-010) — /consult 의 업종 줄도 「상세 보기」 + 「상담 신청」 두 단추(안심소개 목록과 같은 모양 · 전: 「고르기」 하나)
        keep = all((r['links'] == [['A', '상세 보기', f"/mal/consult/{r['code']}", False], ['A', '상담 신청', f"/mal/consult/{r['code']}/apply", False]]) for r in rows if by.get(r['code']) and is_open(by[r['code']]))
        rec('L-4 /consult(업종 고르기 + 내 상담 신청) — 받는 업종의 단추는 「상세 보기」 · 「상담 신청」(v10.31 시안)', len(rows) == len(cats) and keep, [r['links'] for r in rows[:2]])

        # ── D ── 업종 상세
        one = next((c for c in opens if c['code'] == 'CSL_CLEANING'), first)
        if one:
            code = one['code']; st, d = call('GET', f'/consult/categories/{code}'); d = d if isinstance(d, dict) else {}
            r = pg.goto(SITE + f'/mal/consult/{code}', wait_until='networkidle'); t = norm(pg.inner_text('main'))
            rec(f'D-1 /mal/consult/{code} → 200 · 제목이 업종 이름 · 이 화면에는 신청서가 없음', r.status == 200 and norm(pg.inner_text('h1')) == one['name'] and pg.locator('input[name=phone], input[name=name]').count() == 0 and pg.locator(f'[data-consult-detail="{code}"]').count() == 1, (r.status, pg.inner_text('h1') if pg.locator('h1').count() else ''))
            tags = [norm(x) for x in pg.locator('.mal-cd-tags .mal-tag').all_inner_texts()]
            rec('D-2 표시 — 「자격 확인」 또는 「일반」 + 「상담신청형」', tags == [('자격 확인' if one['publishMode'] == 'GATED' else '일반'), '상담신청형'], tags)
            cells = {norm(c.locator('.k').inner_text()): norm(c.locator('.v').inner_text()) for c in pg.locator('.mal-cd-stats .cell').all()}
            rec('D-3 요약 세 칸 — 인증업체 수 · 받는 지역 수 · 전달 업체 수가 API 와 같음', st == 200 and cells == {'받을 수 있는 인증업체': f"{d['partnerCount']}곳", '받는 지역': f"{len(d['regions'])}곳", '신청 정보 전달': f"{d['rules']['deliverTo']}곳에만"}, cells)
            regs = [[norm(li.locator('b').inner_text()), norm(li.locator('span').inner_text())] for li in pg.locator('.mal-cd-regions li').all()]
            rec('D-4 받는 지역 — 시 · 도와 업체 수가 API 와 같은 순서 · 같은 값', st == 200 and regs == [[x['sido'], f"{x['partnerCount']}곳"] for x in d['regions']] and len(regs) > 0, regs[:5])
            steps = [norm(x) for x in pg.locator('.mal-cd-steps li b').all_inner_texts()]
            rec('D-5 진행 순서 3단계 — 상담 신청 → 휴대폰 확인 → 인증업체가 연락 · 인증번호 시간은 API 값', len(steps) == 3 and '상담 신청' in steps[0] and '휴대폰 확인' in steps[1] and '연락' in steps[2] and st == 200 and f"{d['rules']['otpMinutes']}분" in t, steps)
            rec('D-6 알아 두실 것 — 1곳에만 전달 · 하루 신청 한도 · 업체가 열어 볼 기한이 API 값으로 적혀 있음', st == 200 and '1곳에만 전달' in t and f"하루 {d['rules']['dailyLimit']}번" in t and f"{d['rules']['viewTtlHours']}시간" in t, t[-400:])
            go = pg.locator('.mal-cd-bar a.mal-cd-go'); back = pg.locator('.mal-cd-bar a', has_text='목록으로')
            rec('D-7 맨 아래 줄 — 「상담 신청」(→ …/apply) · 「목록으로」(→ /mall?axis=consult)', go.count() == 1 and go.get_attribute('href') == f'/mal/consult/{code}/apply' and back.count() == 1 and back.get_attribute('href') == '/mall?axis=consult', (go.count(), back.count()))
            names = pg.evaluate("() => document.body.innerText")
            rec('D-8 업체 이름 · 전화번호를 보여 주지 않음(배분은 서버가 1곳으로 정함)', not re.search(r'01[016789][-. ]?\d{3,4}[-. ]?\d{4}', names) and '(시험)' not in t, '')
            shot('web_detail')
            go.click(); pg.wait_for_url(f'**/mal/consult/{code}/apply', timeout=15000)
            rec('D-9 「상담 신청」을 누르면 신청서(/mal/consult/{code}/apply)', pg.url.endswith(f'/mal/consult/{code}/apply') and pg.locator('input[name=phone]').count() == 1, pg.url)
        else: rec('D-1 업종 상세', False, '받는 업종이 없음')
        if shut:
            c = shut[0]; r = pg.goto(SITE + f"/mal/consult/{c['code']}", wait_until='networkidle')
            rec('D-10 받을 업체가 없는 업종의 상세 — 「상담 신청」 대신 막힌 「준비 중」과 까닭 · 신청서로 가는 링크 없음', r.status == 200 and pg.locator('.mal-cd-bar button.mal-cd-go[disabled]').count() == 1 and pg.locator(f"a[href='/mal/consult/{c['code']}/apply']").count() == 0 and '아직' in pg.inner_text('.mal-cd-bar'), r.status)
        else: rec('D-10 받을 업체가 없는 업종의 상세 — (지금 DB 에는 그런 업종이 없어 보지 못함)', True, '')
        if dirs:
            c = dirs[0]; r = pg.goto(SITE + f"/mal/consult/{c['code']}", wait_until='networkidle')
            rec('D-11 법률 · 세무 — 같은 주소에서 사무소 목록(「광고」 표시) · 상담 신청 단추 없음', r.status == 200 and pg.locator(f"[data-consult-dir='{c['code']}']").count() == 1 and '광고' in pg.inner_text('main') and pg.locator("a[href$='/apply']").count() == 0, r.status)
            sd, dj = call('GET', f"/consult/directory/{c['code']}"); ent = (dj or {}).get('entries', []) if isinstance(dj, dict) else []
            shown = [norm(x) for x in pg.locator('[data-dir-entry] .mal-row-l b').all_inner_texts()]; tels = [a.get_attribute('href') for a in pg.locator('[data-dir-entry] a[href^="tel:"]').all()]
            rec('D-11b 법률 · 세무 — 시험용 사무소가 보임(이름이 「(시험)」으로 시작 · 전화 링크) · 보이는 사무소가 API 와 같음(다른 사무소가 게재 중이면 그것도 같이 보임)', len(ent) >= 1 and sorted(shown) == sorted(x['displayName'] for x in ent) and any(x.startswith('(시험)') for x in shown) and len(tels) == len(ent), (shown, tels))
            shot('web_legal')
        r = pg.goto(SITE + '/mal/consult/CSL_NOPE', wait_until='networkidle'); rec('D-12 없는 업종 → 404', r.status == 404, r.status)

        # ── A ── 신청서
        if one:
            code = one['code']; r = pg.goto(SITE + f'/mal/consult/{code}/apply', wait_until='networkidle')
            rec('A-1 /mal/consult/{code}/apply → 200 · 신청서(이름 · 휴대폰 · 지역 · 동의) · 업종이 고정', r.status == 200 and all(pg.locator(s).count() == 1 for s in ('input[name=name]', 'input[name=phone]', 'select[name=sido]', 'input[name=agree]')) and one['name'] in pg.inner_text('h1'), r.status)
            bk = pg.locator('a.mal-back, .pc-bkbar a.pc-bkl').first   # v10.31 — 공통 「← … (으)로 돌아가기」 줄(BackBar)
            rec('A-2 돌아가기 — 그 업종의 상세로', bk.count() == 1 and bk.get_attribute('href') == f'/mal/consult/{code}', bk.get_attribute('href') if bk.count() else None)
            shot('web_apply')
        if dirs:
            c = dirs[0]; pg.goto(SITE + f"/mal/consult/{c['code']}/apply", wait_until='networkidle')
            rec('A-3 법률 · 세무의 신청서 주소 → 사무소 목록으로 보냄(신청서 없음)', pg.url.endswith(f"/mal/consult/{c['code']}") and pg.locator('input[name=phone]').count() == 0, pg.url)
        if shut:
            c = shut[0]; r = pg.goto(SITE + f"/mal/consult/{c['code']}/apply", wait_until='networkidle')
            rec('A-4 받을 업체가 없는 업종의 신청서 주소 — 신청서 없이 안내', r.status == 200 and pg.locator('input[name=phone]').count() == 0 and '아직 받지 않습니다' in pg.inner_text('main'), r.status)
        r = pg.goto(SITE + '/mal/consult/CSL_NOPE/apply', wait_until='networkidle'); rec('A-5 없는 업종의 신청서 → 404', r.status == 404, r.status)

        # ── F ── 상담하기 (전에 「준비 중」이던 이사짐 → 없으면 첫 받는 업종)
        tgt = by.get('CSL_MOVING') if by.get('CSL_MOVING') and is_open(by['CSL_MOVING']) else first
        if tgt:
            st, d = call('GET', f"/consult/categories/{tgt['code']}"); sido = (d.get('regions') or [{}])[0].get('sido') if isinstance(d, dict) else None
            pg.goto(SITE + f"/mal/consult/{tgt['code']}", wait_until='networkidle'); pg.locator('.mal-cd-bar a.mal-cd-go').click(); pg.wait_for_url('**/apply', timeout=15000)
            pg.fill('input[name=name]', '화면 시험'); pg.fill('input[name=phone]', '010' + ''.join(random.choice('0123456789') for _ in range(8))); pg.fill('input[name=email]', 'consult.test@example.com')
            if sido: pg.select_option('select[name=sido]', sido)
            pg.check('input[name=agree]'); pg.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click(); pg.wait_for_timeout(1500)
            dev = pg.locator('[data-dev-code]'); code = dev.get_attribute('data-dev-code') if dev.count() else None
            rec(f"F-1 {tgt['name']} · {sido} — 신청서를 내면 인증번호 단계로(개발 환경은 번호를 화면에 보여 줌)", pg.locator('[data-consult-verify]').count() == 1 and bool(code), (pg.locator('[data-consult-verify]').count(), code, norm(pg.inner_text('main'))[-200:]))
            if code:
                pg.fill('[data-consult-verify] input[name=otp]', code); pg.locator('form.mal-form button[type=submit]').click(); pg.wait_for_timeout(2000)
                t = norm(pg.inner_text('main'))
                dn = pg.locator('[data-consult-done]')
                rec('F-2 인증번호 확인 → 접수 완료 표시 · 상태가 「업체 1곳에 전달」(DELIVERED)', dn.count() == 1 and dn.get_attribute('data-consult-state') == 'DELIVERED', (dn.get_attribute('data-consult-state') if dn.count() else None, t[-200:]))
                shot('web_done')
                # (정리) 시험 신청을 운영 API 로 종료 — 시연용 업체에 미열람 배정이 쌓이지 않게(G-155)
                lid = dn.get_attribute('data-consult-done') if dn.count() else None
                stc = call('POST', f'/admin/leads/{lid}/close', login('admin@x.com'), {'reason': 'srv_fin_ui 화면 시험 신청 — 시험 뒤 정리'})[0] if lid else 0
                rec('F-3 (정리) 시험 신청을 운영 API 로 종료', bool(lid) and stc < 300, (lid, stc))
        else: rec('F-1 상담하기', False, '받는 업종이 없음')

        # ── M ── 좁은 화면
        m = b.new_context(viewport={'width': 390, 'height': 844}); mp = m.new_page(); wide = []
        for u in ['/mall?axis=consult'] + ([f"/mal/consult/{one['code']}", f"/mal/consult/{one['code']}/apply"] if one else []):
            mp.goto(SITE + u, wait_until='networkidle'); o = mp.evaluate(OVER)
            if o['sw'] > o['iw'] + 1: wide.append((u, o))
            if SHOT: mp.screenshot(path=f"{SHOT}/web_390_{re.sub(r'[^a-zA-Z]+', '_', u).strip('_')}.png", full_page=False)
        rec('M-1 390px — 목록 · 업종 상세 · 신청서에서 가로 넘침 없음', not wide, wide)
        if one:
            mp.goto(SITE + f"/mal/consult/{one['code']}", wait_until='networkidle')
            bb = mp.evaluate("() => { const e = document.querySelector('.mal-cd-bar .mal-cd-go'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.height)] }")
            rec('M-2 390px — 맨 아래 줄의 「상담 신청」이 화면 안에 있고 높이 44px 이상', bool(bb) and bb[0] >= 0 and bb[1] <= 390 and bb[2] >= 44, bb)
        m.close()

        # ── O ── 그 밖
        res = []
        for u in ('/mall', '/mall/list', '/mal/give', '/partner/apply'):
            r = pg.goto(SITE + u, wait_until='networkidle'); res.append((u, r.status))
        rec('O-1 안심소개의 다른 화면(매물 축 · 매물 목록 · 소개하기 안내 · 입점 신청)은 그대로 열림', all(s == 200 for _, s in res), res)
        rec('Z-0 화면 오류(스크립트 · 다시 그리기) 0', not errs, errs[:3])
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'srv_fin_ui.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
