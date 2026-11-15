"""v10.305 (docs/427) — 요율 시행 결과 운영 알림 RATE_FROZEN · 「대표 할 일」 rate-frozen 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1305.py

  ① (코드) 정기 작업 hlt_rate_schedule — 굳힌 예약(30일 · RATE_FROZEN items 에 없는 것)을 한 줄로 · 안 읽은 대상 있으면 WARN · items(id · 대상 · 시행 전 읽음) ·
     대표 할 일 rate-frozen(최근 30일 · 시행 전 안 읽은 대상 0곳) · 문서 427 · 판 v10.305
  ② (작업) 시행 20초 전 예약 두 건 — S1 판매자 A(시행 전에 펼침) · S2 판매자 B(안 펼침) → 정기 작업 → RATE_FROZEN WARN 한 줄에 둘 다 ·
     S1 1/1 · S2 0/1 · 제목 「시행 전 공지 읽음」 · 한 번 더 돌려도 같은 예약은 다시 안 실림
  ③ (대표 할 일) rate-frozen 줄 — 안 읽은 곳이 있어 「아직」 · 「시행 전 읽음 … / 대상 …」 · 소개몰 정산으로 감 · 전체 20줄
  판매자는 고정 기록이 가리켜 지울 수 없어 폐점(CLOSED · 사유)으로 둠 — 두 번 돌아도 통과.
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

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
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D427 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('427_')), '')
SC, OT = rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/owner-todo.service.ts')
ok('① 정기 작업 — 굳힌 예약(30일) 중 RATE_FROZEN items 에 없는 것만 · 안 읽은 대상 있으면 WARN · items · 한 줄로 묶음',
   "await this.alert('RATE_FROZEN', tgt - rb > 0 ? 'WARN' : 'INFO'," in SC and "r.reads_frozen_at > now() - interval '30 days'" in SC
   and "o.alert_code = 'RATE_FROZEN' AND o.detail -> 'items' @> jsonb_build_array(jsonb_build_object('id', r.id::text))" in SC
   and 'count(p.seller_id) FILTER (WHERE p.target AND p.read_before)::int AS "readBefore"' in SC and 'frozen: fz.length' in SC, '')
ok('① 대표 할 일 rate-frozen · 문서 427 · 판 v10.305',
   "key: 'rate-frozen', label: '최근 30일 요율 시행 — 시행 전 안 읽은 대상 0곳', go: 'hlt-settle', done: s.rateFrozenUnread === 0" in OT
   and 'AS "rateFrozenUnread"' in OT and 'RATE_FROZEN' in D427 and '대표 할 일' in D427 and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 305), VER)


def call(m_, p, b=None, t=None):
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
TAG = f'시험 1305 {stamp}'
EM = {k: f't1305{k.lower()}{stamp}@x.com' for k in ('A', 'B')}
CODE = {k: f'TN-G{k}{stamp}' for k in ('A', 'B')}
if API and DB:
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    acc = {}
    for k, e_ in EM.items():
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e_}', '시험1305{k}', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e_, PW)
        acc[k] = psql(f"SELECT id FROM accounts WHERE email = '{e_}'")
    consent_ok.agree('admin@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS = login('admin@x.com')
    TK = {k: login(e_) for k, e_ in EM.items()}
    sid, sch, nts = {}, {}, []
    try:
        for k in ('A', 'B'):
            sid[k] = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                          f"VALUES ('{CODE[k]}', '{acc[k]}', 'TENANT', '시험 가게 1305{k}', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-{CODE[k]}') RETURNING id").splitlines()[0]
        for k, tgt in (('S1', 'A'), ('S2', 'B')):
            n_ = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '{TAG} {k} 공지', '요율 본문', ARRAY['SELLER'], now() - interval '1 minute') RETURNING id").splitlines()[0]
            nts.append(n_)
            sch[k] = psql(f"INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason, created_at, notice_id) "
                          f"VALUES ('SELLER', '{sid[tgt]}', 10, 20, now() + interval '20 seconds', '{TAG} {k}', now() - interval '40 days', '{n_}') RETURNING id").splitlines()[0]
        ra = call('POST', f'/me/health/seller/notices/{nts[0]}/read', None, TK['A'])
        wait = float(psql(f"SELECT greatest(0, extract(epoch FROM effective_at - now())) FROM hlt_rate_schedules WHERE id = '{sch['S1']}'") or 20)
        time.sleep(wait + 3)
        j1 = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        has = lambda s_: psql(f"""SELECT count(*) FROM ops_alerts WHERE alert_code = 'RATE_FROZEN' AND detail -> 'items' @> '[{{"id": "{s_}"}}]'::jsonb""")
        row = psql(f"""SELECT severity || '|' || title || '|' || detail::text FROM ops_alerts WHERE alert_code = 'RATE_FROZEN' AND detail -> 'items' @> '[{{"id": "{sch['S1']}"}}]'::jsonb ORDER BY id DESC LIMIT 1""")
        sev, title, det = (row.split('|', 2) + ['', '', ''])[:3]
        try:
            items = {x['id']: x for x in json.loads(det).get('items', [])}
        except Exception:
            items = {}
        st = psql(f"SELECT string_agg(status || ':' || (reads_frozen_at IS NOT NULL)::text, ',' ORDER BY reason) FROM hlt_rate_schedules WHERE id IN ('{sch['S1']}', '{sch['S2']}')")
        i1, i2 = items.get(sch['S1'], {}), items.get(sch['S2'], {})
        ok('② 정기 작업 → 두 예약 APPLIED · 굳힘 → RATE_FROZEN WARN 한 줄에 둘 다 · S1 1/1 · S2 0/1 · 제목 「시행 전 공지 읽음」 · 판매자 이름',
           ra.get('ok') and '_err' not in j1 and st == 'APPLIED:true,APPLIED:true' and sev == 'WARN' and '시행 전 공지 읽음' in title and '「요율 변경 예정」' in title
           and i1.get('target') == 1 and i1.get('readBefore') == 1 and i2.get('target') == 1 and i2.get('readBefore') == 0
           and '시험 가게 1305A' in (i1.get('label') or '') and bool(i1.get('effective')) and has(sch['S1']) == '1' and has(sch['S2']) == '1',
           f"{st} · {sev} · {title[:90]} · {i1} · {i2}")
        j2 = call('POST', '/admin/jobs', {'job': 'hlt_rate_schedule'}, TS)
        ok('② 한 번 더 돌려도 같은 예약은 RATE_FROZEN 에 다시 안 실림(예약마다 한 번)',
           '_err' not in j2 and has(sch['S1']) == '1' and has(sch['S2']) == '1', f"{has(sch['S1'])} · {has(sch['S2'])} · {str(j2)[:80]}")

        td = call('GET', '/admin/launch-watch/owner-todo', None, TS)
        rows = {r.get('key'): r for r in td.get('rows') or []}
        rf = rows.get('rate-frozen', {})
        ok('③ 대표 할 일 rate-frozen — 안 읽은 곳이 있어 「아직」 · 「시행 … · 시행 전 읽음 … / 대상 … — 안 읽은 …곳」 · hlt-settle · 전체 20줄',
           rf.get('done') is False and '시행 전 읽음' in (rf.get('now') or '') and '안 읽은' in (rf.get('now') or '') and rf.get('go') == 'hlt-settle'
           and td.get('total') == 20 and list(rows).index('rate-frozen') == list(rows).index('rate-notice') + 1, f"{rf} · {td.get('total')}")
    finally:
        for k in ('S1', 'S2'):
            if sch.get(k):
                psql(f"UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_at = now(), cancel_reason = '시험 1305 정리' WHERE id = '{sch[k]}' AND status = 'SCHEDULED' AND effective_at > now()")
        for n_ in nts:
            psql(f"UPDATE notices SET is_pinned = false WHERE id = '{n_}'")
        psql(f"DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email IN ({', '.join(repr(e_) for e_ in EM.values())}))")
        for k, s_ in sid.items():
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{s_}'")
            if psql(f"DELETE FROM hlt_sellers WHERE id = '{s_}'").find('!') != -1:
                psql(f"UPDATE hlt_sellers SET status = 'CLOSED', status_reason = '시험 1305 정리' WHERE id = '{s_}' AND status <> 'CLOSED'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
