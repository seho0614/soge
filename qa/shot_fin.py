"""v10.24 생활금융 — 「지금 ↔ 바꿀 모양」「시안 ↔ 개발분」 비교 그림을 찍어 나란히 붙입니다.

  지금         시안 = 킷의 v10.23 시안 · 개발분 = 킷 그대로를 새 DB 에 띄운 것(5185 — 새로 설치한 PC 와 같은 상태: 청소만 받는 중)
  바꿀 모양    시안 = 미리보기 시안(/home/claude/pv1024/proto_v1024.html) · 개발분 = 미리보기 사본(5184 · 시험용 업체 시드까지)
  킷 작업본은 건드리지 않습니다.

사용:  python3 shot_fin.py        결과: /home/claude/design_1007/cmp24
"""
import os, random, subprocess, sys
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
P_OLD = 'file://' + K + '/sgb/spec/proto.html'
P_NEW = 'file://' + os.environ.get('PROTO_NEW', '/home/claude/pv1024/proto_v1024.html')
W_OLD = os.environ.get('SITE_OLD', 'http://localhost:5185'); W_NEW = os.environ.get('SITE_NEW', 'http://localhost:5184')
DB_NEW = 'postgresql://sgb:sgb@localhost:5432/sgb_pv'
OUT = os.environ.get('OUT', '/home/claude/design_1007/cmp24'); os.makedirs(OUT, exist_ok=True)
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
F = lambda n: ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-DemiLight.ttc', n)
W = 1280


def psql(sql):
    p = subprocess.run(['psql', DB_NEW, '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', sql], capture_output=True, text=True); assert p.returncode == 0, p.stderr[:300]; return p.stdout.strip()


def shoot():
    with sync_playwright() as p:
        b = p.chromium.launch()
        def ctx(w, h): c = b.new_context(viewport={'width': w, 'height': h}); return c, c.new_page()
        def snap(pg, name, full=True):
            pg.wait_for_timeout(350); pg.evaluate(CLEAN); pg.screenshot(path=f'{OUT}/{name}.png', full_page=full)
        for w, h, sfx in ((W, 900, ''), (390, 844, '_390')):
            full = w > 400
            # ── 시안 · 지금 ──
            c, pg = ctx(w, h)
            pg.goto(P_OLD + '#/g/mal'); pg.wait_for_timeout(1400); pg.evaluate(CLEAN); pg.locator('#screen .axt', has_text='생활 · 금융 상담').first.click(); snap(pg, 'p_old_list' + sfx, full)
            pg.locator('#screen .axrows .axrow', has_text='이사짐').locator('a', has_text='상담 신청').click(); snap(pg, 'p_old_form' + sfx, full)
            pg.fill('#csl-name', '김시안'); pg.fill('#csl-tel', '010-1234-5678'); pg.locator('[data-csl-otp]').click(); pg.wait_for_timeout(150)
            pg.select_option('#csl-area', index=1); pg.check('#csl-agree'); pg.locator('[data-csl-submit]').click(); snap(pg, 'p_old_done' + sfx, full)
            c.close()
            # ── 시안 · 바꿀 모양 ──
            c, pg = ctx(w, h)
            pg.goto(P_NEW + '#/g/mal/consult'); pg.wait_for_timeout(1400); snap(pg, 'p_new_list' + sfx, full)
            pg.goto(P_NEW + '#/mal/consult/CSL_MOVING'); pg.wait_for_timeout(700); snap(pg, 'p_new_detail' + sfx, full)
            pg.goto(P_NEW + '#/mal/consult/CSL_MOVING/apply'); pg.wait_for_timeout(700); snap(pg, 'p_new_form' + sfx, full)
            pg.fill('#csl-name', '김시안'); pg.fill('#csl-tel', '010-1234-5678'); pg.locator('[data-csl-otp]').click(); pg.wait_for_timeout(150)
            pg.select_option('#csl-area', index=1); pg.check('#csl-agree'); pg.locator('[data-csl-submit]').click(); snap(pg, 'p_new_done' + sfx, full)
            pg.goto(P_NEW + '#/mal/consult/CSL_LEGAL'); pg.wait_for_timeout(700); snap(pg, 'p_new_legal' + sfx, full)
            c.close()
            # ── 개발분 · 지금 ──
            c, pg = ctx(w, h)
            pg.goto(W_OLD + '/mall?axis=consult', wait_until='networkidle'); snap(pg, 'w_old_list' + sfx, full)
            pg.goto(W_OLD + '/mal/consult/CSL_CLEANING', wait_until='networkidle'); snap(pg, 'w_old_form' + sfx, full)
            pg.goto(W_OLD + '/mal/consult/CSL_MOVING', wait_until='networkidle'); snap(pg, 'w_old_moving' + sfx, full)
            c.close()
            # ── 개발분 · 바꿀 모양 ──
            c, pg = ctx(w, h)
            pg.goto(W_NEW + '/mall?axis=consult', wait_until='networkidle'); snap(pg, 'w_new_list' + sfx, full)
            pg.goto(W_NEW + '/mal/consult/CSL_MOVING', wait_until='networkidle'); snap(pg, 'w_new_detail' + sfx, full)
            pg.goto(W_NEW + '/mal/consult/CSL_MOVING/apply', wait_until='networkidle'); snap(pg, 'w_new_form' + sfx, full)
            if full:
                pg.fill('input[name=name]', '김개발'); pg.fill('input[name=phone]', '010' + ''.join(random.choice('0123456789') for _ in range(8)))
                pg.select_option('select[name=sido]', '서울'); pg.check('input[name=agree]'); pg.locator('form.mal-form button[type=submit]').click(); pg.wait_for_timeout(1500); snap(pg, 'w_new_verify', full)
                code = pg.locator('[data-dev-code]').get_attribute('data-dev-code')
                pg.fill('[data-consult-verify] input[name=otp]', code); pg.locator('[data-consult-verify] button[type=submit]').click(); pg.wait_for_timeout(2000); snap(pg, 'w_new_done', full)
            pg.goto(W_NEW + '/mal/consult/CSL_LEGAL', wait_until='networkidle'); snap(pg, 'w_new_legal' + sfx, full)
            c.close()
        # ── 규칙은 그대로 — 받을 업체가 없는 업종의 모습(미리보기 DB 에서 한 업종의 시험용 서비스를 잠깐 멈췄다가 되돌립니다) ──
        sid = psql("select s.id from partner_services s join categories c on c.id = s.category_id where c.code = 'CSL_TELCO' and s.title like '(시험)%' limit 1")
        psql(f"update partner_services set status = 'SUSPENDED' where id = '{sid}'")
        try:
            subprocess.run(['curl', '-s', '-o', '/dev/null', W_NEW + '/mall?axis=consult'])
            c, pg = ctx(W, 900)
            import time; time.sleep(61)          # 사용자 웹이 업종 목록을 60초 동안 기억합니다
            pg.goto(W_NEW + '/mal/consult/CSL_TELCO', wait_until='networkidle'); snap(pg, 'w_new_shut_detail')
            pg.goto(W_NEW + '/mall?axis=consult', wait_until='networkidle'); snap(pg, 'w_new_shut_list')
            c.close()
        finally:
            psql(f"update partner_services set status = 'APPROVED' where id = '{sid}'")
            print('되돌림 — 통신사 대리점 받는 업체', psql("select count(distinct e.partner_id) from v_consult_eligible_partner e join categories c on c.id = e.category_id where c.code = 'CSL_TELCO'"), '곳')
        b.close()


def col(path, label, tone, H, w=W):
    im = Image.open(path).convert('RGB')
    if im.size[0] != w: im = im.resize((w, int(im.size[1] * w / im.size[0])), Image.LANCZOS)
    c = Image.new('RGB', (w, H + 64), '#ffffff'); d = ImageDraw.Draw(c)
    d.rectangle((0, 0, w, 64), fill=tone); d.text((20, 12), label, fill='#ffffff', font=F(30))
    c.paste(im.crop((0, 0, w, min(H, im.size[1]))), (0, 64)); return c

def blank(label, text, tone, H, w=W):
    c = Image.new('RGB', (w, H + 64), '#f3f4f6'); d = ImageDraw.Draw(c)
    d.rectangle((0, 0, w, 64), fill=tone); d.text((20, 12), label, fill='#ffffff', font=F(30))
    d.text((w // 2 - 14 * len(text), H // 3), text, fill='#6b7280', font=F(34)); return c

def row(cols, out):
    Wt = sum(c.size[0] for c in cols) + 16 * (len(cols) - 1); H = max(c.size[1] for c in cols)
    r = Image.new('RGB', (Wt, H), '#888888'); x = 0
    for c in cols: r.paste(c, (x, 0)); x += c.size[0] + 16
    r.save(f'{OUT}/{out}'); print(out, r.size)

OLD = '#6b7280'; NEW = '#00245a'
def compose():
    L = lambda n: f'{OUT}/{n}.png'
    row([col(L('p_old_list'), '시안 — 지금(v10.23)', OLD, 1500), col(L('p_new_list'), '시안 — 바꿀 모양', NEW, 1500)], '생활금융_비교_A1_목록_시안.png')
    row([col(L('w_old_list'), '개발분 — 지금(새로 설치한 상태 · 청소만 받는 중)', OLD, 1500), col(L('w_new_list'), '개발분 — 바꿀 모양(시험용 업체로 20업종 모두 받는 중)', NEW, 1500)], '생활금융_비교_A2_목록_개발분.png')
    row([col(L('p_new_detail'), '시안 — 업종 상세(새 화면 · 지금은 없음)', NEW, 1250), col(L('w_new_detail'), '개발분 — 업종 상세(새 화면 · 지금은 없음)', NEW, 1250)], '생활금융_비교_B_업종상세_새화면.png')
    row([col(L('p_old_form'), '시안 — 신청서 지금', OLD, 880), col(L('p_new_form'), '시안 — 신청서 바꿀 모양', NEW, 880)], '생활금융_비교_C1_신청서_시안.png')
    row([col(L('w_old_form'), '개발분 — 신청서 지금(/mal/consult/코드)', OLD, 880), col(L('w_new_form'), '개발분 — 신청서 바꿀 모양(/mal/consult/코드/apply · 내용은 그대로)', NEW, 880)], '생활금융_비교_C2_신청서_개발분.png')
    row([col(L('p_new_done'), '시안 — 접수', NEW, 620), col(L('w_new_verify'), '개발분 — 인증번호 확인', NEW, 620), col(L('w_new_done'), '개발분 — 접수(업체 1곳 전달)', NEW, 620)], '생활금융_비교_D_접수.png')
    row([col(L('w_old_moving'), '개발분 — 지금: 이사짐(받을 업체 없음 · 안내만)', OLD, 760), col(L('w_new_shut_detail'), '개발분 — 바꿀 모양: 받을 업체가 없는 업종(규칙은 그대로 · 단추 막힘)', NEW, 760)], '생활금융_비교_E1_받을업체없는업종.png')
    row([col(L('p_new_legal'), '시안 — 법률(사무소 보기 · 그대로)', NEW, 700), col(L('w_new_legal'), '개발분 — 법률(사무소 보기 · 그대로 · 게재 0곳)', NEW, 700)], '생활금융_비교_E2_법률_세무.png')
    items = [('p_old_list_390', '시안 지금', OLD), ('p_new_list_390', '시안 목록', NEW), ('p_new_detail_390', '시안 상세', NEW), ('p_new_form_390', '시안 신청서', NEW),
             ('w_old_list_390', '개발분 지금', OLD), ('w_new_list_390', '개발분 목록', NEW), ('w_new_detail_390', '개발분 상세', NEW), ('w_new_form_390', '개발분 신청서', NEW)]
    row([col(L(k), lab, tone, 844, 390) for k, lab, tone in items], '생활금융_비교_F_좁은화면.png')


if __name__ == '__main__':
    if '--compose' not in sys.argv: shoot()
    compose()
