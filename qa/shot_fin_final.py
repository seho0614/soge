"""v10.24 반영 뒤 — 킷의 시안과 킷의 실제 웹(개발분)을 나란히 찍습니다. 결과: /home/claude/design_1007/cmp24/final/생활금융_v10.24_*.png

  시안 = 킷의 spec/proto.html · 개발분 = 킷을 띄운 사용자 웹(5174 · 개발 DB · 시험용 업체 시드까지).
  실제 신청 1건을 넣어 접수 화면을 찍고, 끝에 운영 API 로 종료합니다.     사용: API=http://localhost:3000 python3 shot_fin_final.py
"""
import os, random, shutil
from playwright.sync_api import sync_playwright
import shot_fin as S
from detail_fixture import call, login

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
P = 'file://' + K + '/sgb/spec/proto.html'; W = os.environ.get('SITE', 'http://localhost:5174')
TMP = '/home/claude/design_1007/cmp24/final_raw'; OUT = '/home/claude/design_1007/cmp24/final'
os.makedirs(TMP, exist_ok=True); os.makedirs(OUT, exist_ok=True)
S.OUT = TMP


def shoot():
    lid = None
    with sync_playwright() as p:
        b = p.chromium.launch()
        def snap(pg, name, full=True):
            pg.wait_for_timeout(350); pg.evaluate(S.CLEAN); pg.screenshot(path=f'{TMP}/{name}.png', full_page=full)
        for w, h, sfx in ((1280, 900, ''), (390, 844, '_390')):
            full = w > 400
            c = b.new_context(viewport={'width': w, 'height': h}); pg = c.new_page()
            pg.goto(P + '#/g/mal/consult'); pg.wait_for_timeout(1400); snap(pg, 'p_list' + sfx, full)
            pg.goto(P + '#/mal/consult/CSL_MOVING'); pg.wait_for_timeout(700); snap(pg, 'p_detail' + sfx, full)
            pg.goto(P + '#/mal/consult/CSL_MOVING/apply'); pg.wait_for_timeout(700); snap(pg, 'p_form' + sfx, full)
            pg.fill('#csl-name', '김시안'); pg.fill('#csl-tel', '010-1234-5678'); pg.locator('[data-csl-otp]').click(); pg.wait_for_timeout(150)
            pg.select_option('#csl-area', index=1); pg.check('#csl-agree'); pg.locator('[data-csl-submit]').click(); snap(pg, 'p_done' + sfx, full)
            pg.goto(P + '#/mal/consult/CSL_LEGAL'); pg.wait_for_timeout(700); snap(pg, 'p_legal' + sfx, full)
            c.close()
            c = b.new_context(viewport={'width': w, 'height': h}); pg = c.new_page()
            for u in ('/mall?axis=consult', '/mal/consult/CSL_MOVING', '/mal/consult/CSL_LEGAL'): pg.goto(W + u, wait_until='networkidle')      # 기억해 둔 예전 자료가 아니라 새 자료로(G-161)
            pg.wait_for_timeout(2500)
            pg.goto(W + '/mall?axis=consult', wait_until='networkidle'); snap(pg, 'w_list' + sfx, full)
            pg.goto(W + '/mal/consult/CSL_MOVING', wait_until='networkidle'); snap(pg, 'w_detail' + sfx, full)
            pg.goto(W + '/mal/consult/CSL_MOVING/apply', wait_until='networkidle'); snap(pg, 'w_form' + sfx, full)
            if full:
                pg.fill('input[name=name]', '김개발'); pg.fill('input[name=phone]', '010' + ''.join(random.choice('0123456789') for _ in range(8)))
                pg.select_option('select[name=sido]', '서울'); pg.check('input[name=agree]'); pg.locator('form.mal-form button[type=submit]').click(); pg.wait_for_timeout(1500); snap(pg, 'w_verify', full)
                code = pg.locator('[data-dev-code]').get_attribute('data-dev-code')
                pg.fill('[data-consult-verify] input[name=otp]', code); pg.locator('[data-consult-verify] button[type=submit]').click(); pg.wait_for_timeout(2000); snap(pg, 'w_done', full)
                dn = pg.locator('[data-consult-done]'); lid = dn.get_attribute('data-consult-done') if dn.count() else None
            pg.goto(W + '/mal/consult/CSL_LEGAL', wait_until='networkidle'); snap(pg, 'w_legal' + sfx, full)
            c.close()
        b.close()
    if lid:
        st = call('POST', f'/admin/leads/{lid}/close', login('admin@x.com'), {'reason': '비교 그림용 신청 — 찍은 뒤 정리'})[0]; print('정리', lid[:8], st)
    else: print('정리할 신청 없음(접수 화면을 찍지 못함)')


def compose():
    L = lambda n: f'{TMP}/{n}.png'; N = S.NEW; G = '#0f5132'
    S.OUT = OUT
    S.row([S.col(L('p_list'), '시안(v10.24) — 목록', N, 1500), S.col(L('w_list'), '개발분(v10.24) — 목록 · 시험용 업체로 20업종 모두 받는 중', G, 1500)], '생활금융_v10.24_1_목록_시안_개발분.png')
    S.row([S.col(L('p_detail'), '시안 — 업종 상세(SB-MAL-CSL-025)', N, 1250), S.col(L('w_detail'), '개발분 — 업종 상세(/mal/consult/CSL_MOVING)', G, 1250)], '생활금융_v10.24_2_업종상세_시안_개발분.png')
    S.row([S.col(L('p_form'), '시안 — 신청서(…/apply)', N, 880), S.col(L('w_form'), '개발분 — 신청서(/mal/consult/CSL_MOVING/apply)', G, 880)], '생활금융_v10.24_3_신청서_시안_개발분.png')
    S.row([S.col(L('p_done'), '시안 — 접수(시연)', N, 620), S.col(L('w_verify'), '개발분 — 인증번호 확인', G, 620), S.col(L('w_done'), '개발분 — 접수(업체 1곳 전달)', G, 620)], '생활금융_v10.24_4_접수_시안_개발분.png')
    S.row([S.col(L('p_legal'), '시안 — 법률(사무소 보기 · 시연 3곳)', N, 700), S.col(L('w_legal'), '개발분 — 법률(시험용 사무소 1곳 · 「광고」)', G, 700)], '생활금융_v10.24_5_법률_시안_개발분.png')
    items = [('p_list_390', '시안 목록', N), ('p_detail_390', '시안 상세', N), ('p_form_390', '시안 신청서', N), ('w_list_390', '개발분 목록', G), ('w_detail_390', '개발분 상세', G), ('w_form_390', '개발분 신청서', G)]
    S.row([S.col(L(k), lab, tone, 844, 390) for k, lab, tone in items], '생활금융_v10.24_6_좁은화면.png')
    src = '/home/claude/design_1007/cmp24/same_defect_before_after.png'
    if os.path.exists(src): shutil.copy(src, OUT + '/생활금융_v10.24_7_같이고친화면_전후.png'); print('7 copied')


if __name__ == '__main__':
    import sys
    if '--compose' not in sys.argv: shoot()
    compose()
