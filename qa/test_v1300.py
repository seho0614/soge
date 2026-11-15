"""v10.300 (docs/420) — 요율 변경 공지 열람 기록 · CSV(입점 약관 제17조 4항 증거)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1300.py

  ① (코드) 서버 reads · readsCsv(감사 HLT_RATE_READS_EXPORT · 엑셀 수식 막음) · GET …/reads(ADMIN · SUPER) · …/reads/export(SUPER) · 화면 연결 ·
     운영 화면 「읽음 기록」 · 표 · CSV(SUPER) · 영어 사전 · 문서 420 · 판 v10.300
  ② (API) 판매자 A 대상 예약 + 게시 공지 — 읽기 전: A 「안 읽음」 · 읽음 0 / 대상 1 · 예약 안내 알림 때 → A 두 번 · B(대상 아님) 한 번 펼침 →
     A 처음 · 마지막 · 횟수 2 · B 「펼침만」 · 읽음 1 / 대상 1 · 대상 밖 1 / 없는 예약 404 · 회원 403
  ③ (CSV) SUPER 받음 — 머리(범위 · 요율 · 시행일 · 공지 · 읽음 / 대상) · 줄 · 「=」로 시작하는 상호는 ' 붙임 · 감사 HLT_RATE_READS_EXPORT 한 줄(예약 번호) · ADMIN 만인 사람 403
  ④ (화면) 소개몰 › 소개몰 정산 › 「요율 변경 예정」 「읽음 기록」 → 표 2줄 · 읽음 1 / 대상 1 · CSV 단추 · 화면 오류 없음
  예약은 취소 · 판매자 · 알림 · 역할은 지움(공지는 요율 공지라 DB 가 잠가 남음 · 고정만 풂) — 두 번 돌아도 통과.
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
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D420 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('420_')), '')
RS, CT = rd('src/modules/health/health-rate-schedule.service.ts'), rd('src/modules/health/health-seller.controller.ts')
HW, SCR, ST = rd('web/src/app/admin/HealthTypeRates.tsx'), rd('spec/screens.json'), rd('src/common/i18n/server-text.en.ts')
ok('① 서버 — reads(대상 + 펼친 판매자 · 처음 · 마지막 · 횟수 · 알림 · 메일 · 문자 · 안 읽은 곳 위) · readsCsv(BOM · 수식 막음 · 감사 HLT_RATE_READS_EXPORT 예약 번호)',
   'async reads(scheduleId: string' in RS and 'async readsCsv(scheduleId: string' in RS and 'fn_hlt_rate_sched_sellers($2, $3)' in RS
   and 'ORDER BY (nr.first_at IS NULL) DESC' in RS and "'HLT_RATE_READS_EXPORT', 'HLT_COMMISSION', $3::uuid" in RS and "/^[=+\\-@]/.test(t) ? `'${t}`" in RS
   and "'\\uFEFF'" in RS, '')
ok('① API — GET …/reads(ADMIN · SUPER) · GET …/reads/export(SUPER) · 응답 스키마 · 404 · 화면 연결 2줄 · 영어 사전(CSV 안내)',
   re.search(r"@Get\('admin/health/rate-schedules/:id/reads'\)\s*\n\s*@Roles\('ADMIN', 'SUPER'\)", CT) is not None
   and re.search(r"@Get\('admin/health/rate-schedules/:id/reads/export'\)\s*\n\s*@Roles\('SUPER'\)", CT) is not None
   and 'rateNoticeReadsCsv(' in CT and '"GET /admin/health/rate-schedules/{id}/reads"' in SCR and '"GET /admin/health/rate-schedules/{id}/reads/export"' in SCR
   and '"판매자 {0}줄(읽음 {1} / 대상 {2})을 담았습니다 — 받은 기록이 감사 기록에 남습니다.":' in ST, '')
ok('① 화면 — 「읽음 n / 대상 m」 옆 「읽음 기록」 · 표(안 읽음 빨강 · 펼침만) · CSV 받기는 SUPER 만 · 문서 420 · 판 v10.300',
   'data-rate-reads-open=' in HW and 'data-rate-reads={rd.id}' in HW and 'data-rate-reads-row=' in HW and 'data-rate-reads-sum=' in HW
   and "{isSuper && <button className=\"btn-sm\"" in HW and 'data-rate-reads-csv' in HW and "tokenRoles().includes('SUPER')" in HW
   and '읽음 기록' in D420 and 'HLT_RATE_READS_EXPORT' in D420 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 300), VER)


def call(m_, p, b=None, t=None, raw=False):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
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
TAG = f'시험 1300 {stamp}'
SA, SB, ADM = f't1300a{stamp}@x.com', f't1300b{stamp}@x.com', f't1300adm{stamp}@x.com'
CA, CB = f'TN-RA{stamp}', f'TN-RB{stamp}'
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    for e_, nm in ((SA, '시험1300A'), (SB, '시험1300B'), (ADM, '시험운영1300')):
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e_}', '{nm}', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e_, PW)
    aa, ab, am = (psql(f"SELECT id FROM accounts WHERE email = '{e_}'") for e_ in (SA, SB, ADM))
    psql(f"BEGIN; SELECT set_config('app.role_reason', '{TAG}', true); INSERT INTO account_roles (account_id, role) VALUES ('{am}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB, TA, TLA, TLB = login('admin@x.com'), login('buyer@x.com'), login(ADM), login(SA), login(SB)
    sids, sch, nid = [], '', ''
    try:
        for code, acc, nm in ((CA, aa, '시험 가게 1300A'), (CB, ab, '=시험 가게 1300B')):
            sids.append(psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                             f"VALUES ('{code}', '{acc}', 'TENANT', '{nm}', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-{code}') RETURNING id").splitlines()[0])
        nid = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '{TAG} 요율 공지', '요율 본문', ARRAY['SELLER'], now() - interval '1 minute') RETURNING id").splitlines()[0]
        sch = psql(f"INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason, notice_id) "
                   f"VALUES ('SELLER', '{sids[0]}', 10, 20, now() + interval '40 days', '{TAG}', '{nid}') RETURNING id").splitlines()[0]
        ntf = psql(f"INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ('{aa}', 'SELLER_RATE_SCHEDULED', '{TAG} 안내', '본문', '/health/seller/center') RETURNING id").splitlines()[0]
        psql(f"INSERT INTO hlt_rate_notifications (notification_id, schedule_id, kind) VALUES ({ntf}, '{sch}', 'SCHEDULE')")

        # ② 읽기 전
        r0 = call('GET', f'/admin/health/rate-schedules/{sch}/reads', None, TS)
        rows0 = {x.get('code'): x for x in r0.get('rows') or []}
        a0 = rows0.get(CA, {})
        ok('② 읽기 전 — A 한 줄(지금 대상 · 「안 읽음」 · 횟수 0 · 예약 안내 알림 때 있음) · B 없음(대상 아님 · 안 펼침) · 읽음 0 / 대상 1 · 머리(공지 제목 · 게시 · 시행일)',
           r0.get('target') == 1 and r0.get('read') == 0 and r0.get('unread') == 1 and set(rows0) == {CA}
           and a0.get('target') is True and a0.get('firstAt') is None and a0.get('reads') == 0 and bool(a0.get('notifiedAt'))
           and r0.get('noticeTitle') == f'{TAG} 요율 공지' and bool(r0.get('noticePublishedAt')) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', r0.get('effectiveDate') or ''),
           f"{ {k: r0.get(k) for k in ('target', 'read', 'unread', 'noticeTitle', '_err', 'code')} } · {a0}")
        x1 = call('POST', f'/me/health/seller/notices/{nid}/read', None, TLA)
        x2 = call('POST', f'/me/health/seller/notices/{nid}/read', None, TLA)
        x3 = call('POST', f'/me/health/seller/notices/{nid}/read', None, TLB)
        r1 = call('GET', f'/admin/health/rate-schedules/{sch}/reads', None, TA)   # ADMIN 도 봄
        rows1 = r1.get('rows') or []
        by = {x.get('code'): x for x in rows1}
        a1, b1 = by.get(CA, {}), by.get(CB, {})
        ok('② 펼친 뒤(A 두 번 · B 한 번) — A 처음 · 마지막 · 횟수 2 · B 「펼침만」(대상 아님 · 횟수 1) · 읽음 1 / 대상 1 · 안 읽음 0 · 대상 밖 1 · 대상 줄이 먼저 · ADMIN 도 봄',
           x1.get('ok') and x2.get('ok') and x3.get('ok') and r1.get('read') == 1 and r1.get('target') == 1 and r1.get('unread') == 0 and r1.get('outsideRead') == 1
           and a1.get('reads') == 2 and bool(a1.get('firstAt')) and bool(a1.get('lastAt')) and b1.get('target') is False and b1.get('reads') == 1
           and [x.get('code') for x in rows1] == [CA, CB], f"{ {k: r1.get(k) for k in ('read', 'target', 'unread', 'outsideRead', '_err')} } · {a1} · {b1} · {x1} {x3}")
        bad = call('GET', '/admin/health/rate-schedules/00000000-0000-4000-8000-000000000000/reads', None, TS)
        mem = call('GET', f'/admin/health/rate-schedules/{sch}/reads', None, TB)
        ok('② 없는 예약 404 NOT_FOUND · 회원 403', bad.get('_err') == 404 and bad.get('code') == 'NOT_FOUND' and mem.get('_err') == 403, f"{bad} · {mem.get('_err')}")

        # ③ CSV
        au0 = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'HLT_RATE_READS_EXPORT' AND target_id = '{sch}'")
        cv = call('GET', f'/admin/health/rate-schedules/{sch}/reads/export', None, TS)
        au1 = psql(f"SELECT count(*) || '|' || coalesce(max(after_data->>'rows'), '') || '|' || coalesce(max(after_data->>'read'), '') FROM audit.audit_logs WHERE action = 'HLT_RATE_READS_EXPORT' AND target_id = '{sch}'")
        na = call('GET', f'/admin/health/rate-schedules/{sch}/reads/export', None, TA)
        csv = cv.get('csv') or ''
        lines = csv.lstrip('﻿').split('\r\n')
        ok('③ CSV — SUPER 받음 · BOM · 머리(열람 기록 · 범위 판매자 · 요율 10% → 20% · 공지 · 읽음 / 대상 1 / 1) · 열 이름 · A 줄(예 · 2) · B 줄(\'= 붙임 · 펼침만) · 파일 이름 · 안내',
           csv.startswith('﻿') and lines[0] == '요율 변경 공지 열람 기록,입점 약관 제17조 4항' and '범위 · 대상,판매자 시험 가게 1300A' in lines
           and '요율,10% → 20%' in lines and f'공지,{TAG} 요율 공지' in lines and '읽음 / 대상,1 / 1' in lines
           and '판매자 코드,상호,판매자 상태,지금 대상,처음 펼침(한국),마지막 펼침(한국),펼친 횟수,예약 안내 알림(한국),다시 알림,메일 · 문자' in lines
           and any(l.startswith(f'{CA},시험 가게 1300A,ACTIVE,예,') and ',2,' in l for l in lines)
           and any(l.startswith(f"{CB},'=시험 가게 1300B,ACTIVE,아니오(펼침만),") for l in lines)
           and (cv.get('filename') or '').startswith('rate-notice-reads-') and cv.get('rows') == 2 and '판매자 2줄(읽음 1 / 대상 1)' in (cv.get('note') or ''),
           f"{lines[:3]} · {cv.get('filename')} · {cv.get('note')} · {cv.get('_err')}")
        ok('③ 감사 HLT_RATE_READS_EXPORT 한 줄(예약 번호 · 줄 수 2 · 읽음 1) · ADMIN 만인 사람은 CSV 403',
           au1 == f'{int(au0 or 0) + 1}|2|1' and na.get('_err') == 403, f'{au0} → {au1} · {na.get("_err")}')

        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                seen, perr = {}, []
                try:
                    with sync_playwright() as p:
                        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 1000})
                        pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        pg.wait_for_selector('[data-state-check]', timeout=30000)
                        pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        sel = f'[data-rate-reads-open="{sch}"]'
                        seen['btn'] = pg.locator(sel).count()
                        if seen['btn']:
                            pg.click(sel); pg.wait_for_timeout(2000)
                        box = f'[data-rate-reads="{sch}"]'
                        seen['box'] = pg.locator(box).count()
                        seen['rows'] = pg.locator(f'{box} [data-rate-reads-row]').count()
                        seen['sum'] = pg.locator(f'{box} [data-rate-reads-sum]').get_attribute('data-rate-reads-sum') if seen['box'] else None
                        seen['csv'] = pg.locator(f'{box} [data-rate-reads-csv]').count()
                        pg.screenshot(path=os.path.join(HERE, 'v1300_reads.png'))
                        b.close()
                except Exception as ex:
                    perr.append(str(ex)[:160])
                ok('④ 화면 — 소개몰 › 소개몰 정산 › 「요율 변경 예정」 「읽음 기록」 → 표 2줄 · 읽음 1 / 대상 1 · CSV 단추(SUPER) · 화면 오류 없음',
                   seen.get('btn') == 1 and seen.get('box') == 1 and seen.get('rows') == 2 and seen.get('sum') == '1/1' and seen.get('csv') == 1 and not perr, f'{seen} · {perr[:2]}')
            else:
                print('  (화면 · playwright 없음 — ④ 건너뜀)')
    finally:
        if sch:
            psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1300 정리' WHERE id = '{sch}' AND status = 'SCHEDULED'")
        if nid:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{nid}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email IN ('{SA}', '{SB}'))")
        for s_ in sids:
            psql(f"DELETE FROM hlt_sellers WHERE id = '{s_}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '{TAG} 정리', true); DELETE FROM account_roles WHERE account_id = (SELECT id FROM accounts WHERE email = '{ADM}') AND role = 'ADMIN'; COMMIT;")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
