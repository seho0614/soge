"""D007 화면 검증 — 실제 파일 올리기 · 열기 (Playwright).

  사이트  등기사항증명서 올리고 소유 확인 요청 → 제출한 문서 보기 · 형식 위장 · 크기 초과
  BO      소유 확인 「문서 열기」 · 마케팅자료 등록(파일) · 심의 큐 「파일 열기」 · 승인 · 파트너가이드 등록(첨부)
  사이트  파트너센터 자료실 · 가이드 「내려받기」 (실제 다운로드 바이트 대조) · 파트너 아닌 회원은 막힘

사용:  SITE=http://localhost:5203 BO=http://localhost:5204 python3 srv_file_ui.py
결과:  srv_file_ui.json
원복:  시험 소유 확인은 BO 에서 거절로 닫고, 시험 자료는 반려 상태로, 시험 가이드는 지웁니다.
"""
import json, os, sys, uuid, subprocess, hashlib, datetime, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)

SITE = os.environ.get('SITE', 'http://localhost:5203').rstrip('/')
BO = os.environ.get('BO', 'http://localhost:5204').rstrip('/')
DB = 'postgresql://sgb:sgb@localhost:5432/sgb'
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
sh = lambda s: subprocess.run(['psql', DB, '-qc', s], capture_output=True, text=True)
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

TAG = uuid.uuid4().hex[:6]
TMP = tempfile.mkdtemp(prefix='d007ui_')
def mk(name, data):
    p = os.path.join(TMP, name); open(p, 'wb').write(data); return p
PDF = b'%PDF-1.4\n% D007 UI ' + TAG.encode() + b'\n' + os.urandom(3000) + b'\n%%EOF\n'
PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b'\x00\x00\x00\rIHDR' + os.urandom(1200)
GPDF = b'%PDF-1.5\n% guide ' + TAG.encode() + b'\n' + os.urandom(1500) + b'\n%%EOF\n'
HTML = b'<html><script>alert(1)</script></html>' + b' ' * 300
f_pdf = mk('등기사항증명서_UI시험.pdf', PDF)
f_fake = mk('위장.pdf', HTML)
f_big = mk('big.pdf', b'%PDF-1.4\n' + b'0' * (10 * 1024 * 1024 + 10))
f_png = mk(f'배너_{TAG}.png', PNG)
f_gpdf = mk(f'가이드첨부_{TAG}.pdf', GPDF)
sha = lambda b: hashlib.sha256(b).hexdigest()

# 시험 매물 — srv_file.py 가 만든 'D007 시험 매물 2' (소유 확인 미제출 또는 거절) 재사용
LID = q("select l.id from listings l join accounts a on a.id=l.owner_account_id left join owner_verifications o on o.listing_id=l.id "
        "where a.email='intro@x.com' and l.title like 'D007 시험 매물%' and coalesce(o.state,'NONE') in ('NONE','REJECTED') order by l.created_at limit 1")
LTITLE = q(f"select title from listings where id='{LID}'")

def site_login(pg, email, pw='sgb-dev-1234'):
    pg.goto(SITE + '/login'); __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form.auth button'); pg.wait_for_timeout(2000)

def bo_login(pg, email='admin@x.com', pw='sgb-dev-1234'):
    pg.goto(BO); pg.wait_for_timeout(600)
    __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)

def watch_content(ctx):
    """새 창이 /files/{id}/content 를 받아 오는지 — 응답 상태 · 바이트 · 헤더를 모읍니다.
    ★ 헤드리스 크로미움은 PDF 를 그리지 않고 내려받기로 돌려 본문을 못 읽습니다(body None) —
      그때는 새 창이 연 **같은 주소(5분 토큰)** 를 같은 문맥으로 다시 받아 대조합니다(fill_bodies)."""
    got = []
    def on_resp(r):
        if '/files/' in r.url and '/content?' in r.url:
            try: body = r.body()
            except Exception: body = None
            got.append((r.status, body, r.headers.get('content-disposition', ''), r.url))
    ctx.on('response', on_resp)
    return got

def fill_bodies(ctx, got):
    for i, (s_, body, cd, u) in enumerate(got):
        if body is None and s_ == 200:
            got[i] = (s_, ctx.request.get(u).body(), cd, u)
    return got

with sync_playwright() as p:
    b = p.chromium.launch()
    # ── 1. 사이트 — 등기사항증명서 올리고 소유 확인 요청
    c = b.new_context(accept_downloads=True); pg = c.new_page()
    site_login(pg, 'intro@x.com')
    pg.goto(f'{SITE}/mal/brokers?mine={LID}#own', wait_until='networkidle')
    form = pg.locator('form', has=pg.locator('input[name=doc]'))
    rec('UI-1 소유 확인 폼에 파일 선택칸 (이름 입력칸 아님)', form.count() == 1 and pg.locator('input[name=docKey]').count() == 0
        and form.locator('input[name=doc]').get_attribute('type') == 'file', LTITLE)
    today = datetime.date.today().isoformat()
    # 1a. 크기 초과 — 화면이 먼저 막음
    form.locator('input[name=doc]').set_input_files(f_big); form.locator('input[name=issuedOn]').fill(today)
    form.locator('button', has_text='소유 확인 요청').click(); pg.wait_for_timeout(800)
    rec('UI-2 10MB 초과 파일 → 화면에서 막음', '10MB' in form.locator('.form-error').inner_text(), form.locator('.form-error').inner_text())
    # 1b. 형식 위장 — 서버가 매직바이트로 거절
    form.locator('input[name=doc]').set_input_files(f_fake)
    form.locator('button', has_text='소유 확인 요청').click(); pg.wait_for_timeout(3500)
    err = form.locator('.form-error').inner_text() if form.locator('.form-error').count() else ''
    rec('UI-3 .pdf 이름의 HTML → 서버가 거절(파일 내용이 PDF 가 아닙니다)', 'PDF 가 아닙니다' in err, err)
    # 1c. 정상
    form.locator('input[name=doc]').set_input_files(f_pdf); form.locator('input[name=issuedOn]').fill(today)
    form.locator('input[name=hasEncumbrance]').check()
    form.locator('button', has_text='소유 확인 요청').click(); pg.wait_for_timeout(5000)
    row = q(f"select o.state||'|'||f.status||'|'||f.sha256||'|'||o.doc_key from owner_verifications o join files f on f.id=o.doc_file_id where o.listing_id='{LID}'")
    DOCID = q(f"select doc_file_id from owner_verifications where listing_id='{LID}'")
    rec('UI-4 실제 파일 올림 → 소유 확인 SUBMITTED · 파일 READY · 해시 일치 · 이름', row == f'SUBMITTED|READY|{sha(PDF)}|등기사항증명서_UI시험.pdf', row)
    pg.goto(f'{SITE}/mal/brokers?mine={LID}#own', wait_until='networkidle')
    btn = pg.locator('button', has_text='제출한 문서 보기')
    got = watch_content(c)
    if btn.count():
        try:
            with c.expect_page(timeout=8000) as pop: btn.first.click()
            pop.value.wait_for_timeout(2500)
        except Exception as e:
            pg.wait_for_timeout(2500)
    fill_bodies(c, got)
    ok = any(s == 200 and body == PDF and cd.startswith('inline') for s, body, cd, _ in got)
    rec('UI-5 「제출한 문서 보기」 → 새 창이 같은 PDF 를 inline 으로 받음', btn.count() == 1 and ok, [(s, cd[:30]) for s, _, cd, _ in got])
    c.close()

    # ── 2. BO — 소유 확인 「문서 열기」 → 거절로 정리
    c = b.new_context(); pg = c.new_page(); bo_login(pg)
    _bo_tab(pg, '소유 확인'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    tr = pg.locator('tr', has_text=LTITLE).filter(has=pg.locator(f'button[data-file-id="{DOCID}"]'))
    got = watch_content(c)
    if tr.count():
        with c.expect_page(timeout=8000) as pop: tr.first.locator('button', has_text='문서 열기').click()
        pop.value.wait_for_timeout(2500)
    fill_bodies(c, got)
    ok = any(s == 200 and body == PDF for s, body, _, _ in got)
    audit = q(f"select count(*) from audit.audit_logs where action='FILE_OPEN' and target_id='{DOCID}' and actor_account_id=(select id from accounts where email='admin@x.com')")
    rec('UI-6 BO 소유 확인 「문서 열기」 → 등기부 원본 바이트 · 감사 기록', tr.count() == 1 and ok and int(audit or 0) >= 1, (tr.count(), [(s, u[-40:]) for s, _, _, u in got], audit))
    pg.once('dialog', lambda d: d.accept('D007 화면 검증 — 시험 제출 정리'))
    if tr.count(): tr.first.locator('button', has_text='거절').click(); pg.wait_for_timeout(1500)
    rec('UI-7 BO 거절(사유) → 정리', q(f"select state from owner_verifications where listing_id='{LID}'") == 'REJECTED')

    # ── 3. BO — 마케팅자료 등록(파일) · 심의 큐 「파일 열기」 · 승인
    _bo_tab(pg, '제휴'); pg.wait_for_timeout(1000)   # v10.29 — 묶음 단추 → .ad-snb 탭
    pg.locator('button', has_text='마케팅자료 · 가이드').first.click(); pg.wait_for_timeout(1500)
    MT = f'D007 화면 시험 배너 {TAG}'
    pg.fill('input[aria-label="자료 제목"]', MT)
    pg.select_option('select[aria-label="자료 형식"]', 'BANNER')
    pg.set_input_files('input[aria-label="자료 파일"]', f_png)
    pg.fill('textarea[aria-label="자료 문구"]', '가을 태양광 상담 이벤트 안내')
    pg.locator('button', has_text='심의 대기로 올리기').click(); pg.wait_for_timeout(4000)
    MID = q(f"select id from marketing_materials where title='{MT}'")
    MF = q(f"select file_id from marketing_materials where id='{MID}'")
    rec('UI-8 BO 자료 등록(PNG 파일) → PENDING · 파일 READY · 해시 일치',
        q(f"select m.state||'|'||f.status||'|'||f.sha256 from marketing_materials m join files f on f.id=m.file_id where m.id='{MID}'") == f'PENDING|READY|{sha(PNG)}', MID)
    tr = pg.locator('tr', has_text=MT)
    got = watch_content(c)
    if tr.count():
        with c.expect_page(timeout=8000) as pop: tr.first.locator('button', has_text='파일 열기').click()
        pop.value.wait_for_timeout(2000)
    fill_bodies(c, got)
    rec('UI-9 심의 큐 「파일 열기」 → 같은 PNG', any(s == 200 and body == PNG for s, body, _, _ in got), [(s, u[-40:]) for s, _, _, u in got])
    # 형식이 맞지 않는 파일 — 영상에 PNG
    pg.fill('input[aria-label="자료 제목"]', f'D007 화면 시험 잘못된 영상 {TAG}')
    pg.select_option('select[aria-label="자료 형식"]', 'VIDEO')
    pg.set_input_files('input[aria-label="자료 파일"]', f_png)
    pg.locator('button', has_text='심의 대기로 올리기').click(); pg.wait_for_timeout(1000)
    rec('UI-10 영상 자료에 PNG → 화면이 막음(MP4 만)', 'MP4' in pg.locator('.flash, [role=alert], .err, .msg-err').first.inner_text()
        if pg.locator('.flash, [role=alert], .err, .msg-err').count() else 'MP4' in pg.inner_text('main'), '')
    if tr.count(): tr.first.locator('button', has_text='승인').click(); pg.wait_for_timeout(1500)
    rec('UI-11 BO 승인 → APPROVED', q(f"select state from marketing_materials where id='{MID}'") == 'APPROVED')

    # ── 4. BO — 파트너가이드 등록(첨부)
    GT = f'D007 화면 시험 가이드 {TAG}'
    pg.fill('input[aria-label="가이드 제목"]', GT); pg.fill('input[aria-label="가이드 순서"]', '1')
    pg.fill('textarea[aria-label="가이드 본문"]', '처음 링크를 만들고 공유하는 순서입니다.')
    pg.set_input_files('input[aria-label="가이드 첨부"]', f_gpdf)
    pg.locator('button', has_text='가이드 올리기').click(); pg.wait_for_timeout(4000)
    GID = q(f"select id from partner_guides where title='{GT}'")
    GF = q(f"select file_id from partner_guides where id='{GID}'")
    rec('UI-12 BO 가이드 등록(PDF 첨부) → 활성 · 파일 READY', q(f"select g.is_active::text||'|'||f.status||'|'||f.sha256 from partner_guides g join files f on f.id=g.file_id where g.id='{GID}'") == f'true|READY|{sha(GPDF)}'
        and pg.locator('tr', has_text=GT).count() == 1, GID)
    c.close()

    # ── 5. 사이트 — 파트너센터 내려받기 (실제 다운로드)
    c = b.new_context(accept_downloads=True); pg = c.new_page(); site_login(pg, 'intro@x.com')
    pg.goto(SITE + '/partners/materials', wait_until='networkidle')
    li = pg.locator('li', has_text=MT)
    if li.count(): li.first.locator('summary').click()
    data = None
    try:
        with pg.expect_download(timeout=10000) as dl: li.first.locator(f'button[data-file-id="{MF}"]').click()
        path = dl.value.path(); data = open(path, 'rb').read(); fname = dl.value.suggested_filename
    except Exception as e:
        fname = str(e)[:80]
    rec('UI-13 파트너 자료실 「내려받기」 → 실제 다운로드 · 같은 PNG · 한글 파일 이름', data == PNG and fname == f'배너_{TAG}.png', fname)
    pg.goto(SITE + '/partners/guides', wait_until='networkidle')
    li = pg.locator('li', has_text=GT)
    if li.count(): li.first.locator('summary').click()
    data = None
    try:
        with pg.expect_download(timeout=10000) as dl: li.first.locator('button', has_text='첨부 내려받기').click()
        data = open(dl.value.path(), 'rb').read(); fname = dl.value.suggested_filename
    except Exception as e:
        fname = str(e)[:80]
    rec('UI-14 파트너가이드 「첨부 내려받기」 → 같은 PDF', data == GPDF and fname == f'가이드첨부_{TAG}.pdf', fname)
    c.close()

    # ── 6. 사이트 — 파트너가 아닌 회원
    c = b.new_context(accept_downloads=True); pg = c.new_page(); site_login(pg, 'buyer@x.com')
    pg.goto(SITE + '/partners/materials', wait_until='networkidle')
    li = pg.locator('li', has_text=MT)
    msg = ''
    if li.count():
        li.first.locator('summary').click()
        li.first.locator(f'button[data-file-id="{MF}"]').click(); pg.wait_for_timeout(1500)
        msg = li.first.locator('[role=alert]').inner_text() if li.first.locator('[role=alert]').count() else ''
    rec('UI-15 파트너 아닌 회원 「내려받기」 → 「파트너로 승인된 계정만」 안내', '파트너로 승인된 계정만' in msg, msg)
    c.close()
    b.close()

# 정리 — 시험 자료는 반려, 시험 가이드는 지움
sh(f"update marketing_materials set state='REJECTED', reject_reason='D007 화면 검증 — 시험 자료 정리' where title like 'D007 화면 시험%' and state <> 'REJECTED'")
sh(f"delete from partner_guides where title like 'D007 화면 시험 가이드%'")
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_file_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
