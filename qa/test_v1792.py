"""v10.792 (docs/907 · D331) 간주 끈 뒤 처리 도구 — 오픈 체크리스트 › 「간주 끈 뒤 처리」
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1792.py
  ① (코드) D331 재대조 기록 · 쌓기만 · 남은 대상 보기 · 승인 상태 안 고침 · 다름 · 없음 알림만 · SUPER · 주소 표 · 명세 · 문서 907
  ② (API) 개요 모양(재대조 · 시험 기록 4 · 판매자) · 조회 연동 없음 422 · 없는 기록 확인 404 · 짧은 사유 · 51건 400
  ③ (화면) 오픈 체크리스트 「간주 끈 뒤 처리」 탭 3 · 시험 기록 펼침 · 재대조 단추는 연동 없으면 꺼짐
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


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




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


MIG = rd('prisma/migrations/D331_assume_after_tools/migration.sql')
AA, AC, UI, OC = rd('src/modules/admin/assume-after.ts'), rd('src/modules/admin/assume-after.controller.ts'), rd('web/src/app/admin/AssumeAfter.tsx'), rd('web/src/app/admin/OpenChecklist.tsx')
SC, AM, VA = rd('spec/screens.json'), rd('src/app.module.ts'), rd('scripts/verify-all.sh')
ok('① D331 — broker_rechecks(쌓기만 · 확인 칸 한 번) · v_broker_recheck_pending(MATCH 빠짐) · 주소 표 3 · broker_verifications 안 고침',
   'CREATE TABLE IF NOT EXISTS public.broker_rechecks' in MIG and 'BROKER_RECHECK_APPEND_ONLY' in MIG and 'CREATE OR REPLACE VIEW public.v_broker_recheck_pending' in MIG
   and "m.result = 'MATCH'" in MIG and MIG.count("'checklist'") == 3 and 'UPDATE public.broker_verifications' not in MIG and 'UPDATE broker_verifications' not in AA, '')
ok('① 서버 — 50건 · 조회 연동 없음 422 · 다름 · 없음 알림 WARN(clock_timestamp · ON CONFLICT) · 재대조 · 확인 SUPER · 등록 · verify-all',
   'RECHECK_MAX = 50' in AA and "'LOOKUP_NOT_CONFIGURED'" in AA and "'BROKER_RECHECK_MISMATCH', 'WARN'" in AA and 'clock_timestamp()) ON CONFLICT DO NOTHING' in AA
   and AC.count("@Roles('SUPER')") == 2 and 'AssumeAfterController' in AM and 'AssumeAfterService' in AM and 'scripts/test-assume-after.ts' in VA, '')
ok('① 화면 · 명세 · 문서 — 「간주 모드 끄는 순서」 아래 · 탭 3 · 「시험」 표시 · STUB- 번호 막음 · SB-ADM-SIT-040 API 3 · 문서 907 · 판',
   '<AssumeAfter />' in OC and OC.index('<AssumeReadiness />') < OC.index('<AssumeAfter />') and UI.count('data-aa-tab=') == 3 and 'data-aa-stub-badge>시험<' in UI
   and "startsWith('STUB-')" in UI and all(f'"{x}"' in SC for x in ('GET /admin/assume-after', 'POST /admin/assume-after/broker-recheck', 'POST /admin/assume-after/broker-recheck/{id}/ack'))
   and '알림만' in doc('907_') and VT >= (10, 792), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    T = login('admin@x.com')
    ov = call('GET', '/admin/assume-after', t=T)
    kinds = [k.get('key') for k in ov.get('stubs', [])] if isinstance(ov, dict) else []
    ok('② 개요 — 재대조(configured · pending · max 50 · items) · 시험 기록 4종 · 판매자 목록',
       isinstance(ov.get('broker'), dict) and ov['broker'].get('max') == 50 and isinstance(ov['broker'].get('items'), list)
       and kinds == ['subscription', 'mallPayment', 'leadCash', 'payout'] and isinstance(ov.get('sellers'), list), f"{ov.get('broker', {}).get('configured')} · {kinds} · {ov.get('_err')}")
    r1 = call('POST', '/admin/assume-after/broker-recheck', {}, t=T)
    r2 = call('POST', '/admin/assume-after/broker-recheck/999999999999/ack', {'note': '확인 시험'}, t=T)
    r3 = call('POST', '/admin/assume-after/broker-recheck/1/ack', {'note': 'x'}, t=T)
    r4 = call('POST', '/admin/assume-after/broker-recheck', {'limit': 51}, t=T)
    cfg = bool(ov.get('broker', {}).get('configured'))
    ok('② 조회 연동 없음 422 LOOKUP_NOT_CONFIGURED · 없는 기록 404 · 짧은 사유 400 · 51건 400',
       (cfg or (r1.get('_err') == 422 and r1.get('code') == 'LOOKUP_NOT_CONFIGURED')) and r2.get('_err') == 404 and r3.get('_err') == 400 and r4.get('_err') == 400,
       f"{r1.get('_err')}/{r1.get('code')} · {r2.get('_err')} · {r3.get('_err')} · {r4.get('_err')}")
    if ADMIN_WEB:
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        seen = {}
        if sync_playwright:
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    errs = []
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/checklist', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    box = pg.locator('[data-assume-after]')
                    seen['box'] = box.count()
                    seen['tabs'] = pg.locator('[data-aa-tab]').count()
                    btn = pg.locator('[data-aa-recheck]')
                    seen['recheckDisabled'] = btn.is_disabled() if btn.count() else None
                    pg.locator('[data-aa-tab="stubs"]').click(); pg.wait_for_timeout(500)
                    seen['kinds'] = pg.locator('[data-aa-stub-kind]').count()
                    pg.locator('[data-aa-tab="sellers"]').click(); pg.wait_for_timeout(500)
                    seen['sellers'] = pg.locator('[data-aa-sellers]').count()
                    seen['errs'] = errs
                    b.close()
            except Exception as e:
                seen['err'] = str(e)[:200]
            ok('③ 화면 — 상자 1 · 탭 3 · 재대조 단추(연동 없으면 꺼짐) · 시험 기록 4종 펼침 · 판매자 탭 · 화면 오류 없음',
               seen.get('box') == 1 and seen.get('tabs') == 3 and (cfg or seen.get('recheckDisabled') in (True, None)) and seen.get('kinds') == 4
               and seen.get('sellers') == 1 and not seen.get('errs'), f'{seen}')
        else:
            print('  (playwright 없음 — ③ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
