"""v10.40 시험 — ㉮ 검색 팝업(대표 지시 2026-10-14 「검색 결과 보기 링크 삭제 · 결과는 팝업에 · 클릭 시 위치로 · 검색 팝업은 시안의 기능 · 시안은 고치지 말 것」) · ㉯ P2P 와 어긋나던 안내 글 고침

  API=http://localhost:3000/api/v1 SITE=http://localhost:5174 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1040.py

  ① 옛 글이 사용자 웹 · 시안 어디에도 없음(9종 · 10곳)
  ② 화면에서 새 글이 보임 — 로그인 · 정산 · 내 계정 · 나의공간 · 생활금융 상담 상세(본인인증 안 한 개인 · 사업자 정보 없음)
  ③ 화면 안에서만 나오는 글(가입 단계 · 대화 오류 · 추천 후보 · 요금제 안내)은 소스에 새 글이 있는지
  ④ 검색 팝업 — 시안 SPOP 의 기능(관별 요청 · 인기 매물 · 소개자 · 추천 검색어 · 문장 읽기 · ↑↓ · ESC · 머리줄 돋보기) ·
     「통합 검색 결과 보기」 줄 없음 · 결과 줄을 누르거나 Enter 면 그 자리로 · 시안 파일의 검색 부분은 바탕 v10.39 그대로
"""
import os, json, uuid, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

API = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
TAG = uuid.uuid4().hex[:6]
PW = 'sgb-test-1234'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def sql(q):
    r = subprocess.run(['psql', DB, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else 'ERR:' + r.stderr.strip()[:200]


OLD = ['사업자 인증이 끝나야 열리고', '사업자 인증을 마친 회원만 거래를', '사업자 인증은 거래 만들기 · 소개비 제시 · 계약서 발급에 필요합니다',
       '성사돼도 정산 신청이 열리지 않습니다(사업자 인증 필요)', '사업자 인증과 입점 승인을 받은 업체에 연결합니다', '계약서 발급은 사업자 전환 뒤에 됩니다',
       '거래 만들기 · 계약서 발급을 하려면', '판매 등록 · 거래 만들기는 잠겨 있습니다', '요금제 결제는 <b>사업자 회원</b>만']
for o in OLD:
    g = subprocess.run(['grep', '-rlF', o, K + '/site/src', K + '/spec/proto.html'], capture_output=True, text=True).stdout.split()
    ok(f'옛 글 없음 — 「{o[:28]}」', not g, ' '.join(os.path.basename(x) for x in g))

SRC = {'site/src/components/auth/signup/StepTerms.tsx': '승인 전에도 본인인증으로',   # v10.86 — SignupWizard 에서 4단계 화면을 나눔
       'site/src/components/chat/AskChat.tsx': '본인인증을 마친 회원이 거래를 열 수 있습니다',
       'site/src/components/ChatPanel.tsx': '본인인증을 마친 회원이 거래를 열 수 있습니다', 'site/src/components/ai/MatchView.tsx': '성사되면 소개비는 개인으로 받습니다',
       'site/src/components/billing/PlanPicker.tsx': '회원 본인 계정</b>(개인 · 사업자 대표)', 'spec/proto.html': '입점 승인을 받은 파트너(사업자 · 본인인증 개인)에게 연결합니다'}
for f, t in SRC.items():
    ok(f'새 글 — {os.path.basename(f)}', t in open(os.path.join(K, f), encoding='utf-8').read(), t[:40])

def spop_block(src):
    a = src.find('function srcToks('); b = src.find('/* ── SB-ADM-DIC-010', a)
    return src[a:b]
base = subprocess.run(['git', '-C', K, 'show', 'v10.39:sgb/spec/proto.html'], capture_output=True, text=True).stdout
now = open(K + '/spec/proto.html', encoding='utf-8').read()
ok('시안 — 검색(SPOP · srcFind · 결과 화면) 코드가 바탕 v10.39 와 한 글자도 같음(시안은 고치지 않음)', len(spop_block(base)) > 10000 and spop_block(base) == spop_block(now), f'{len(spop_block(now))}자')
nd = [l for l in subprocess.run(['git', '-C', K, 'diff', '-U0', 'v10.39', '--', 'spec/proto.html'], capture_output=True, text=True).stdout.splitlines() if l.startswith('+') and not l.startswith('+++')]
ok('시안 — 바뀐 줄은 제목 줄 · 생활금융 상담 상세 글 두 줄뿐', len(nd) == 2 and '<title>' in nd[0] and '입점 승인을 받은 파트너' in nd[1], str(len(nd)))

E = f'v1040-{TAG}@t.local'
sql(f"""INSERT INTO accounts (email, password_hash, name, account_type, status) VALUES ('{E}', crypt('{PW}', gen_salt('bf', 10)), '글시험{TAG[:3]}', 'INDIVIDUAL', 'ACTIVE')""")
__import__('consent_ok').agree(E, PW)
code = sql("select c.code from categories c left join restricted_industries r on r.code=c.restricted_code and r.gwan_code=c.gwan_code where c.gwan_code='MAL' and c.axis='CONSULT' and c.status='APPROVED' and (r.mode is null or r.mode <> 'GATED' or not r.is_active) order by c.code limit 1")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def text(path):
        pg.goto(SITE + path); pg.wait_for_timeout(1500)
        return pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
    t = text('/login')
    ok('로그인 — 「본인인증을 하셨으면 판매 등록 · 거래 만들기 · 정산도 지금 바로」', '도 지금 바로 됩니다' in t and '사업자로 소개비(세금계산서)를 받을 때' in t, '')
    t = text(f'/mal/consult/{code}')
    ok(f'생활금융 상담 상세({code}) — 「입점 승인을 받은 파트너(사업자 · 본인인증 개인)」', '입점 승인을 받은 파트너(사업자 · 본인인증 개인)에게 연결합니다' in t, '')
    pg.goto(SITE + '/login'); pg.fill('#lg-mail', E); pg.fill('#lg-pw', PW); pg.locator('#lg-pw').press('Enter'); pg.wait_for_timeout(2500)
    t = text('/my/settlement')
    ok('정산 — 「사업자 인증은 사업자로 소개비(세금계산서)를 받으실 때만」', '사업자로 소개비(세금계산서)를 받으실 때만 필요합니다' in t, '')
    t = text('/my/account')
    ok('내 계정 — 「계약서 발급은 본인인증만으로 됩니다」', '본인인증만으로 됩니다' in t, '')
    t = text('/my')
    ok('나의공간 — 사업자 전환 바로가기 설명 「사업자로 소개비(세금계산서)를 받으려면」', '사업자로 소개비(세금계산서)를 받으려면' in t, '')
    # ㉮ 검색 팝업 — 시안 SPOP 기능 · 결과는 팝업 안 · 「검색 결과 보기」 없음 · 누르면 그 자리로
    def pop(path, opener, word, wait=1800):
        pg.goto(SITE + path); pg.wait_for_timeout(1200)
        pg.locator(opener).first.click(); pg.wait_for_selector('.pc-spop.on #spopq', timeout=8000)
        if word is not None: pg.fill('#spopq', word)
        pg.wait_for_timeout(wait)   # 추천 검색어 · 결과는 서버에서 받아 옵니다
        return pg.inner_text('.pc-spop .box')
    lw = sql("select title from listings where status='PUBLISHED' and gwan_code='MNY' and length(title) >= 4 order by published_at desc limit 1")
    lid = sql(f"select id from listings where status='PUBLISHED' and gwan_code='MNY' and title=$${lw}$$ order by published_at desc limit 1")
    t = pop('/money', '#mny-q', lw)
    ok(f'검색 팝업(소개장터) — 「{lw[:16]}」 → 시안 묶음 「인기 매물」이 팝업 안에 · 개수 표시', '인기 매물' in t and pg.locator('.pc-spop .sec .cnt').count() >= 1, t.replace('\n', ' ')[:110])
    ok('검색 팝업 — 「통합 검색 결과 보기」 줄 · 링크 없음', '검색 결과 보기' not in t and pg.locator('.pc-spop [data-spop-all], .pc-spop .sall, .pc-spop a[href^="/search"]').count() == 0, '')
    ok('검색 팝업 — 바닥 글 「Enter 열기 · 고른 줄이 없으면 맨 위 결과」(통합 검색 말 없음)', '고른 줄이 없으면 맨 위 결과' in t and '통합 검색' not in t, '')
    pg.locator('.pc-spop button.it', has_text=lw).first.click(); pg.wait_for_timeout(2500)
    ok('검색 팝업 — 매물 줄을 누르면 그 매물 상세로(팝업 닫힘)', pg.url.endswith(f'/money/{lid}') and pg.locator('.pc-spop.on').count() == 0, pg.url.replace(SITE, ''))
    rq = sql("select title from requests where status='PUBLISHED' and gwan_code='MNY' and length(title) >= 4 and (closes_at is null or closes_at > now()) order by created_at desc limit 1")
    rid = sql(f"select id from requests where status='PUBLISHED' and gwan_code='MNY' and title=$${rq}$$ order by created_at desc limit 1")
    if rq:
        t = pop('/', '#home-q', rq)
        ok(f'검색 팝업 — 요청은 관별 묶음(시안 「소개장터 요청」) · 「{rq[:14]}」', '소개장터 요청' in t, t.replace('\n', ' ')[:100])
        pg.locator('.pc-spop button.it', has_text=rq).first.click(); pg.wait_for_timeout(2500)
        ok('검색 팝업 — 요청 줄을 누르면 그 요청 상세로', f'/request/{rid}' in pg.url, pg.url.replace(SITE, ''))
    t = pop('/money', '#mny-q', lw)
    first = pg.locator('.pc-spop #spopbd button.it').first.locator('.t1').inner_text()
    pg.hover('.pc-spop #spopbd button.it >> nth=-1')   # 마우스가 다른 줄 위에 있어도 Enter 는 맨 위 결과(시안 — 고르기는 ↑↓ 로만)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(2500)
    ok('검색 팝업 — 고른 줄 없이 Enter → 맨 위 결과의 자리로(결과 화면 /search 아님)', '/search' not in pg.url and pg.url.rstrip('/') != SITE + '/money' and first[:10] in pg.inner_text('main'), f'{first[:20]} → {pg.url.replace(SITE, "")}')
    t = pop('/money', '#mny-q', lw)
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(200)
    hot = pg.locator('.pc-spop #spopbd .it.hot').count(); sec = pg.locator('.pc-spop #spopbd button.it').nth(1).locator('.t1').inner_text() if pg.locator('.pc-spop #spopbd button.it').count() > 1 else ''
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    ok('검색 팝업 — ↑↓ 로 줄 고르기(시안) · ESC 로 닫힘', hot == 1 and pg.locator('.pc-spop.on').count() == 0, f'고른 줄 {hot} · 둘째 「{sec[:16]}」')
    t = pop('/', '#home-q', None)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    ok('검색 팝업 — 빈 칸에서 Enter → 「무엇을 소개받고 싶은지 적어 주세요.」(시안) · 추천 검색어 칩', '무엇을 소개받고 싶은지 적어 주세요.' in pg.inner_text('.pc-spop .box') and '추천 검색어' in t, '')
    t = pop('/', '#home-q', '판교에서 부모님 모실만한 한식당')
    ok('검색 팝업 — 문장 검색: 「이렇게 찾습니다」 줄은 읽은 내용만(결과 화면으로 가는 줄 아님)', pg.locator('[data-spop-read]').count() == 1 and pg.locator('[data-spop-read]').evaluate('e => e.tagName') == 'DIV', '')
    pg.goto(SITE + '/community'); pg.wait_for_timeout(1200)
    pg.locator('header.b2-hd .b2-find').click(); pg.wait_for_timeout(600)
    ok('머리줄 돋보기(소개광장 · 소개몰) → 검색 팝업(시안 · 전: 결과 화면 링크)', pg.locator('.pc-spop.on #spopq').count() == 1 and '/search' not in pg.url, pg.url.replace(SITE, ''))
    pg.keyboard.press('Escape')
    pg.goto(SITE + '/'); pg.wait_for_timeout(1200)
    pg.locator('.home-hd .home-icbtn').click(); pg.wait_for_timeout(800)
    ok('메인 머리줄 돋보기 → 검색 팝업(시안 · 히어로 검색칸)', pg.locator('.pc-spop.on #spopq').count() == 1 and '/search' not in pg.url, pg.url.replace(SITE, ''))
    ok('쪽 스크립트 오류 없음', not errs, '; '.join(errs)[:200])
    b.close()

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
