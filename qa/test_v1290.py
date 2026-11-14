"""v10.290 (D216 · docs/414) — 공지 알림 받은 사람 기록 1년 뒤 파기

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1290.py

  ① (코드) D216(설정 privacy.notice_notified_days · fn_purge_notice_notified · 다 보낸 공지만) · pii_purge 가 부름 · 파기 기록 칸 · 문서 414 · 마이그레이션 254 · 판 v10.290
  ② (DB) 다 보낸 공지의 1년 지난 기록만 지움 · 최근 기록 · 아직 보내는 중인 공지 기록 · 펼쳐 본 기록(notice_reads)은 남김 · 일수 설정(30 아래는 30)
  ③ (API) 파기 기록(위험감지 › 파기 기록)에 「공지 알림 기록」 건수 · 회원 403
  설정은 처음대로 · 만든 공지 · 기록은 지움(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
M16 = rd('prisma/migrations/D216_notice_notified_purge/migration.sql')
SCH, RR, PL = rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/role-review.service.ts'), rd('web/src/app/admin/PurgeLog.tsx')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D414 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('414_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []

ok('① D216 — privacy.notice_notified_days 365 · fn_purge_notice_notified(다 보낸 공지만 · 30 ~ 1825) · 시각 색인',
   "'privacy.notice_notified_days', '365'" in M16 and 'CREATE OR REPLACE FUNCTION public.fn_purge_notice_notified()' in M16
   and 'n.notified_at IS NOT NULL' in M16 and 'least(greatest(d, 30), 1825)' in M16 and 'ix_notice_notified_at' in M16
   and 'notice_reads' in M16 and 'DELETE FROM notice_reads' not in M16, f'{len(M16)}')
ok('① 파기 작업 · 기록 · 문서 — pii_purge 가 부름(건수 noticeNotified) · 파기 기록 칸 「공지 알림 기록」 · 문서 414 · 마이그레이션 254 · 판 v10.290',
   'SELECT fn_purge_notice_notified() AS n' in SCH and 'noticeNotified: noticeNotified.n' in SCH and 'taxIds.n + noticeNotified.n' in SCH
   and "'taxIds', 'noticeNotified', 'overdue'" in RR and "['noticeNotified', '공지 알림 기록']" in PL and '공지 알림' in D414
   and len(mig) == 254 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 290), f'{len(mig)} · {VER} · 414 {bool(D414)}')


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
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    days0 = psql("SELECT value FROM site_settings WHERE key = 'privacy.notice_notified_days'")
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    acc2 = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    made, slot = [], f'test-v1290-{stamp}'
    try:
        nd = psql(f"INSERT INTO notices (gwan_code, title, body, notified_at, notified_count) VALUES ('HLT', '시험 1290 다 보냄 {stamp}', 'x', now() - interval '400 days', 2) RETURNING id").splitlines()[0]
        ns = psql(f"INSERT INTO notices (gwan_code, title, body) VALUES ('HLT', '시험 1290 보내는 중 {stamp}', 'x') RETURNING id").splitlines()[0]
        made += [nd, ns]
        psql(f"INSERT INTO notice_notified (notice_id, account_id, at) VALUES ('{nd}', '{acc}', now() - interval '400 days'), ('{nd}', '{acc2}', now() - interval '10 days'), ('{ns}', '{acc}', now() - interval '400 days')")
        psql(f"INSERT INTO notice_reads (notice_id, account_id, first_at, last_at) VALUES ('{nd}', '{acc}', now() - interval '400 days', now() - interval '400 days') ON CONFLICT DO NOTHING")
        cnt = lambda: psql(f"SELECT (SELECT count(*) FROM notice_notified WHERE notice_id = '{nd}' AND account_id = '{acc}') || '|' || "
                           f"(SELECT count(*) FROM notice_notified WHERE notice_id = '{nd}' AND account_id = '{acc2}') || '|' || "
                           f"(SELECT count(*) FROM notice_notified WHERE notice_id = '{ns}') || '|' || "
                           f"(SELECT count(*) FROM notice_reads WHERE notice_id = '{nd}')")
        before = cnt()
        f1 = psql("SELECT fn_purge_notice_notified()")
        after = cnt()
        f2 = psql("SELECT fn_purge_notice_notified()")   # 두 번째는 지울 것 없음(이 시험 기록 기준)
        ok('② DB — 다 보낸 공지의 1년 지난 기록만 지움 · 최근 기록 · 보내는 중인 공지 기록 · 펼쳐 본 기록은 남김',
           before == '1|1|1|1' and after == '0|1|1|1' and f1.isdigit() and int(f1) >= 1 and f2.isdigit(), f'{before} → {after} · 지움 {f1} · 다시 {f2}')

        psql("UPDATE site_settings SET value = '10' WHERE key = 'privacy.notice_notified_days'")
        g1 = psql("SELECT fn_purge_notice_notified()")
        mid = cnt()
        psql(f"UPDATE notice_notified SET at = now() - interval '31 days' WHERE notice_id = '{nd}' AND account_id = '{acc2}'")
        g2 = psql("SELECT fn_purge_notice_notified()")
        last = cnt()
        ok('② DB — 일수 설정 — 10 은 30일로 봄(10일 된 기록 남김) · 31일 된 기록은 지움',
           mid == '0|1|1|1' and last == '0|0|1|1' and g1.isdigit() and g2.isdigit() and int(g2) >= 1, f'{mid} → {last} · {g1} · {g2}')

        psql(f"INSERT INTO job_runs (job, slot, started_at, ended_at, ok, affected, detail) VALUES ('pii_purge', '{slot}', now(), now(), true, 7, "
             "'{\"accounts\": 0, \"ipMasked\": 0, \"leads\": 0, \"consultRequests\": 0, \"authRecords\": 0, \"taxIds\": 0, \"noticeNotified\": 7, \"overdue\": 0}')")
        pl = call('GET', '/admin/purge-log?days=7', None, TS)
        row = next((x for x in pl.get('items') or [] if (x.get('counts') or {}).get('noticeNotified') == 7), {})
        mon = next(iter((pl.get('months') or {}).values()), {})
        pb = call('GET', '/admin/purge-log', None, TB)
        ok('③ API — 위험감지 › 파기 기록에 「공지 알림 기록」 건수(날짜별 · 달별) · 회원 403',
           bool(row) and 'noticeNotified' in mon and mon.get('noticeNotified', 0) >= 7 and pb.get('_err') == 403, f"{row.get('counts')} · {mon.get('noticeNotified')} · {pb.get('_err')}")
    finally:
        psql(f"UPDATE site_settings SET value = '{days0 or '365'}' WHERE key = 'privacy.notice_notified_days'")
        for x in made:
            psql(f"DELETE FROM notice_notified WHERE notice_id = '{x}'")
            psql(f"DELETE FROM notice_reads WHERE notice_id = '{x}'")
            psql(f"DELETE FROM notices WHERE id = '{x}'")
        psql(f"DELETE FROM job_runs WHERE job = 'pii_purge' AND slot = '{slot}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
