"""v10.286 (D213 · docs/412) — 운영자 게시판

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1286.py

  ① (코드) D213(게시판 · 고친 기록 · 댓글 · 확인 · 급한 알림 한 번 · 보관 설정 · 자동 글 함수 · 정리) · API(운영 역할만) · 자동 글 4곳 · 화면 · 명세 · 문서 412 · 마이그레이션 251 · 판 v10.286
  ② (DB) 자동 글 → 게시판 + 관리자 공지 사본(2일) · 댓글 고칠 수 없음 · 운영자 글은 쓴 사람 필수 · 정리는 기간 지난 자동 글만(운영자 글 · 고정 남김)
  ③ (API) 운영자 글쓰기 · 목록 · 확인함 · 댓글 · 다른 운영자는 고치기 · 내리기 403 · 자동 글 내용 409(고정은 됨) · 내리기 사유 · 내린 글 409 · 회원 403
  ④ (자동 글) 하루 요약(정기 작업 launch_digest) · 급한 알림(launch_watch · 한 번만) — 텔레그램 · 슬랙 결과 · 관리자 공지 사본(첫 화면 「관리자 공지」) · 시험 메시지
  ⑤ (화면) 위험감지 › 「운영자 게시판」 목록 · 걸러 보기 · 글 열기 · 확인함 · 글쓰기 · 보관 기간(SUPER)
  만든 글은 내려 두고 설정은 처음대로(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
M13 = rd('prisma/migrations/D213_ops_board/migration.sql')
BS, BC = rd('src/modules/admin/ops-board.service.ts'), rd('src/modules/admin/ops-board.controller.ts')
SCH, OA, AD, AM, SS = rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/ops-alerts.service.ts'), rd('src/modules/admin/admin.service.ts'), rd('src/app.module.ts'), rd('src/modules/site/site.service.ts')
OB, MENU, APP, EN = rd('web/src/app/admin/OpsBoard.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/common/i18n/server-text.en.ts')
SCR = rd('spec/screens.json')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D412 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('412_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []

ok('① D213 — 게시판 · 고친 기록 · 댓글(고칠 수 없음) · 확인 · board_posted_at · 보관 365 · fn_ops_board_post(관리자 공지 2일) · fn_ops_board_purge · 정기 작업 04:40',
   all(f'CREATE TABLE IF NOT EXISTS public.{t}' in M13 for t in ('ops_board_posts', 'ops_board_revisions', 'ops_board_comments', 'ops_board_reads'))
   and 'trg_ops_board_comments_keep' in M13 and 'ADD COLUMN IF NOT EXISTS board_posted_at' in M13 and "('ops.board_retention_days', '365'" in M13
   and "ARRAY['STAFF'], now(), now() + interval '2 days', false" in M13 and 'FUNCTION public.fn_ops_board_purge()' in M13 and "('ops_board_purge', 1440, 4, 40," in M13, '')
ok('① API — 운영 역할만 · 목록 · 글 · 쓰기 · 고치기(쓴 사람 · SUPER · 자동 글 고정만) · 내리기 · 댓글 · 확인함 · 감사 · 보관 설정 SUPER',
   "@Roles(...STAFF)" in BC and "'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'" in BC
   and all(x in BC for x in ("@Post(':id/take-down')", "@Post(':id/comments')", "@Post(':id/read')", "@Audit('OPS_BOARD_POST', 'OPS_BOARD')", "@Audit('OPS_BOARD_UPDATE', 'OPS_BOARD')"))
   and all(x in BS for x in ("'AUTO_POST_LOCKED'", "'NOT_AUTHOR'", "'POST_TAKEN_DOWN'", 'fn_ops_board_post($1, $2, $3, $4, $5)'))
   and "'ops.board_retention_days']" in AD and 'OpsBoardController' in AM and 'OpsBoardService' in AM, '')
ok('① 자동 글 4곳 — 하루 요약 · 급한 알림(alertBoard · 한 번) · 대표 할 일 주간 · 시험 메시지(텔레그램 · 슬랙) · 정리 정기 작업 · 끝난 사본은 공지 목록에서 뺌',
   "opsBoardPost(this.db, 'DAILY_DIGEST'" in SCH and 'private async alertBoard(' in SCH and 'board_posted_at = now()' in SCH and "opsBoardPost(this.db, 'OWNER_TODO'" in SCH
   and "case 'ops_board_purge':" in SCH and OA.count("opsBoardPost(this.db, 'TEST'") == 4 and 'FROM ops_board_posts o WHERE o.notice_id = n.id' in SS, '')
ok('① 화면 · 명세 · 문서 — 위험감지 묶음 「운영자 게시판」(운영 역할 모두) · 목록 · 거름 · 글 · 확인함 · 댓글 · 글쓰기 · 보관 기간 · 명세 · 영어 · 문서 412 · 마이그레이션 251 · 판 v10.286',
   "['ops-board', '운영자 게시판']" in MENU and "'server-errors', 'ops-board'] }" in MENU and "'ops-board': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF']" in APP
   and "{tab === 'ops-board' && <OpsBoard />}" in APP and all(x in OB for x in ('data-ops-board-row=', 'data-ops-board-unread', 'data-ops-board-read', 'data-ops-board-comment', 'data-ops-board-write', 'data-ops-board-retention'))
   and '"id": "SB-ADM-OBD-010"' in SCR and '"POST /admin/ops-board/{id}/take-down"' in SCR and '"게시판 글을 찾을 수 없습니다.": ' in EN
   and bool(D412) and len(mig) in (251, 252, 253, 254, 255) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 286), f'{len(mig)} · {VER} · 412 {bool(D412)}')


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


stamp = str(int(time.time()))[-7:]
REV = f't1286rev{stamp}@x.com'
TAG = f'시험 1286 {stamp}'
T0 = psql('SELECT now()')
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{REV}', '시험검수1286', '{pw}', now()) ON CONFLICT DO NOTHING")
    rid = psql(f"SELECT id FROM accounts WHERE email = '{REV}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1286', true); INSERT INTO account_roles (account_id, role) VALUES ('{rid}', 'REVIEWER') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(REV, PW); consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB, TR = login('admin@x.com'), login('buyer@x.com'), login(REV)
    old_ret = psql("SELECT value FROM site_settings WHERE key = 'ops.board_retention_days'") or '365'
    made = []
    try:
        # ② DB
        pid = psql(f"SELECT fn_ops_board_post('TEST', '{TAG} 자동', '자동 본문', 'NO_TOKEN', NULL)")
        made.append(pid)
        cp = psql(f"SELECT array_to_string(n.grades, ',') || '|' || (n.ends_at BETWEEN now() + interval '47 hours' AND now() + interval '49 hours') || '|' || n.notify FROM ops_board_posts p JOIN notices n ON n.id = p.notice_id WHERE p.id = {pid or 0}")
        aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
        c1 = psql(f"BEGIN; INSERT INTO ops_board_comments (post_id, author_id, body) VALUES ({pid or 0}, '{aid}', 'x'); UPDATE ops_board_comments SET body = 'y' WHERE post_id = {pid or 0}; ROLLBACK;")
        c2 = psql(f"BEGIN; INSERT INTO ops_board_posts (kind, title, body) VALUES ('STAFF', 'x', 'y'); ROLLBACK;")
        c3 = psql(f"""BEGIN;
INSERT INTO ops_board_posts (kind, title, body, created_at) VALUES ('TEST', '{TAG} 옛 자동', 'x', now() - interval '10 days');
INSERT INTO ops_board_posts (kind, title, body, created_at, is_pinned) VALUES ('TEST', '{TAG} 옛 고정', 'x', now() - interval '10 days', true);
INSERT INTO ops_board_posts (kind, title, body, created_at, author_id) VALUES ('STAFF', '{TAG} 옛 운영자', 'x', now() - interval '10 days', '{aid}');
UPDATE site_settings SET value = '5' WHERE key = 'ops.board_retention_days';
SELECT posts FROM fn_ops_board_purge();
SELECT string_agg(title, ',' ORDER BY title) FROM ops_board_posts WHERE title LIKE '{TAG} 옛%';
ROLLBACK;""")
        ok('② DB — 자동 글 → 관리자 공지 사본(STAFF · 2일 · 알림 없음) · 댓글 고치기 막힘(OPSB) · 운영자 글은 쓴 사람 필수 · 정리는 기간 지난 자동 글만(고정 · 운영자 글 남김)',
           cp == 'STAFF|true|false' and 'OPSB' in c1 and 'ck_ops_board_author' in c2 and c3.endswith(f'{TAG} 옛 고정,{TAG} 옛 운영자') and c3.splitlines()[0].isdigit(),
           f'{cp} · {c1[-30:]} · {c3[-80:]}')

        # ③ API
        w = call('POST', '/admin/ops-board', {'title': f'{TAG} 인계', 'body': '야간 인계 본문', 'isPinned': False}, TS)
        wid = w.get('id'); made.append(wid)
        lst = call('GET', '/admin/ops-board?kind=STAFF', None, TR)
        row = next((x for x in (lst.get('items') or []) if x.get('id') == wid), {})
        rd1 = call('POST', f'/admin/ops-board/{wid}/read', None, TR)
        cm = call('POST', f'/admin/ops-board/{wid}/comments', {'body': '확인 — 시험 1286'}, TR)
        det = call('GET', f'/admin/ops-board/{wid}', None, TS)
        un = call('GET', '/admin/ops-board?unread=1&kind=STAFF', None, TR)
        e1 = call('PATCH', f'/admin/ops-board/{wid}', {'title': 'x'}, TR)
        e2 = call('POST', f'/admin/ops-board/{wid}/take-down', {'reason': '내려 봄'}, TR)
        u1 = call('PATCH', f'/admin/ops-board/{wid}', {'body': '고친 본문', 'reason': '오타'}, TS)
        e3 = call('PATCH', f'/admin/ops-board/{pid}', {'body': '자동 고침'}, TS)
        pn = call('PATCH', f'/admin/ops-board/{pid}', {'isPinned': True}, TS)
        e4 = call('POST', f'/admin/ops-board/{wid}/take-down', {'reason': 'x'}, TS)
        dn = call('POST', f'/admin/ops-board/{wid}/take-down', {'reason': '시험 끝'}, TS)
        e5 = call('PATCH', f'/admin/ops-board/{wid}', {'body': '또'}, TS)
        e6 = call('GET', '/admin/ops-board', None, TB)
        det2 = call('GET', f'/admin/ops-board/{wid}', None, TS)
        ok('③ API — 운영자 글 · 다른 운영자 목록 · 확인함 · 댓글 · 상세(확인 2 — 쓴 사람 · 검수 · 댓글 1) · 안 본 것 거름 · 다른 운영자 고치기 · 내리기 403 · SUPER 고치기(기록 1) · 자동 글 내용 409 · 고정 됨 · 사유 짧음 400 · 내림 · 내린 글 409 · 회원 403',
           bool(wid) and row.get('author') and rd1.get('ok') is True and cm.get('ok') is True and len(det.get('reads') or []) == 2 and len(det.get('comments') or []) == 1
           and wid not in [x.get('id') for x in (un.get('items') or [])] and e1.get('code') == 'NOT_AUTHOR' and e2.get('code') == 'NOT_AUTHOR'
           and u1.get('ok') is True and e3.get('code') == 'AUTO_POST_LOCKED' and pn.get('ok') is True and e4.get('_err') == 400 and dn.get('ok') is True
           and e5.get('code') == 'POST_TAKEN_DOWN' and e6.get('_err') == 403 and len(det2.get('revisions') or []) == 1 and det2.get('takenDownAt'),
           f"{wid} · {row.get('author')} · {rd1} · {cm} · 확인 {len(det.get('reads') or [])} · 댓글 {len(det.get('comments') or [])} · {e1.get('code')} · {e2.get('code')} · {e3.get('code')} · {e4.get('_err')} · {e5.get('code')} · {e6.get('_err')} · rev {len(det2.get('revisions') or [])}")

        # ④ 자동 글
        call('POST', '/admin/jobs', {'job': 'launch_digest'}, TS)
        dg = psql(f"SELECT p.kind || '|' || coalesce(p.telegram, '-') || '|' || coalesce(p.slack, '-') || '|' || array_to_string(n.grades, ',') FROM ops_board_posts p JOIN notices n ON n.id = p.notice_id WHERE p.kind = 'DAILY_DIGEST' AND p.created_at >= '{T0}' ORDER BY p.id DESC LIMIT 1")
        psql(f"INSERT INTO ops_alerts (alert_code, severity, title, raised_at) VALUES ('T1286_CRIT', 'CRITICAL', '{TAG} 급한 시험 알림', clock_timestamp())")
        call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        ug = psql(f"SELECT count(*) FROM ops_board_posts WHERE kind = 'URGENT' AND created_at >= '{T0}' AND body LIKE '%{TAG} 급한 시험 알림%'")
        bp = psql(f"SELECT board_posted_at IS NOT NULL FROM ops_alerts WHERE alert_code = 'T1286_CRIT' AND title LIKE '{TAG}%'")
        staff = call('GET', '/admin/staff-notices', None, TR)
        seen = any(str(x.get('title', '')).startswith('[운영] 운영 하루 요약') for x in (staff if isinstance(staff, list) else []))
        adm_list = call('GET', '/admin/notices', None, TS)
        seen = seen and not any(str(x.get('title', '')).startswith('[운영] ') for x in (adm_list if isinstance(adm_list, list) else []))   # 콘텐츠 공지 목록에는 사본 없음
        ok('④ 자동 글 — 하루 요약(텔레그램 · 슬랙 결과 · 관리자 공지 사본) · 급한 알림은 두 번 돌아도 한 번 · board_posted_at · 운영 첫 화면 관리자 공지에 사본',
           dg.startswith('DAILY_DIGEST|') and dg.split('|')[1] != '-' and dg.endswith('|STAFF') and ug == '1' and bp == 't' and seen,
           f'{dg} · urgent {ug} · {bp} · staff {seen}')

        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and ADMIN_WEB:
            seen2, perr = {}, []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch()
                    pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120])); pg.on('dialog', lambda d: d.dismiss())
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.wait_for_selector('[data-state-check]', timeout=30000)
                    pg.goto(ADMIN_WEB + '/#/ops-board', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen2['rows'] = pg.locator('[data-ops-board-row]').count()
                    seen2['filter'] = pg.locator('[data-ops-board-filter] select').count()
                    if pg.locator(f'[data-ops-board-open="{pid}"]').count():
                        pg.locator(f'[data-ops-board-open="{pid}"]').first.click(); pg.wait_for_timeout(1500)
                    seen2['detail'] = pg.locator(f'[data-ops-board-detail="{pid}"]').count()
                    seen2['readBtn'] = pg.locator('[data-ops-board-read]').count()
                    seen2['write'] = pg.locator('[data-ops-board-write]').count()
                    seen2['ret'] = pg.locator('[data-ops-board-retention-input]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1286_board.png'), full_page=True)
                    b.close()
            except Exception as ex:
                perr.append(str(ex)[:160])
            ok('⑤ 화면 — 위험감지 › 「운영자 게시판」 목록 · 종류 거름 · 글 열기 · 확인함 · 글쓰기 · 보관 기간(SUPER) · 화면 오류 없음',
               (seen2.get('rows') or 0) >= 2 and seen2.get('filter') == 1 and seen2.get('detail') == 1 and seen2.get('readBtn') == 1
               and seen2.get('write') == 1 and seen2.get('ret') == 1 and not perr, f'{seen2} · {perr[:2]}')
        else:
            print('  (화면 · playwright 없음 — ⑤ 건너뜀)')
    finally:
        psql(f"UPDATE site_settings SET value = '{old_ret}' WHERE key = 'ops.board_retention_days'")
        psql(f"UPDATE ops_board_posts SET is_pinned = false, taken_down_at = coalesce(taken_down_at, now()), taken_down_reason = coalesce(taken_down_reason, '시험 1286 정리') WHERE title LIKE '{TAG}%'")
        for x in psql("SELECT id FROM ops_alerts WHERE alert_code = 'T1286_CRIT' AND acknowledged_at IS NULL").splitlines():
            if x.strip().isdigit():
                call('POST', f'/admin/ops-alerts/{x.strip()}/ack', {'note': '시험 1286 정리'}, TS)
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1286 정리', true); DELETE FROM account_roles WHERE account_id = (SELECT id FROM accounts WHERE email = '{REV}') AND role = 'REVIEWER'; COMMIT;")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
