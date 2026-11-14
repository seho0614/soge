"""v10.295 (D217 · docs/416) — 공지 첨부(그림 · PDF · 3개까지)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 ADMIN_WEB=http://localhost:15173 python3 test_v1295.py

  ① (코드) D217 파일 용도 NOTICE_ATTACHMENT · notices.attachments(3개) · 붙은 파일 지우기 막음 · 요율 공지 첨부 잠금 · 붙이기 검사 · GET /notices/{id}/files/{n}
     · 운영 화면 첨부 고르기 · 사용자 웹 4곳(고객센터 · 제휴 · 안심 파트너센터 · 판매자센터) · 화면 연결 · 문서 416 · 마이그레이션 255
  ② (API) 최고 관리자가 그림 · PDF 올림 · 회원은 못 올림 · 공지에 붙임(4개 422 TOO_MANY_FILES · 없는 · 이상한 id 422 FILE_INVALID) · 운영 목록 files(id 포함)
     · 사용자 목록 files(id 없음) · 보는 사람 기준 바이트(회원 200 · 비로그인 404 · 남의 등급 404 · 운영 200 · n 넘으면 404) · PDF 는 내려받기
     · 붙은 파일 지우기 막힘 · 고치기로 첨부 바꿈(고친 기록에 전 첨부) · 게시한 요율 공지 첨부 409 NOTICE_LOCKED
  ③ (화면) 사용자 웹 고객센터 › 공지사항 — 그림이 보이고 PDF 링크 · 운영 화면 노출 › 메인 운영 › 콘텐츠 「공지」 표 첨부 수 · 고치기 첨부 고르기
  시험 공지는 끝냄(고친 기록이 있어 지우지 않음) · 요율 예약은 취소(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB, SITE = os.environ.get('ADMIN_WEB'), os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''



VER = rd('VERSION').strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D416 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('416_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
verok = lambda n: tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, n)
M17 = rd('prisma/migrations/D217_notice_files_translate_rate_send/migration.sql')
SS, PS, PC = rd('src/modules/site/site.service.ts'), rd('src/modules/public/public.service.ts'), rd('src/modules/public/public.controller.ts')
NF, FS, FD = rd('src/modules/site/notice-files.ts'), rd('src/modules/file/file.service.ts'), rd('src/modules/file/file.dto.ts')
HS = rd('src/modules/health/health-seller.service.ts')
MO, NFC = rd('web/src/app/admin/MainOps.tsx'), rd('site/src/components/common/NoticeFiles.tsx')
PG = [rd('site/src/app/support/notices/page.tsx'), rd('site/src/app/partners/notices/page.tsx'), rd('site/src/app/partner/notices/page.tsx'), rd('site/src/components/health/SellerCenter.tsx')]
SCR = rd('spec/screens.json')
EN = rd('src/common/i18n/server-text.en.ts')
BAD = re.compile(r'DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM', re.I)
ok('① D217 — 파일 용도 NOTICE_ATTACHMENT(JPG · PNG · PDF 10MB) · notices.attachments 3개 · 붙은 파일 지우기 막음 · 요율 공지 첨부 잠금 · 지우는 문장 없음',
   "'NOTICE_ATTACHMENT']" in M17 and "('NOTICE_ATTACHMENT', 'application/pdf', 10485760, 'pdf')" in M17 and 'ADD COLUMN IF NOT EXISTS attachments uuid[]' in M17
   and 'CHECK (cardinality(attachments) <= 3)' in M17 and 'trg_files_notice_guard' in M17 and 'NEW.attachments IS DISTINCT FROM OLD.attachments' in M17
   and "'INQUIRY_ATTACHMENT','BROKER_DOC'" in M17 and not BAD.search(M17), f'{len(M17)}')
ok('① 서버 — 올리기는 최고 관리자만 · 붙이기 검사(3개 · READY · 용도) · 첨부 목록 SQL · 바이트 API(보는 사람 기준 · 운영 미리 보기 · PDF 내려받기) · 판매자센터 공지 첨부 · 영어 사전',
   "NOTICE_ATTACHMENT: ['SUPER']" in FS and "'NOTICE_ATTACHMENT'] as const" in FD and 'private async checkNoticeFiles(' in SS and "'TOO_MANY_FILES'" in SS and "'FILE_INVALID'" in SS
   and 'export function noticeFilesSql(' in NF and "@Get('notices/:id/files/:n')" in PC and 'async noticeFile(id: string, n: number)' in PS
   and "array_remove(fn_notice_grades($3::uuid), 'STAFF')" in PS and "'application/pdf' ? 'attachment' : 'inline'" in PS and "noticeFilesSql('notices')" in HS
   and '"올리기를 마친 공지 첨부 파일만 붙일 수 있습니다.":' in EN and '"첨부 파일이 없습니다.":' in EN, '')
ok('① 화면 — 운영 첨부 고르기(등록 · 고치기 · 3개 · 열기 · 빼기) · 표 첨부 수 · 사용자 웹 부품 · 4곳 · 화면 연결(4곳 + 운영 파일 API) · 문서 416 · 마이그레이션 255 · 판 v10.295',
   'function NoticeFilesPick(' in MO and MO.count('<NoticeFilesPick') == 2 and 'data-notice-files=' in MO and "uploadFile(f, 'NOTICE_ATTACHMENT')" in MO
   and '/api/v1/notices/${id}/files/${f.n}' in NFC and all('<NoticeFiles' in x for x in PG) and SCR.count('"GET /notices/{id}/files/{n}"') == 4
   and '"POST /files/{id}/complete"' in SCR and '첨부' in D416 and len(mig) in (255,) and verok(295), f"{[('<NoticeFiles' in x) for x in PG]} · {SCR.count('files/{n}')} · {len(mig)} · {VER}")

def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()



def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps


import base64, hashlib
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
ORIGIN = API.split('/api/v1')[0]


def upload(tok, name, ct, data):
    f = call('POST', '/files', {'purpose': 'NOTICE_ATTACHMENT', 'name': name, 'contentType': ct, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, tok)
    if not f.get('fileId'):
        return f
    u = f['uploadUrl'] if f['uploadUrl'].startswith('http') else ORIGIN + f['uploadUrl']
    urllib.request.urlopen(urllib.request.Request(u, data=data, method=f.get('method', 'PUT'), headers=f.get('headers') or {}), timeout=60)
    return call('POST', f"/files/{f['fileId']}/complete", {}, tok)


def raw(p, t=None):
    hd = {'Authorization': 'Bearer ' + t} if t else {}
    try:
        r = urllib.request.urlopen(urllib.request.Request(API + p, headers=hd), timeout=60)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, b'', {}


stamp = str(int(time.time()))[-7:]
tag = f'F{stamp}X'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    made, rate_sid = [], ''
    try:
        fp, fd, f3, f4 = upload(TS, '안내 그림.png', 'image/png', PNG), upload(TS, '안내문.pdf', 'application/pdf', PDF), upload(TS, 'c.png', 'image/png', PNG), upload(TS, 'd.png', 'image/png', PNG)
        fm = call('POST', '/files', {'purpose': 'NOTICE_ATTACHMENT', 'name': 'm.png', 'contentType': 'image/png', 'size': len(PNG)}, TB)
        ids = [x.get('fileId') for x in (fp, fd, f3, f4)]
        ok('② API — 최고 관리자가 그림 · PDF 올림(READY) · 회원은 공지 첨부를 못 올림(403)',
           all(x.get('status') == 'READY' for x in (fp, fd, f3, f4)) and fm.get('_err') == 403, f"{[x.get('status') for x in (fp, fd, f3, f4)]} · {fm.get('_err')} {fm.get('code')}")
        base = {'body': '첨부 시험 본문', 'grades': ['MEMBER'], 'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 60))}
        c4 = call('POST', '/admin/notices', {**base, 'title': f'시험 1295 {tag} 넷', 'attachments': ids}, TS)
        cx = call('POST', '/admin/notices', {**base, 'title': f'시험 1295 {tag} 없음', 'attachments': ['00000000-0000-4000-8000-000000000000']}, TS)
        cy = call('POST', '/admin/notices', {**base, 'title': f'시험 1295 {tag} 이상', 'attachments': ['nope']}, TS)
        c1 = call('POST', '/admin/notices', {**base, 'title': f'시험 1295 {tag} 회원', 'attachments': [ids[0], ids[1]]}, TS)
        nM = c1.get('id') or ''
        made += [x for x in (nM,) if x]
        cS = call('POST', '/admin/notices', {**base, 'grades': ['SELLER'], 'title': f'시험 1295 {tag} 판매자', 'attachments': [ids[2]]}, TS)
        nS = cS.get('id') or ''
        made += [x for x in (nS,) if x]
        ok('② API — 붙이기 — 4개 422 TOO_MANY_FILES · 없는 파일 · 이상한 id 422 FILE_INVALID · 2개는 등록(순서 그대로)',
           c4.get('_err') == 422 and c4.get('code') == 'TOO_MANY_FILES' and cx.get('code') == 'FILE_INVALID' and cy.get('code') == 'FILE_INVALID'
           and bool(nM) and c1.get('attachments') == [ids[0], ids[1]], f"{c4.get('code')} · {cx.get('code')} · {cy.get('code')} · {c1.get('attachments')}")
        lst = call('GET', f'/admin/notices?q={urllib.parse.quote(tag)}', None, TS)
        row = {x.get('id'): x for x in (lst if isinstance(lst, list) else [])}
        af = row.get(nM, {}).get('files') or []
        pub = call('GET', '/notices', None, TB)
        pf = next((x.get('files') for x in (pub if isinstance(pub, list) else []) if x.get('id') == nM), None) or []
        ok('② API — 운영 목록 files(id · 순서 · 이름 · 형식) · 사용자 목록 files(n · 이름 · 형식 · 크기 · id 없음)',
           [x.get('id') for x in af] == [ids[0], ids[1]] and [x.get('contentType') for x in af] == ['image/png', 'application/pdf'] and af[0].get('name') == '안내 그림.png'
           and [x.get('n') for x in pf] == [0, 1] and all('id' not in x for x in pf) and pf[1].get('size') == len(PDF), f'{af} · {pf}')
        s0, b0, h0 = raw(f'/notices/{nM}/files/0', TB)
        s1, b1, h1 = raw(f'/notices/{nM}/files/1', TB)
        sg, _, _ = raw(f'/notices/{nM}/files/0')
        s2, _, _ = raw(f'/notices/{nM}/files/2', TB)
        ss_, _, _ = raw(f'/notices/{nS}/files/0', TB)
        sa, ba, _ = raw(f'/notices/{nS}/files/0', TS)
        ok('② API — 바이트 — 회원 200(그림 화면에 · PDF 내려받기 · 바이트 그대로) · 비로그인 404 · n 넘음 404 · 남의 등급 404 · 운영은 미리 보기 200',
           s0 == 200 and b0 == PNG and h0.get('Content-Type') == 'image/png' and h0.get('Content-Disposition', '').startswith('inline')
           and s1 == 200 and b1 == PDF and h1.get('Content-Disposition', '').startswith('attachment') and sg == 404 and s2 == 404 and ss_ == 404 and sa == 200 and ba == PNG,
           f"{s0} {h0.get('Content-Disposition', '')[:20]} · {s1} {h1.get('Content-Disposition', '')[:20]} · {sg} · {s2} · {ss_} · {sa}")
        dl = call('DELETE', f'/files/{ids[0]}', None, TS)
        st0 = psql(f"SELECT status FROM files WHERE id = '{ids[0]}'")
        e1 = call('PATCH', f'/admin/notices/{nM}', {'attachments': [ids[1]], 'reason': '시험 1295 첨부 바꿈'}, TS)
        lst2 = call('GET', f'/admin/notices?q={urllib.parse.quote(tag)}', None, TS)
        af2 = next((x.get('files') for x in (lst2 if isinstance(lst2, list) else []) if x.get('id') == nM), None) or []
        rv = call('GET', f'/admin/notices/{nM}/revisions', None, TS)
        rb = ((rv if isinstance(rv, list) else [{}])[0] or {}).get('before') or {}
        dl2 = call('DELETE', f'/files/{ids[0]}', None, TS)
        ok('② API — 붙은 파일은 지우기 막힘(READY 그대로) · 고치기로 첨부 바꿈(PDF 하나) · 고친 기록에 전 첨부 2개 · 뺀 파일은 지울 수 있음',
           not dl.get('ok') and st0 == 'READY' and e1.get('ok') is True and [x.get('id') for x in af2] == [ids[1]] and rb.get('attachments') == [ids[0], ids[1]] and dl2.get('ok') is True,
           f"{dl.get('_err')} {st0} · {e1} · {[x.get('id') for x in af2]} · {rb.get('attachments')} · {dl2.get('ok')}")
        rn = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '시험 1295 {tag} 요율', 'x', ARRAY['SELLER'], now() - interval '1 minute') RETURNING id").splitlines()[0]
        made.append(rn)
        rate_sid = psql(f"INSERT INTO hlt_rate_schedules (scope, target, to_rate, effective_at, reason, notice_id) VALUES ('CATEGORY', 'Z{stamp}', 20, now() + interval '40 days', '시험 1295 잠금', '{rn}') RETURNING id").splitlines()[0]
        lk = call('PATCH', f'/admin/notices/{rn}', {'attachments': [ids[3]], 'reason': '시험 1295'}, TS)
        ok('② API — 게시한 수수료율 공지는 첨부도 고칠 수 없음(409 NOTICE_LOCKED)', lk.get('_err') == 409 and lk.get('code') == 'NOTICE_LOCKED', f"{lk.get('_err')} {lk.get('code')}")

        if SITE or ADMIN_WEB:
            pn = call('POST', '/admin/notices', {**base, 'grades': ['PUBLIC'], 'title': f'시험 1295 {tag} 화면', 'attachments': [ids[1], ids[3]]}, TS).get('id') or ''
            if pn:
                made.append(pn)

            def run(b, seen, perr):
                if SITE:
                    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    ps.goto(SITE + '/support/notices', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    box = f'[data-site-notice="{pn}"]'
                    seen['row'] = ps.locator(box).count()
                    if seen['row']:
                        ps.click(f'{box} summary'); ps.wait_for_timeout(2500)
                    seen['files'] = ps.locator(f'{box} [data-notice-files]').get_attribute('data-notice-files') if ps.locator(f'{box} [data-notice-files]').count() else None
                    seen['img'] = ps.evaluate(f"() => {{ const i = document.querySelector('{box} [data-notice-img]'); return i ? i.naturalWidth : -1 }}")
                    seen['doc'] = ps.locator(f'{box} [data-notice-doc]').count()
                    ps.screenshot(path=os.path.join(HERE, 'v1295_support.png'))
                if ADMIN_WEB:
                    pg = b.new_page(viewport={'width': 1600, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                    pg.fill('[data-notice-q]', tag); pg.click('[data-notice-q-go]'); pg.wait_for_timeout(2000)
                    seen['admCnt'] = pg.locator(f'[data-notice-row="{pn}"] [data-notice-files]').get_attribute('data-notice-files') if pg.locator(f'[data-notice-row="{pn}"] [data-notice-files]').count() else None
                    if pg.locator(f'[data-notice-edit="{pn}"]').count():
                        pg.click(f'[data-notice-edit="{pn}"]'); pg.wait_for_timeout(1000)
                    seen['pick'] = pg.locator('[data-notice-edit-form] [data-notice-files-pick]').get_attribute('data-notice-files-pick') if pg.locator('[data-notice-edit-form] [data-notice-files-pick]').count() else None
                    seen['add'] = pg.locator('[data-notice-files-pick]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1295_admin.png'))
            r = ui(run)
            if r is None:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 고객센터 › 공지사항 펼치면 그림 보임 · PDF 링크 · 운영 「공지」 표 첨부 2 · 고치기 첨부 고르기 2 · 등록 칸 첨부 고르기 · 화면 오류 없음',
                   (not SITE or (seen.get('row') == 1 and seen.get('files') == '2' and (seen.get('img') or 0) > 0 and seen.get('doc') == 1))
                   and (not ADMIN_WEB or (seen.get('admCnt') == '2' and seen.get('pick') == '2' and (seen.get('add') or 0) >= 2)) and not perr, f'{seen} · {perr[:2]}')
    finally:
        if rate_sid:
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1295 정리' WHERE id = '{rate_sid}' AND status = 'SCHEDULED'")
        for x in made:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{x}'")
            psql(f"UPDATE notices SET ends_at = now() WHERE id = '{x}' AND published_at IS NOT NULL AND published_at <= now() AND ends_at IS NULL "
                 f"AND NOT EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = notices.id OR r.cancel_notice_id = notices.id)")
            psql(f"DELETE FROM notice_reads WHERE notice_id = '{x}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
