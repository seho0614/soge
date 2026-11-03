"""v10.181 시험 — 내 정보 내려받기 · 로그인 기록 · 모든 기기 로그아웃 · 개인정보 권리 요청(D170 · docs/283)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1181.py

  ① 코드 — D170(login_history · privacy_requests 잠금 트리거 · 파기 함수 · 설정 3 · 표 지우는 문장 없음 · 208) · API · 화면 4 · 사용자 웹 화면 3 · 운영 탭 · 영어 · docs/283 · 판
  ② (API · DB) 로그인 기록 — 성공 · 비밀번호 틀림 기록(IP 앞 두 마디 · 브라우저 종류) · 모든 기기 로그아웃(틀린 비밀번호 422 · 옛 증표 무효 · 새 증표 200) · 보관 기간 파기
  ③ (API · DB) 내 정보 내려받기 — 칸 19개 · 본인 것 · 비밀값 없음 · 틀린 비밀번호 422 · 하루 한도 429 · 감사 기록은 건수만
  ④ (API · DB) 권리 요청 — 접수(기한 · 내용 암호화) · 운영 목록 · 회원 403 · 연장 한 번 · 처리 완료 · 끝난 요청 409 · DB 고치기 · 지우기 거절 · 회원 알림 · 처리 중 5건 한도
  ⑤ (API · DB) 하루 요약 — 기한 2일 안이면 PRIVACY_REQUEST_DUE(요청 · 기한마다 한 번)
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D170_member_privacy_self_service/migration.sql')
ok('① D170 — login_history(원래 IP 없음) · privacy_requests(암호화 · 잠금 트리거 · 연장 한 번) · 파기 함수 · 설정 3 · 표 지우는 문장 없음 · 208 이상',
   'CREATE TABLE IF NOT EXISTS public.login_history' in M and 'ip_masked' in M
   and 'CREATE TABLE IF NOT EXISTS public.privacy_requests' in M and 'body_enc' in M and 'trg_privacy_requests_guard' in M
   and 'PRIVACY_REQUEST_LOCKED' in M and 'PRIVACY_REQUEST_EXTENDED_ONCE' in M and 'FUNCTION public.fn_purge_auth_records()' in M
   and all(f"('{k}', '{v}', 'ADMIN'" in M for k, v in (('privacy.export_daily', '3'), ('privacy.login_history_days', '180'), ('privacy.request_due_days', '10')))
   and 'ON CONFLICT (key) DO NOTHING' in M and not re.search(r'\b(DROP TABLE|DROP VIEW|TRUNCATE)\b', M)
   and len(mig) >= 208 and 'D170_member_privacy_self_service' in mig, f'{len(mig)} · {mig[-1]}')

C = rd('src/modules/identity/privacy.controller.ts'); SV = rd('src/modules/identity/privacy.service.ts')
ok('① API — /me/data-export · /me/login-history · /me/logout-all · /me/privacy-requests · /admin/privacy-requests(ADMIN · SUPER) · 내려받기 · 로그아웃에 @Audit 없음',
   all(x in C for x in ("@Post('me/data-export')", "@Get('me/login-history')", "@Post('me/logout-all')", "@Post('me/privacy-requests')",
                        "@Get('admin/privacy-requests')", "@Post('admin/privacy-requests/:id/decide')"))
   and C.count("@Roles('ADMIN', 'SUPER')") == 2 and "@Audit('PRIVACY_REQUEST_DECIDE'" in C
   and C.split("@Post('me/data-export')")[1].split('exportData(')[0].count('@Audit') == 0
   and C.split("@Post('me/logout-all')")[1].split('logoutAll(')[0].count('@Audit') == 0
   and 'password_hash' not in SV.split('EXPORT_SECTIONS')[1].split('];')[0] and 'MY_DATA_EXPORT' in SV
   and 'PrivacyController' in rd('src/app.module.ts') and 'PRIVACY_REQUEST_DUE' in rd('src/worker/scheduler.service.ts')
   and 'recordLogin(this.db, acc.id, true)' in rd('src/modules/identity/auth.service.ts'), '')

S = json.loads(rd('spec/screens.json') or '{}')
ids = {s.get('id'): s for s in S.get('screens', [])}
want = {'SB-MYP-DAT-010': 'POST /me/data-export', 'SB-MYP-SEC-010': 'POST /me/logout-all', 'SB-MYP-PRV-010': 'POST /me/privacy-requests',
        'SB-ADM-PRQ-010': 'POST /admin/privacy-requests/{id}/decide'}
MENU = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx'); EN = rd('src/common/i18n/server-text.en.ts')
ko = json.loads(rd('site/src/i18n/messages/ko/my.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/my.json') or '{}')
ok('① 화면 — screens.json 4 · 사용자 웹 3 · 운영 탭 · 프로필 칸 · 메뉴 · 한국어 · 영어 · 영어 사전 · docs/283 · 판 v10.181 이상',
   all(k in ids and v in ids[k].get('apis', []) for k, v in want.items())
   and all(os.path.exists(os.path.join(K, f'site/src/app/my/account/{d}/page.tsx')) for d in ('data', 'security', 'privacy'))
   and "'privacy-requests'" in MENU and '<PrivacyRequests />' in APP
   and '/my/account/data' in rd('site/src/app/my/account/page.tsx') and '/my/account/security' in rd('site/src/components/my/MyShell.tsx')
   and all(k in ko and k in en and set(ko[k]) == set(en[k]) for k in ('data', 'security', 'privacy'))
   and '"처리 기한 연장은 한 번만 할 수 있습니다."' in EN and '"끝난 요청은 고칠 수 없습니다."' in EN
   and "h['User-Agent']" in rd('site/src/lib/session.ts')
   and any(f.startswith('283_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 181),
   rd('VERSION').strip())


def call(method, path, tok=None, body=None, ua=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['authorization'] = f'Bearer {tok}'
    if ua: hd['user-agent'] = ua
    r = urllib.request.Request(API + path, method=method, headers=hd, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            b = x.read(); s = x.status
    except urllib.error.HTTPError as e:
        b = e.read(); s = e.code
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip())


CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

if API and DB:
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")[0]
    psql("SELECT fn_login_clear('buyer@x.com')")
    TA = call('POST', '/auth/login', None, {'email': 'admin@x.com', 'password': PW})[1].get('accessToken')

    # ── ② 로그인 기록 · 모든 기기 로그아웃 ─────────────────────────────────
    n0 = int(psql(f"SELECT count(*) FROM login_history WHERE account_id = '{bid}'")[0] or 0)
    f1, _ = call('POST', '/auth/login', None, {'email': 'buyer@x.com', 'password': 'wrong-password-1'}, ua=CHROME)
    s1, j1 = call('POST', '/auth/login', None, {'email': 'buyer@x.com', 'password': PW}, ua=CHROME)
    call('POST', '/auth/login', None, {'email': 'nobody-v1181@x.com', 'password': 'x'})
    TB, RB = j1.get('accessToken'), j1.get('refreshToken')
    n1 = int(psql(f"SELECT count(*) FROM login_history WHERE account_id = '{bid}'")[0] or 0)
    h, jh = call('GET', '/me/login-history', TB)
    top = (jh.get('items') or [{}])[:2]
    ok('② 로그인 기록 — 틀림 1 · 성공 1 줄 · 최근 순 · IP 앞 두 마디(또는 비움) · 브라우저 「Chrome · Windows」 · 보관 180 · 지난 7일 틀림 · 없는 이메일은 안 남김',
       f1 in (401, 403) and s1 in (200, 201) and n1 - n0 == 2 and h == 200 and top and top[0].get('ok') is True and len(top) == 2 and top[1].get('ok') is False
       and all(x.get('ipMasked') is None or re.fullmatch(r'\d{1,3}\.\d{1,3}\.\*\.\*|[0-9a-f:]+:\*', x.get('ipMasked') or '') for x in top)
       and top[0].get('uaKind') == 'Chrome · Windows' and jh.get('keepDays') == 180 and jh.get('recentFails', 0) >= 1,
       f'{f1} {s1} · {n1 - n0} · {h} · {top} · {jh.get("keepDays")} {jh.get("recentFails")}')

    w, jw = call('POST', '/me/logout-all', TB, {'password': 'wrong-password-2'})
    lo, jl = call('POST', '/me/logout-all', TB, {'password': PW})
    T2 = jl.get('accessToken')
    o1, _ = call('GET', '/me/login-history', TB)
    o2, _ = call('GET', '/me/login-history', T2)
    o3, _ = call('POST', '/auth/refresh', None, {'refreshToken': RB})
    la = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'LOGOUT_ALL' AND actor_account_id = '{bid}' AND occurred_at > now() - interval '10 minutes' AND after_data::text NOT LIKE '%Token%'")[0]
    ok('② 모든 기기 로그아웃 — 틀린 비밀번호 422 · 성공 200 새 증표 · 옛 증표 거절(비로그인) · 옛 refresh 거절 · 새 증표 200 · 감사 LOGOUT_ALL(증표 없음)',
       w == 422 and jw.get('code') == 'CURRENT_PASSWORD_WRONG' and lo == 200 and T2 and jl.get('refreshToken') and o1 in (401, 403) and o2 == 200
       and o3 in (401, 403) and la not in ('', '0'), f'{w} {jw.get("code")} · {lo} · {o1} · {o2} · {o3} · {la}')
    TB = T2
    psql("SELECT fn_login_clear('buyer@x.com')")

    psql(f"INSERT INTO login_history (account_id, at, ok, ip_masked, ua_kind) VALUES ('{bid}', now() - interval '181 days', true, '10.0.*.*', 'v1181-old')")
    pg, _ = psql('SELECT fn_purge_auth_records()')
    left = psql("SELECT count(*) FROM login_history WHERE ua_kind = 'v1181-old'")[0]
    cols = psql("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'login_history'")[0]
    ok('② 보관 기간 — 181일 지난 기록은 파기 함수가 지움 · 표에 원래 IP · 브라우저 글자 칸 없음',
       pg != '' and left == '0' and cols == 'id,account_id,at,ok,ip_masked,ua_kind', f'{pg} · {left} · {cols}')

    # ── ③ 내 정보 내려받기 ─────────────────────────────────────────────────
    psql("UPDATE site_settings SET value = '20' WHERE key = 'privacy.export_daily'")
    try:
        g0, jg0 = call('GET', '/me/data-export', TB)
        x0, jx0 = call('POST', '/me/data-export', TB, {'password': 'wrong-password-3'})
        x1, jx1 = call('POST', '/me/data-export', TB, {'password': PW})
        psql("SELECT fn_login_clear('buyer@x.com')")
        data = jx1.get('data') or {}
        SECT = ['profile', 'termAgreements', 'listings', 'requests', 'referralCodes', 'successFees', 'posts', 'comments', 'pollVotes', 'favorites',
                'town', 'healthOrders', 'healthReturns', 'addresses', 'points', 'notifications', 'inquiries', 'privacyRequests', 'loginHistory']
        txt = json.dumps(jx1, ensure_ascii=False)
        missing = [k for k in SECT if k not in data]
        ok('③ 내려받기 — 오늘 횟수 · 틀린 비밀번호 422 · 200 · 칸 19개 모두 · 본인 이메일 · 파일 이름 · 비밀번호 해시 · 증표 없음 · 로그인 기록 들어감',
           g0 == 200 and jg0.get('limit') == 20 and len(jg0.get('sections') or []) == 19 and x0 == 422 and x1 == 200 and not missing
           and (data.get('profile') or {}).get('email') == 'buyer@x.com' and re.fullmatch(r'sogaebank_my_data_\d{8}\.json', jx1.get('fileName') or '')
           and 'password_hash' not in txt and 'passwordHash' not in txt and 'secret_enc' not in txt and '$2a$' not in txt and '$2b$' not in txt and 'accessToken' not in txt
           and len(data.get('loginHistory') or []) >= 2,
           f"{g0} {jg0.get('limit')} {len(jg0.get('sections') or [])} · {x0} · {x1} · 빠짐 {missing} · {jx1.get('fileName')}")

        au = psql(f"SELECT after_data::text FROM audit.audit_logs WHERE action = 'MY_DATA_EXPORT' AND actor_account_id = '{bid}' ORDER BY id DESC LIMIT 1")[0]
        used = int(psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'MY_DATA_EXPORT' AND actor_account_id = '{bid}' AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'")[0] or 0)
        psql(f"UPDATE site_settings SET value = '{max(1, min(used, 20))}' WHERE key = 'privacy.export_daily'")
        x2, jx2 = call('POST', '/me/data-export', TB, {'password': PW})
        g2 = call('GET', '/me/data-export', TB)[1]
        ok('③ 한도 · 기록 — 감사 MY_DATA_EXPORT 는 칸별 건수만(이메일 · 내용 없음) · 한도에 닿으면 429 EXPORT_DAILY_LIMIT · 남은 0',
           au.startswith('{"counts"') and 'buyer@x.com' not in au and x2 == 429 and jx2.get('code') == 'EXPORT_DAILY_LIMIT' and g2.get('left') == 0,
           f'{au[:80]} · {used} · {x2} {jx2.get("code")} · {g2.get("left")}')
    finally:
        psql("UPDATE site_settings SET value = '3' WHERE key = 'privacy.export_daily'")
        psql("SELECT fn_login_clear('buyer@x.com')")

    # ── ④ 권리 요청 ───────────────────────────────────────────────────────
    BODY = '시험 v1181 — 소개광장 글의 휴대폰 번호를 지워 주십시오 010-0000-0000'
    c1, jc1 = call('POST', '/me/privacy-requests', TB, {'kind': 'DELETE', 'body': BODY})
    rid = jc1.get('id', '')
    due = psql(f"SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 10, 'YYYY-MM-DD')")[0]
    raw = psql(f"SELECT position('010-0000' in encode(body_enc, 'escape')) FROM privacy_requests WHERE id = '{rid}'")[0]
    m1, jm1 = call('GET', '/me/privacy-requests', TB)
    mine = next((x for x in jm1.get('items', []) if x.get('id') == rid), {})
    a1, ja1 = call('GET', '/admin/privacy-requests', TA)
    row = next((x for x in ja1.get('items', []) if x.get('id') == rid), {})
    b1, _ = call('GET', '/admin/privacy-requests', TB)
    k1, jk1 = call('POST', '/me/privacy-requests', TB, {'kind': 'SELL', 'body': '없는 종류 시험'})
    ok('④ 접수 — 201 · 기한 +10일 · DB 내용 암호화 · 내 목록에 내용 · 운영 목록(남은 10일 · 회원 이메일) · 회원은 운영 목록 403 · 없는 종류 400',
       c1 in (200, 201) and jc1.get('dueOn') == due and raw == '0' and mine.get('body') == BODY and mine.get('status') == 'OPEN'
       and a1 == 200 and row.get('daysLeft') == 10 and row.get('accountEmail') == 'buyer@x.com' and b1 == 403 and k1 == 400,
       f'{c1} {jc1.get("dueOn")}/{due} · {raw} · {mine.get("status")} · {a1} {row.get("daysLeft")} · {b1} · {k1}')

    e1, je1 = call('POST', f'/admin/privacy-requests/{rid}/decide', TA, {'action': 'EXTEND', 'note': '자료 확인에 시간이 더 필요합니다'})
    due2 = psql(f"SELECT to_char(due_on, 'YYYY-MM-DD') || '|' || status FROM privacy_requests WHERE id = '{rid}'")[0]
    e2, je2 = call('POST', f'/admin/privacy-requests/{rid}/decide', TA, {'action': 'EXTEND', 'note': '두 번째 연장 시도입니다'})
    _, edb = psql(f"UPDATE privacy_requests SET due_on = due_on + 5 WHERE id = '{rid}'")
    d1, jd1 = call('POST', f'/admin/privacy-requests/{rid}/decide', TA, {'action': 'DONE', 'note': '요청하신 글 1건의 휴대폰 번호를 지웠습니다'})
    d2, jd2 = call('POST', f'/admin/privacy-requests/{rid}/decide', TA, {'action': 'REJECT', 'note': '끝난 뒤 거절 시도입니다'})
    _, u1 = psql(f"UPDATE privacy_requests SET result_note = '고침 시도입니다' WHERE id = '{rid}'")
    _, u2 = psql(f"DELETE FROM privacy_requests WHERE id = '{rid}'")
    nt = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{bid}' AND event_code = 'PRIVACY_REQUEST_RESULT' AND created_at > now() - interval '10 minutes'")[0]
    dm, _ = call('POST', f'/admin/privacy-requests/{rid}/decide', TB, {'action': 'DONE', 'note': '회원이 처리 시도합니다'})
    ok('④ 처리 — 연장 200(+10일 · EXTENDED) · 두 번째 연장 409 · DB 기한 다시 늘리기 거절 · 처리 완료 200 · 끝난 뒤 409 · DB 고치기 · 지우기 거절 · 회원 알림 2 · 회원 403',
       e1 == 200 and due2.startswith(psql(f"SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 20, 'YYYY-MM-DD')")[0]) and due2.endswith('|EXTENDED')
       and e2 == 409 and je2.get('code') == 'PRIVACY_REQUEST_EXTENDED_ONCE' and 'PRIVACY_REQUEST_EXTENDED_ONCE' in edb
       and d1 == 200 and d2 == 409 and jd2.get('code') == 'PRIVACY_REQUEST_CLOSED' and 'PRIVACY_REQUEST_LOCKED' in u1 and 'PRIVACY_REQUEST_LOCKED' in u2
       and int(nt or 0) >= 2 and dm == 403,
       f'{e1} {due2} · {e2} · {edb[:40]} · {d1} · {d2} · {u1[:30]} · {u2[:30]} · {nt} · {dm}')

    # 처리 중 5건 한도 — 이번에 만든 것은 끝에 모두 처리해 둠(지울 수 없음)
    made = []
    open_n = int(psql(f"SELECT count(*) FROM privacy_requests WHERE account_id = '{bid}' AND status IN ('OPEN','EXTENDED')")[0] or 0)
    for i in range(max(0, 5 - open_n)):
        s, j = call('POST', '/me/privacy-requests', TB, {'kind': 'ACCESS', 'body': f'시험 v1181 한도 {i + 1}번째 요청'})
        if j.get('id'): made.append(j['id'])
    l6, jl6 = call('POST', '/me/privacy-requests', TB, {'kind': 'ACCESS', 'body': '시험 v1181 여섯 번째 요청'})
    ok('④ 한도 — 처리 중 5건이면 409 PRIVACY_OPEN_LIMIT', l6 == 409 and jl6.get('code') == 'PRIVACY_OPEN_LIMIT', f'{open_n} · {len(made)} · {l6}')

    # ── ⑤ 하루 요약 PRIVACY_REQUEST_DUE ───────────────────────────────────
    tid = made[0] if made else ''
    psql(f"UPDATE privacy_requests SET due_on = (now() AT TIME ZONE 'Asia/Seoul')::date + 1 WHERE id = '{tid}'")
    key = psql(f"SELECT id::text || ':' || to_char(due_on, 'YYYY-MM-DD') FROM privacy_requests WHERE id = '{tid}'")[0]
    r1 = call('POST', '/admin/jobs', TA, {'job': 'launch_digest'})[1].get('detail') or {}
    r2 = call('POST', '/admin/jobs', TA, {'job': 'launch_digest'})[1].get('detail') or {}
    na = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'PRIVACY_REQUEST_DUE' AND detail->'keys' @> to_jsonb('{key}'::text)")[0]
    ok('⑤ 하루 요약 — 기한 2일 안이면 PRIVACY_REQUEST_DUE · 같은 요청 · 기한은 한 번(두 번째 요약에 다시 없음)',
       bool(tid) and (r1.get('privacyDue') or 0) >= 1 and na == '1' and r2.get('privacyDue', -1) == 0,
       f"{r1.get('privacyDue')} → {r2.get('privacyDue')} · {na}")

    for x in made + [i for i in psql(f"SELECT string_agg(id::text, ' ') FROM privacy_requests WHERE account_id = '{bid}' AND status IN ('OPEN','EXTENDED')")[0].split() if i not in made]:
        call('POST', f'/admin/privacy-requests/{x}/decide', TA, {'action': 'DONE', 'note': '시험 v1181 — 정리용 처리 완료'})
    psql("DELETE FROM ops_alerts WHERE alert_code = 'PRIVACY_REQUEST_DUE' AND raised_at > now() - interval '10 minutes'")
else:
    print('  (API · DB 없음 — ②③④⑤ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
