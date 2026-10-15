"""v10.23 — 「제시 디자인 · 시안 · 개발분(실제 웹)」 비교 그림을 찍습니다.

실제 웹은 DB 의 글을 보여 주므로, 제시 디자인의 1쪽 10줄 + 뒤쪽 글 15건을 **잠깐** 넣고 찍은 뒤 지웁니다.
  - 넣는 글의 본문 끝에 표식(shotcmu-…)을 달아, 끝에 그 표식이 있는 글만 지웁니다. 남은 글 0 · 꺼 둔 규칙 0 을 확인합니다.
  - 「소개 후기」는 거래에 묶여야 하고 거래 당사자만 쓸 수 있습니다(DB 규칙). 그림용이라 그 규칙을 한 번의 묶음 안에서만 끄고 넣습니다.
  - 다른 시험이 돌고 있지 않을 때 돌립니다(글 목록을 보는 시험이 이 글을 볼 수 있습니다).

사용:  python3 shot_cmu.py        결과: OUT(기본 /home/claude/design_1007/cmp23/final)
"""
import os, subprocess, sys, uuid
from playwright.sync_api import sync_playwright
from detail_fixture import member, q, DB, PW
sys.path.insert(0, '/home/claude/design_1007')
from mkcmp import row

SITE = os.environ.get('SITE', 'http://localhost:5174')
PROTO = 'file:///home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'
DESIGN = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/docs/design/plaza_design_20261007.png'
OUT = os.environ.get('OUT', '/home/claude/design_1007/cmp23/final'); os.makedirs(OUT, exist_ok=True)
TAG = 'shotcmu-' + uuid.uuid4().hex[:6]

ROWS = [  # 제시 디자인의 1쪽 — 제목 · 게시판 · 이름 · 날짜 · 조회
    ('식자재 공급처 소개하고 540만원 받은 이야기', 'REVIEW', '김하늘', '2026-09-15 10:00', 1204),
    ('무인 카페 권리금 시세가 궁금해요', 'QNA', '이도윤', '2026-09-15 09:00', 842),
    ('좋은 세무사 소개 부탁드립니다', 'QNA', '박서연', '2026-09-14 10:00', 621),
    ('부산에서 믿을 수 있는 업체 추천해요', 'TRADE', '최민준', '2026-09-14 09:00', 509),
    ('실제로 연결까지 된 병원 사례 공유합니다', 'REVIEW', '정유진', '2026-09-13 15:00', 1087),
    ('요즘 프랜차이즈 창업 어떤가요 ?', 'TRADE', '한지호', '2026-09-13 14:00', 432),
    ('카페 장비 납품 가능한 업체 있을까요 ?', 'QNA', '송예린', '2026-09-13 13:00', 389),
    ('소개로 만난 파트너와 1년 째 거래 중입니다.', 'REVIEW', '윤태현', '2026-09-13 12:00', 954),
    ('소상공인 정책자금 경험 있으신 분 ?', 'QNA', '임수아', '2026-09-13 11:00', 276),
    ('지역별 배달 업체 비교 정리해봤어요', 'TRADE', '조현우', '2026-09-13 10:00', 318),
]
MORE = ['간판 업체 견적 비교한 후기', '상가 임대차 갱신 때 확인할 것', '권리금 계약서 쓸 때 주의할 점', '배달 대행 수수료 요즘 얼마인가요', '포스기 교체 어디서 하셨나요',
        '인테리어 업체 소개받고 만족한 사례', '세무 기장 맡기는 비용이 궁금합니다', '카드 단말기 약정 조건 물어봅니다', '식자재 단가 협상 경험 공유', '직원 채용 공고 어디에 올리세요',
        '정책자금 서류 준비 순서', '프랜차이즈 가맹 계약 전 확인 목록', '권리금 양도 세금 문의', '무인 매장 보안 장비 추천', '소개 수익 정산 받아 본 분 계신가요']


def sql(s):
    p = subprocess.run(['psql', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', s], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:400]
    return p.stdout.strip()


def seed():
    people = {n: member('shot', n) for n in dict.fromkeys(r[2] for r in ROWS)}
    deal = q("select id from deals order by created_at limit 1"); assert deal, '거래가 한 건도 없습니다(소개 후기 글을 넣을 수 없음)'
    ins = []; ids = []
    for t, b, n, d, v in ROWS:
        pid = str(uuid.uuid4()); ids.append(pid)
        ins.append(f"('{pid}','{b}','{people[n]['id']}','{t}','{t} — 소개광장 비교 그림을 찍으려고 잠깐 넣은 글입니다. {TAG}',{repr(deal) if b == 'REVIEW' else 'NULL'},'PUBLISHED',{v},'{d}+09')")
    names = list(people.values())
    for i, t in enumerate(MORE):
        pid = str(uuid.uuid4())
        b = ('QNA', 'TRADE', 'QNA')[i % 3]
        ins.append(f"('{pid}','{b}','{names[i % len(names)]['id']}','{t}','{t} — 소개광장 비교 그림을 찍으려고 잠깐 넣은 글입니다. {TAG}',NULL,'PUBLISHED',{120 + i * 17},'2026-09-{12 - i // 3:02d} 1{i % 3}:00+09')")
    sql("BEGIN; ALTER TABLE posts DISABLE TRIGGER USER; INSERT INTO posts(id, board, author_id, title, body, deal_id, state, views, created_at) VALUES " + ','.join(ins) + "; ALTER TABLE posts ENABLE TRIGGER USER; COMMIT;")
    # 넷째 글(업종 이야기)에 댓글 두 건
    c = [f"('{ids[3]}','{people['이도윤']['id']}','해운대 쪽이면 저도 한 곳 소개받아 잘 쓰고 있습니다.')", f"('{ids[3]}','{people['박서연']['id']}','견적은 두세 군데 받아 보시는 것을 권합니다.')"]
    sql("INSERT INTO post_comments(post_id, author_id, body) VALUES " + ','.join(c) + f"; UPDATE posts SET comment_count = 2 WHERE id = '{ids[3]}'")
    return people, ids


def cleanup():
    sql(f"DELETE FROM post_comments WHERE post_id IN (SELECT id FROM posts WHERE body LIKE '%{TAG}'); DELETE FROM posts WHERE body LIKE '%shotcmu-%'")
    left = q("select count(*) from posts where body like '%shotcmu-%'")
    off = q("select count(*) from pg_trigger where tgrelid='posts'::regclass and not tgisinternal and tgenabled <> 'O'")
    return left, off


def shoot(people, ids):
    with sync_playwright() as p:
        b = p.chromium.launch()
        def page(w, h=1250):
            c = b.new_context(viewport={'width': w, 'height': h}); pg = c.new_page(); return c, pg
        def snap(pg, name, full=False):
            pg.wait_for_timeout(500); pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"); pg.screenshot(path=f'{OUT}/{name}.png', full_page=full)
        # ── 실제 웹
        for w, sfx in ((1500, ''), (390, '_390')):
            c, pg = page(w, 1250 if w > 400 else 844)
            for name, url in (('web_list', '/community'), ('web_list2', '/community?page=2'), ('web_qna', '/community?board=QNA&q=권리금'), ('web_detail', f'/community/{ids[3]}'), ('web_polls', '/community/polls')):
                pg.goto(SITE + url, wait_until='networkidle'); snap(pg, name + sfx)
            if w > 400:
                pg.goto(SITE + '/community', wait_until='networkidle'); snap(pg, 'web_list_full', full=True)
            # 로그인 — 머리줄(나의공간 · 로그아웃) · 글쓰기
            me = people['김하늘']
            pg.goto(SITE + '/login', wait_until='networkidle')
            pg.fill('input[name=email]', me['email']); pg.fill('input[name=password]', PW); pg.locator('button', has_text='로그인').last.click(); pg.wait_for_timeout(2500)
            pg.goto(SITE + '/community/write', wait_until='networkidle'); assert '/community/write' in pg.url, pg.url; snap(pg, 'web_write' + sfx)
            pg.goto(SITE + '/community', wait_until='networkidle'); pg.wait_for_selector('.b2-out', timeout=10000); snap(pg, 'web_list_login' + sfx)
            c.close()
        # ── 시안
        for w, sfx in ((1500, ''), (390, '_390')):
            c, pg = page(w, 1250 if w > 400 else 844)
            for name, h in (('proto_list', '#/community'), ('proto_list2', '#/community?page=2'), ('proto_qna', '#/community?board=QNA&q=권리금'), ('proto_detail', '#/community/4'), ('proto_write', '#/community/write'), ('proto_polls', '#/community/polls')):
                pg.goto(PROTO + h); pg.wait_for_timeout(900)
                if name == 'proto_list': pg.reload(); pg.wait_for_timeout(1200)
                snap(pg, name + sfx)
            if w > 400:
                pg.goto(PROTO + '#/community'); pg.reload(); pg.wait_for_timeout(1200); snap(pg, 'proto_list_full', full=True)
            c.close()
        b.close()


def hyd(ids, n=60):
    """글이 찬 목록 · 글 상세를 여러 번 새로 열어 화면 다시 그리기 오류(React #418 — G-94)가 나는지 셉니다."""
    import json
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for path in ('/community', '/community?page=2', f'/community/{ids[3]}'):
            bad = 0; first = ''
            for rnd in range(n // 6):
                c = b.new_context(viewport={'width': 1280, 'height': 900}); pg = c.new_page(); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
                for i in range(6):
                    errs.clear(); pg.goto(SITE + path, wait_until='networkidle'); pg.wait_for_timeout(150)
                    if errs: bad += 1; first = first or errs[0]
                c.close()
            out.append({'role': 'guest', 'path': path.replace(ids[3], '{글 번호}'), 'n': n, 'errors': bad, 'first': first}); print(f'수화 — {out[-1]["path"]} 오류 {bad} / {n} {first[:80]}', flush=True)
        b.close()
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hyd_cmu.json'), 'w'), ensure_ascii=False, indent=1)


def compose():
    L = lambda s: f'{OUT}/{s}.png'
    row([(DESIGN, '① 제시 디자인'), (L('proto_list_full'), '② 시안 v10.23'), (L('web_list_full'), '③ 개발분(실제 웹)')], f'{OUT}/소개광장_v10.23_비교_A_목록_디자인_시안_개발분.png', H=1170)
    for key, nm in (('list2', 'B_2쪽'), ('qna', 'C_탭_검색'), ('detail', 'D_글상세'), ('write', 'E_글쓰기'), ('polls', 'F_투표')):
        row([(L('proto_' + key), '시안 v10.23'), (L('web_' + key), '개발분(실제 웹)')], f'{OUT}/소개광장_v10.23_비교_{nm}_시안_개발분.png', H=1250)
    row([(L('web_list'), '개발분 — 로그인 전'), (L('web_list_login'), '개발분 — 로그인 뒤(나의공간 · 로그아웃)')], f'{OUT}/소개광장_v10.23_비교_H_로그인_머리줄.png', H=420)
    from PIL import Image, ImageDraw, ImageFont
    F = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-DemiLight.ttc', 22)
    items = [('proto_list_390', '시안 목록'), ('web_list_390', '개발분 목록'), ('proto_detail_390', '시안 글 상세'), ('web_detail_390', '개발분 글 상세'), ('proto_write_390', '시안 글쓰기'), ('web_write_390', '개발분 글쓰기')]
    W = 390 * len(items) + 16 * (len(items) - 1); im = Image.new('RGB', (W, 844 + 50), '#888888'); x = 0
    for k, lab in items:
        cimg = Image.open(L(k)).convert('RGB'); col = Image.new('RGB', (390, 894), '#ffffff'); d = ImageDraw.Draw(col)
        d.rectangle((0, 0, 390, 50), fill='#00245a'); d.text((12, 10), lab, fill='#ffffff', font=F); col.paste(cimg.crop((0, 0, 390, 844)), (0, 50)); im.paste(col, (x, 0)); x += 406
    im.save(f'{OUT}/소개광장_v10.23_비교_G_좁은화면_시안_개발분.png'); print('G', im.size)


if __name__ == '__main__':
    before = q("select count(*) from posts")
    people, ids = seed()
    try:
        shoot(people, ids)
        hyd(ids)
    finally:
        left, off = cleanup()
        print(f'지움 — 남은 그림용 글 {left} · 꺼진 규칙 {off} · 글 수 전 {before} → 뒤 {q("select count(*) from posts")}')
    assert left == '0' and off == '0'
    compose()
