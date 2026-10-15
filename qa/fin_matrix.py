"""v10.24 — 상담 업종 22종의 「목록 → 상세 → 신청서」 연결표(매트릭스 43번 시트). 결과: fin_matrix.json

  업종마다: 서버 값(방식 · 자격 확인 · 인증업체 수 · 받는 지역) · 목록의 단추 · 상세 주소 · 신청서 주소를 실제로 열어 본 결과(상태 · 끝난 주소 · 화면에 있는 것).
  읽기만 합니다(신청을 넣지 않습니다).   사용: python3 fin_matrix.py     API=http://localhost:3000 · SITE=http://localhost:5174
"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright
from detail_fixture import call

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__))


def main():
    st, cats = call('GET', '/consult/categories'); assert st == 200, st
    for c in cats:                       # 사용자 웹이 기억해 둔 예전 자료가 아니라 새 자료를 보게 먼저 한 번씩 엽니다(G-161)
        for u in (f"/mal/consult/{c['code']}", f"/mal/consult/{c['code']}/apply"):
            try: urllib.request.urlopen(urllib.request.Request(SITE + u, headers={'User-Agent': 'Mozilla/5.0 fin_matrix prime'}), timeout=60).read()
            except Exception: pass
    time.sleep(3)
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.goto(SITE + '/mall?axis=consult', wait_until='networkidle')
        btn = {li.get_attribute('data-csl'): [x.strip() for x in li.locator('.mal-row-r a, .mal-row-r button').all_inner_texts()] for li in pg.locator('.mal-row[data-csl]').all()}
        for c in cats:
            code = c['code']; lead = c['consultMode'] == 'LEAD'; opened = c['status'] == 'APPROVED' and lead and c['partnerCount'] > 0
            sd, d = call('GET', f'/consult/categories/{code}')
            regs = ' · '.join(f"{r['sido']} {r['partnerCount']}" for r in (d or {}).get('regions', [])) if sd == 200 else ''
            r1 = pg.goto(SITE + f'/mal/consult/{code}', wait_until='networkidle'); u1 = pg.url.replace(SITE, '')
            has_det = pg.locator(f'[data-consult-detail="{code}"]').count() == 1; has_dir = pg.locator(f'[data-consult-dir="{code}"]').count() == 1
            go = pg.locator('a.mal-cd-go').count() == 1; shut = pg.locator('.mal-cd-bar button[disabled]').count() == 1
            n_dir = pg.locator('[data-dir-entry]').count()
            r2 = pg.goto(SITE + f'/mal/consult/{code}/apply', wait_until='networkidle'); u2 = pg.url.replace(SITE, '')
            form = pg.locator('form.mal-form input[name=phone]').count() == 1
            if not lead: want = btn.get(code) == ['사무소 보기'] and r1.status == 200 and has_dir and not has_det and u2 == f'/mal/consult/{code}' and not form and n_dir == c['partnerCount']
            elif opened: want = btn.get(code) == ['상세 보기', '상담 신청'] and r1.status == 200 and has_det and go and not shut and r2.status == 200 and u2.endswith('/apply') and form
            else: want = btn.get(code) == ['상세 보기', '준비 중'] and r1.status == 200 and has_det and shut and not go and r2.status == 200 and not form
            rows.append({'code': code, 'name': c['name'], 'mode': '상담신청형(리드)' if lead else '월 정액 노출형(광고)', 'gated': '자격 확인' if c['publishMode'] == 'GATED' else '일반',
                         'partners': c['partnerCount'], 'regions': regs, 'buttons': ' + '.join(btn.get(code) or []), 'detail': f'/mal/consult/{code}', 'detail_status': r1.status,
                         'detail_has': ('사무소 목록 ' + str(n_dir) + '곳') if has_dir else ('업종 상세 · ' + ('「상담 신청」' if go else '막힌 「준비 중」')), 'apply': f'/mal/consult/{code}/apply', 'apply_status': r2.status,
                         'apply_end': u2, 'apply_has': '신청서' if form else ('사무소 목록으로 보냄' if not lead else '안내(받지 않음)'), 'proto': f'#/mal/consult/{code}', 'ok': bool(want)})
        b.close()
    ok = sum(1 for r in rows if r['ok'])
    json.dump({'rows': rows, 'pass': ok, 'total': len(rows)}, open(os.path.join(OUT, 'fin_matrix.json'), 'w'), ensure_ascii=False, indent=1)
    for r in rows:
        if not r['ok']: print('FAIL', r, file=sys.stderr)
    print(f'통과 {ok} / {len(rows)}')


if __name__ == '__main__': main()
