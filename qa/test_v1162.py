"""v10.162 시험 — 약관 변경 회원 알림(D152 · 시행 예정 게시 → 회원마다 「약관 변경 안내」) · 불리한 변경 30일 · 오픈 준비 점검 약관 줄(docs/248)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1162.py

  ① 코드 — D152(칸 2 · 알림 종류 · 설정 on · 준비 점검 11줄 · 지우는 문장 없음 · 190) · 서버(알림 · 취소 안내 · 불리한 변경 · 전체 회원 대상만) · DTO · 운영 화면 · 영어 · docs/248 · 판
  ② (API · DB) 불리한 + 30일 안 → 422 TERM_ADVERSE_30D · 시행 예정 게시 → 알림 수 = ACTIVE 회원 수(글 · 링크 · 종류 · 게시한 때) · 예정 취소 → 취소 안내 같은 수 ·
     스위치 off(ADMIN 403) → 0 · 불리한 + 31일 뒤 → 통과 · 준비 점검 11줄(약관 두 줄 권장 · 고칠 곳 terms) · 고지 기간 부족이면 TERMS_NOTICE 안 됨 · 되돌림
  ③ (화면) 운영 화면 관 관리 › 약관 — 「회원에게 불리한 변경」 고르기 · 회원 알림 스위치
"""
import datetime, json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
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
M = rd('prisma/migrations/D152_terms_notice/migration.sql')
ok('① D152 — published_at · is_adverse · 알림 종류 TERM_CHANGE_NOTICE(수신 거부 불가) · 설정 terms.notify_members on · 준비 점검 TERMS_EFFECTIVE · TERMS_NOTICE(권장 · terms) · 지우는 문장 없음 · 190',
   all(x in M for x in ('ADD COLUMN IF NOT EXISTS published_at', 'ADD COLUMN IF NOT EXISTS is_adverse', "('TERM_CHANGE_NOTICE', '약관 변경 안내', false,",
                        "('terms.notify_members', 'on',", "('TERMS_EFFECTIVE', '약관 시행일', false,", "('TERMS_NOTICE', '약관 변경 고지 기간', false,", "'terms', 110)",
                        'CREATE OR REPLACE VIEW public.v_open_readiness'))
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and (len(mig), mig[-1]) in ((190, 'D152_terms_notice'), (191, 'D153_role_change_reason')), f'{len(mig)} · {mig[-1]}')
TS = rd('src/modules/catalog/terms.service.ts'); DTO = rd('src/modules/catalog/terms.dto.ts'); TC = rd('src/modules/catalog/terms.controller.ts')
ok('① 서버 — 시행 예정이면 회원 알림(전체 회원 대상 · ACTIVE · 탈퇴 아님 · 설정) · 취소 안내(그 링크로 받은 회원만 · template_code 안 씀) · 불리한 변경 30일(앞 판 있을 때) · 게시한 때 · 응답 notified',
   "throw new PolicyViolation('TERM_ADVERSE_30D'" in TS and 'dto.adverse && now_ &&' in TS and 'published_at = now(), is_adverse = $5' in TS
   and "t.audience !== 'ALL'" in TS and "WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL" in TS and "n.link_url = $1::text || '#upcoming-terms'" in TS and "'TERM_CHANGE_NOTICE', NULL," in TS and 'template_code = ' not in TS.split('private async notifyMembers(')[-1][:3000]
   and "'TERM_CHANGE_NOTICE'" in TS and "published_at = NULL, is_adverse = false" in TS and 'notified, remainingBlockers' in TS
   and '@StrictBoolean() adverse?: boolean' in DTO and 'notified?: number' in DTO and 'TERM_ADVERSE_30D' in TC, '')
PN = rd('web/src/app/admin/TermsPanel.tsx'); EN = rd('src/common/i18n/server-text.en.ts')
ok('① 운영 화면 — 불리한 변경 고르기 · 게시에 adverse · 확인 창 알림 안내 · 결과 알림 수 · 회원 알림 스위치(terms.notify_members) · 영어 문구 · docs/248 · 판 v10.162 이상',
   'data-terms-adverse' in PN and 'effectiveFrom: day, adverse' in PN and "data-terms-notify={notifyOn ? 'on' : 'off'}" in PN and 'data-terms-notify-flip' in PN
   and "key: 'terms.notify_members'" in PN and '회원 알림 ${r.notified ?? 0}건' in PN
   and '"회원에게 불리한 변경은 시행일을 오늘부터 30일 뒤 이후로 정하십시오(이용약관 제14조).":' in EN
   and any(f.startswith('248_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 162), rd('VERSION').strip())


# ── ①' docs/249(운영 적용 절차서 · 킷에 있을 때만) · docs/136 체크리스트 ──────────
F249 = next((f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('249_')), '')
D249 = rd('docs/' + F249) if F249 else ''
ok("①' docs/249 — 운영 적용 v10.158 → v10.162 · D151 · D152 · 188 → 190 · 스냅샷 v10-162 · 킷 ~/kits/release · sha256 · 준비 점검 11줄 · 하지 말 것",
   not F249 or ('v10.162' in F249 and '`적용됨 188 · 새 킷의 파일 190 · 올릴 것 2 · 바뀐 파일 0`' in D249 and '`적용 2 · 기존 188 · 변경감지 0`' in D249
   and '190 / 190' in D249 and 'sgb-before-v10-162' in D249 and '~/kits/release/' in D249 and 'a7c97c482586b4e95b00af5f1540ae7aadde937e857647adadd37b6cc064882a' in D249
   and 'D152_terms_notice' in D249 and '오픈 준비 점검 11줄 · 꼭 4' in D249 and '하지 말 것' in D249), F249 or '(킷에 아직 없음)')
D136 = rd('docs/136_오픈직전정리_open-prep_v10.82_20261023.md')
ok("①' docs/136 오픈 직전 체크리스트 2번 — 운영 화면 게시 · 시행일 = 오픈일 · 7일 · 30일 · 준비 점검 약관 두 줄",
   not F249 or all(x in D136 for x in ('운영 화면 › 관 관리 › 약관', '**시행일 = 오픈일**', '「약관 시행일」 · 「약관 변경 고지 기간」', 'docs/248')), '')

# ── ② API ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


CODE = 'MARKETING'; NV = '9.5'; SELLER = 'seller@x.com'; LINK = f'/terms?notice={CODE}@{NV}'
NOTE = '시험 — 제3조 수신 시간을 고침(T1162)'
nt = lambda link: psql(f"SELECT count(*) FROM notifications WHERE event_code = 'TERM_CHANGE_NOTICE' AND link_url = '{link}'")
NOTICE = LINK + '#upcoming-terms'; CANCEL = LINK + '&cancel=1'
ready = lambda T: {x['code']: x for x in (call('GET', '/admin/open-readiness', t=T) or []) if isinstance(x, dict)}
if API and DB:
    t0 = psql(f"SELECT version || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    v0, e0 = (t0.split('|') + [''])[:2]
    sw0 = psql("SELECT value FROM site_settings WHERE key = 'terms.notify_members'")
    print(f'  점검판 마케팅 약관: {t0 or "(게시 판 없음)"} · 회원 알림 {sw0}')
    if not v0:
        print('  (점검판에 마케팅 게시 판 없음 — ② 건너뜀)')
    else:
        T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
        TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW}).get('accessToken')
        base = max(datetime.date.fromisoformat(e0[:10]), datetime.date.today())
        day = (base + datetime.timedelta(days=10)).isoformat()
        day31 = (max(base, datetime.date.today() + datetime.timedelta(days=31)) + datetime.timedelta(days=1)).isoformat()
        try:
            n_act = psql("SELECT count(*) FROM accounts WHERE status = 'ACTIVE' AND withdrawn_at IS NULL")
            title = psql(f"SELECT title FROM terms WHERE code = '{CODE}' AND version = '{v0}'")
            body = re.sub(r'〔(?!시행일)[^〕]*〕', '', psql(f"SELECT body FROM terms WHERE code = '{CODE}' AND version = '{v0}'")) + '\n\n부칙 이 판(시험 T1162)은 〔시행일〕부터 시행합니다.'
            call('PUT', f'/admin/terms/{CODE}', {'version': NV, 'title': title, 'body': body, 'changeNote': NOTE}, T_)
            psql("UPDATE site_settings SET value = 'on' WHERE key = 'terms.notify_members'")
            ra = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV, 'effectiveFrom': day, 'adverse': True}, T_)
            ok('② 불리한 변경 + 시행 30일 안 → 422 TERM_ADVERSE_30D(게시 안 됨 · 알림 없음)', ra.get('code') == 'TERM_ADVERSE_30D' and nt(NOTICE) == '0'
               and psql(f"SELECT status FROM terms WHERE code = '{CODE}' AND version = '{NV}'") == 'LEGAL_REVIEW', str(ra)[:100])

            r1 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV, 'effectiveFrom': day}, T_)
            one = psql(f"SELECT event_code || '|' || title || '|' || link_url || '|' || (body LIKE '%{day}부터 바뀝니다(지금 판 {v0} → {NV})%')::text || '|' || (body LIKE '%{NOTE}%')::text "
                       f"FROM notifications WHERE event_code = 'TERM_CHANGE_NOTICE' AND link_url = '{NOTICE}' LIMIT 1")
            pub = psql(f"SELECT (published_at > now() - interval '5 minutes')::text || '|' || is_adverse::text FROM terms WHERE code = '{CODE}' AND version = '{NV}'")
            ok('② 시행 예정 게시 → 알림 수 = ACTIVE 회원 수(종류 · 제목 · 링크 · 시행일 · 지금 판 → 새 판 · 바뀐 점) · 게시한 때 · 불리한 아님',
               r1.get('scheduled') is True and str(r1.get('notified')) == n_act == nt(NOTICE) and n_act not in ('', '0')
               and one == f'TERM_CHANGE_NOTICE|[약관 변경 안내] {title} {NV}|{NOTICE}|true|true' and pub == 'true|false',
               f"{r1.get('notified')} / {n_act} · {one[:80]} · {pub}")
            R = ready(T_)
            ok('② 준비 점검 11줄 · TERMS_EFFECTIVE · TERMS_NOTICE 권장 · 고칠 곳 terms · 고지 기간 10일 → 부족 0',
               len(R) == 11 and R.get('TERMS_EFFECTIVE', {}).get('required') is False and R.get('TERMS_NOTICE', {}).get('required') is False
               and R['TERMS_EFFECTIVE'].get('go') == 'terms' and R['TERMS_NOTICE'].get('ok') is True and '고지 기간 부족 0건' in R['TERMS_NOTICE'].get('nowValue', '')
               and '필수 약관' in R['TERMS_EFFECTIVE'].get('nowValue', ''), f"{len(R)} · {R.get('TERMS_NOTICE', {}).get('nowValue')} · {R.get('TERMS_EFFECTIVE', {}).get('nowValue')}")
            psql(f"UPDATE terms SET published_at = effective_from - interval '5 days' WHERE code = '{CODE}' AND version = '{NV}'")
            R2 = ready(T_)
            blk = psql("SELECT count(*) FROM v_open_blockers WHERE kind = 'READY' AND item = '약관 변경 고지 기간'")
            ok('② 게시 뒤 5일 만에 시행(고지 기간 부족) → TERMS_NOTICE 안 됨 · 권장이라 오픈 차단에는 안 올라감', R2.get('TERMS_NOTICE', {}).get('ok') is False and blk == '0',
               f"{R2.get('TERMS_NOTICE', {}).get('nowValue')} · 차단 {blk}")

            r2 = call('PATCH', f'/admin/terms/{CODE}/unschedule', {'version': NV}, T_)
            cl = psql(f"SELECT (published_at IS NULL)::text || '|' || is_adverse::text FROM terms WHERE code = '{CODE}' AND version = '{NV}'")
            ok('② 예정 취소 → 받은 회원에게 「[약관 변경 취소]」 같은 수 · 게시한 때 비움',
               r2.get('status') == 'LEGAL_REVIEW' and str(r2.get('notified')) == nt(CANCEL) == n_act and cl == 'true|false'
               and psql(f"SELECT count(*) FROM notifications WHERE link_url = '{CANCEL}' AND title LIKE '[약관 변경 취소]%' AND template_code IS NULL") == n_act,
               f"{r2.get('notified')} · {cl}")

            rs = call('PATCH', '/admin/site-settings', {'key': 'terms.notify_members', 'value': 'off'}, TA)
            call('PATCH', '/admin/site-settings', {'key': 'terms.notify_members', 'value': 'off'}, T_)
            r3 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV, 'effectiveFrom': day}, T_)
            r4 = call('PATCH', f'/admin/terms/{CODE}/unschedule', {'version': NV}, T_)
            ok('② 회원 알림 off(ADMIN 은 403 TERMS_SETTING_SUPER) → 게시 · 취소 알림 0(그 사이 알림 수 그대로)',
               rs.get('code') == 'TERMS_SETTING_SUPER' and r3.get('scheduled') is True and r3.get('notified') == 0 and r4.get('notified') == 0 and nt(NOTICE) == n_act,
               f"{rs.get('code')} · {r3.get('notified')} · {r4.get('notified')}")
            call('PATCH', '/admin/site-settings', {'key': 'terms.notify_members', 'value': 'on'}, T_)

            r5 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': NV, 'effectiveFrom': day31, 'adverse': True}, T_)
            ok('② 불리한 변경 + 시행 31일 뒤 → 게시(시행 예정 · is_adverse · 알림)', r5.get('scheduled') is True and str(r5.get('notified')) == n_act
               and psql(f"SELECT is_adverse::text FROM terms WHERE code = '{CODE}' AND version = '{NV}'") == 'true', f"{str(r5)[:100]}")

            if ADMIN_WEB:
                try:
                    from playwright.sync_api import sync_playwright
                except Exception:
                    sync_playwright = None
                if sync_playwright:
                    with sync_playwright() as p:
                        b_ = p.chromium.launch(); pg = b_.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                        pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        box = pg.locator('[data-terms-panel]')
                        ok('③ 운영 화면 관 관리 › 약관 — 「회원에게 불리한 변경」 고르기 · 회원 알림 「보냄」 · 스위치 단추 · 9.5 시행 예정 · 오류 없음',
                           box.count() == 1 and box.locator('[data-terms-adverse]').count() == 1 and box.locator('[data-terms-notify="on"]').count() == 1
                           and box.locator('[data-terms-notify-flip]').count() == 1 and box.locator(f'[data-term-row="{CODE}:{NV}"][data-scheduled="y"]').count() == 1 and not errs,
                           f'{box.count()} · {errs[:2]}')
                        box.scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(HERE, 'v1162_admin_terms.png'), full_page=False)
                        b_.close()
        finally:
            psql(f"SET session_replication_role = replica; DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE link_url LIKE '{LINK}%'); "
                 f"DELETE FROM notifications WHERE link_url LIKE '{LINK}%'; "
                 f"DELETE FROM term_agreements WHERE term_code = '{CODE}' AND term_version = '{NV}'; DELETE FROM terms WHERE code = '{CODE}' AND version = '{NV}'; "
                 f"UPDATE terms SET status = 'PUBLISHED', effective_from = '{e0}' WHERE code = '{CODE}' AND version = '{v0}'; "
                 f"UPDATE site_settings SET value = '{sw0 or 'on'}' WHERE key = 'terms.notify_members';")
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
        t1 = psql(f"SELECT version || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
        ok('끝 — 되돌림(9.5 · 그 알림 없음 · 앞 판 · 시행일 · 스위치 그대로)', t1 == t0 and nt(NOTICE) == '0' and nt(CANCEL) == '0'
           and psql(f"SELECT count(*) FROM terms WHERE code = '{CODE}' AND version = '{NV}'") == '0', f'{t0} → {t1}')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
