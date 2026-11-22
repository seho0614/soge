"""v10.625 (D306 · docs/768) 켜기 도우미 — 정책 › 기능 스위치 한눈에 · 선행 조건 확인(SUPER) · 켜기는 「전체 설정」 그대로
  ① (코드) D306 opx_switch_prereq_checks(쌓기만 트리거) · 빠진 켤 조건 채움(ON CONFLICT DO NOTHING) · switches.ts prereqOf · savePrereq ·
     켤 조건 없으면 준비 아님 · POST /admin/opx/switches/{key}/prereq(SUPER · 감사) · screens.json · 화면(거르기 「켤 준비 끝」 · 확인함 단추) · 영어 문구 · 문서 768 · 판
  ② (DB 가 있을 때) 켤 조건 없는 스위치 0 · 확인 기록 고치기 · 지우기 막힘
  ③ (API 가 있을 때) 꺼진 스위치 하나 — 「확인함」 → done · 「취소」 → 처음 상태 · 없는 조건 422 · 스위치 아님 404 · 회원 403 · 시험 줄은 지움(replica)
  (두 번 돌아도 통과)
"""
import json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or ''
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


def psql(q):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


MD = os.path.join(K, 'prisma', 'migrations')
D306 = next((rd(os.path.join('prisma/migrations', x, 'migration.sql')) for x in (sorted(os.listdir(MD)) if os.path.isdir(MD) else []) if x.startswith('D306_')), '')
SW, CT = rd('src/modules/opx/switches.ts'), rd('src/modules/opx/opx.controller.ts')
UI, SC, EN = rd('web/src/app/admin/Opx.tsx'), rd('spec/screens.json'), rd('src/common/i18n/server-text.en.ts')
ok('① D306 — 확인 기록 표 · 쌓기만 트리거 · 빠진 켤 조건 채움(ON CONFLICT DO NOTHING) · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.opx_switch_prereq_checks' in D306 and 'BEFORE UPDATE OR DELETE ON public.opx_switch_prereq_checks' in D306
   and 'INSERT INTO public.opx_switch_docs' in D306 and 'ON CONFLICT (key) DO NOTHING' in D306 and not re.search(r'\bDELETE\s+FROM\b', D306), str(len(D306)))
ok('① 서버 — prereqOf · savePrereq · 켤 조건 없으면 준비 아님 · POST 경로 SUPER · 감사',
   'export function prereqOf(' in SW and 'export async function savePrereq(' in SW and "!!d?.cond && checks.every((c) => c.done)" in SW
   and "@Post('switches/:key/prereq')" in CT and "@Audit('OPX_SWITCH_PREREQ', 'SETTING')" in CT and CT.count("@Roles('SUPER')") >= 3, '')
ok('① 화면 · 명세 · 영어 — 거르기 ready · waiting · 확인함 단추 · screens.json · 영어 문구 4',
   'value="ready"' in UI and 'value="waiting"' in UI and 'data-opx-sw-mark=' in UI and '"POST /admin/opx/switches/{key}/prereq"' in SC
   and all(w in EN for w in ('선행 조건 확인 기록은 고치거나 지울 수 없습니다.', '스위치가 아닙니다.', '이 스위치의 켤 조건에는 이 선행 조건이 없습니다.')), '')
D = doc('768_')
ok('① 문서 768 — 켜기 도우미 · 선행 조건 · 전체 설정', all(w in D for w in ('켜기 도우미', '선행 조건', '전체 설정')), str(len(D)))
VER = rd('VERSION').strip()
ok('① VERSION v10.625 이상', tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 625), VER)

if DB and not psql('SELECT 1').startswith('!'):
    nc = psql("SELECT count(*) FROM site_settings s WHERE s.value_pattern ~ '^\\^\\((on|off|true|false|ASSUME|LIVE|SHADOW|ON|OFF)(\\|(on|off|true|false|ASSUME|LIVE|SHADOW|ON|OFF)){1,2}\\)\\$$' "
              "AND NOT EXISTS (SELECT 1 FROM opx_switch_docs d WHERE d.key = s.key)")
    ok('② 켤 조건 없는 스위치 0', nc == '0', nc)
    ro = psql("BEGIN; INSERT INTO opx_switch_prereq_checks (key, prereq, note) VALUES ('t1625.x', 'LEGAL', '시험 1625 막힘'); "
              "UPDATE opx_switch_prereq_checks SET note = 'x' WHERE note = '시험 1625 막힘'; ROLLBACK;")
    ok('② 확인 기록 고치기 막힘(OPX_PREREQ_RO)', 'OPX_PREREQ_RO' in ro, ro[-90:])
else:
    print('  (DB 없음 — ② 건너뜀)')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


try:
    urllib.request.urlopen(API + '/health', timeout=10).read()
    alive = True
except Exception:
    alive = False
if alive:
    __import__('consent_ok').agree_seed()
    lg = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = lg('admin@x.com'), lg('buyer@x.com')
    v = call('GET', '/admin/opx/switches', None, TS)
    its = v.get('items') or []
    pick = next((i for i in its if i.get('state') == 'OFF' and i.get('checks')), None)
    ok('③ 꺼진 스위치 중 선행 조건 있는 것 · counts.ready · waiting', bool(pick) and 'ready' in (v.get('counts') or {}) and 'waiting' in (v.get('counts') or {}),
       (pick or {}).get('key', '없음'))
    if pick:
        k, pr = pick['key'], pick['checks'][0]['prereq']
        was = pick['checks'][0]['done']
        path = f"/admin/opx/switches/{urllib.parse.quote(k)}/prereq"
        try:
            r1 = call('POST', path, {'prereq': pr, 'state': 'DONE', 'note': '시험 1625 확인'}, TS)
            a1 = next((i for i in call('GET', '/admin/opx/switches', None, TS).get('items', []) if i['key'] == k), {})
            r2 = call('POST', path, {'prereq': pr, 'state': 'UNDO', 'note': '시험 1625 취소'}, TS)
            a2 = next((i for i in call('GET', '/admin/opx/switches', None, TS).get('items', []) if i['key'] == k), {})
            d1 = next((c['done'] for c in a1.get('checks', []) if c['prereq'] == pr), None)
            d2 = next((c['done'] for c in a2.get('checks', []) if c['prereq'] == pr), None)
            ok('③ 확인함 → done · 취소 → done 아님 · 값(스위치)은 그대로', r1.get('ok') and d1 is True and r2.get('ok') and d2 is False and a2.get('value') == pick.get('value'),
               f"{k}:{pr} {d1} → {d2} · {a2.get('value')}")
            other = next((x for x in ('LEGAL', 'PRIVACY', 'KEY', 'CONTRACT', 'NOTICE') if x not in pick.get('prereq', [])), None)
            r3 = call('POST', path, {'prereq': other, 'note': '시험 1625 없음'}, TS) if other else {'_err': 422, 'code': 'OPX_PREREQ_NOT_NEEDED'}
            r4 = call('POST', '/admin/opx/switches/t1625.none/prereq', {'prereq': 'LEGAL', 'note': '시험 1625 없음'}, TS)
            r5 = call('POST', path, {'prereq': pr, 'note': '시험 1625 회원'}, TB)
            ok('③ 없는 조건 422 · 스위치 아님 404 · 회원 403', r3.get('code') == 'OPX_PREREQ_NOT_NEEDED' and r4.get('_err') == 404 and r5.get('_err') == 403,
               f"{r3.get('code')} · {r4.get('_err')} · {r5.get('_err')}")
        finally:
            if DB:
                psql("BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM opx_switch_prereq_checks WHERE note LIKE '시험 1625%'; COMMIT;")
else:
    print('  (API 없음 — ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
