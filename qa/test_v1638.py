"""v10.638 (docs/782) 회귀 판정 — psql 글 안 설정 키 · 값 확인(SETREAD) · 모든 요청에 걸리는 키(SETGLOBAL)
  ① 규칙 — psql 글 안 `key = 'i18n.enabled'` · `key IN ('a.b', 'c.d')` · f-string 고정 부분에서 키를 찾음 · SELECT … FROM site_settings 는 SETREAD(같은 잠금)
     · 키 없는 SETREAD 는 PAR 그대로 · perm.mode 같은 키를 바꾸면 SOLO(SETGLOBAL) · 코드 검사 글자(psql 밖)는 세지 않음
  ② 실제 시험 — 11/22 부딪힌 i18n.enabled 시험 5개(1093 · 1104 · 1105 · 1119 · 1296)가 모두 잠금 set:i18n(서로 동시에 안 돎)
     · perm.mode · admin.mfa_required 를 바꾸는 시험(1564 · 1631 · 1196_daily)은 SOLO · 묶음 실행 POST /admin/…/run 은 잠금 job
  ③ 손 목록 reg_solo_force.txt 는 3줄(1570 · 1420 · 1421)로 되돌림 · 문서 782 · 판
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import os, re, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd(os.path.join(K, 'VERSION')).strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
try:
    import reg_classify as RC
except Exception as e:
    RC = None
    print('reg_classify 못 읽음', e)

# ── ① 규칙 ───────────────────────────────────────────
head = "def psql(s): return s\n"
CASES = {
    'test_v9101.py': head + "psql(\"UPDATE site_settings SET value='on' WHERE key='i18n.enabled'\")\n",                       # 글 안 키 → LOCK set:i18n
    'test_v9102.py': head + "psql(\"SELECT value FROM site_settings WHERE key = 'i18n.enabled'\")\n",                          # 값 확인 → LOCK set:i18n
    'test_v9103.py': head + "k = 'mall'\npsql(f\"DELETE FROM site_settings WHERE key IN ('i18n.engine', 'hlt.rate_auto_remind_days')\")\n",  # IN · f-string → set:hlt · set:i18n
    'test_v9104.py': head + "psql(\"SELECT count(*) FROM site_settings\")\n",                                                  # 키 없는 읽기 → PAR
    'test_v9105.py': head + "psql(\"UPDATE site_settings SET value='GROUPS' WHERE key='perm.mode'\")\n",                       # 모든 요청 → SOLO
    'test_v9106.py': "M = open('x').read() if False else ''\nok = lambda *a: 0\nok('x', \"key = 'i18n.enabled'\" in M)\n",   # 코드 검사(psql 밖) → PAR
}
tmp = tempfile.mkdtemp(prefix='t1638_')
try:
    for n, b in CASES.items():
        open(os.path.join(tmp, n), 'w', encoding='utf-8').write(b)
    rr = {r[0]: (r[2], r[3], r[1]) for r in RC.classify(tmp, K)} if RC else {}
finally:
    shutil.rmtree(tmp, ignore_errors=True)
g = lambda n: rr.get(n, ('', [], []))
ok('① 글 안 키를 바꿈 → LOCK set:i18n', g('test_v9101.py')[:2] == ('LOCK', ['set:i18n']), str(g('test_v9101.py')))
ok('① 값만 확인(SELECT … FROM site_settings) → SETREAD · LOCK set:i18n', g('test_v9102.py')[:2] == ('LOCK', ['set:i18n']) and 'SETREAD' in g('test_v9102.py')[2], str(g('test_v9102.py')))
ok('① IN 목록 · f-string 고정 부분 → set:hlt · set:i18n', g('test_v9103.py')[:2] == ('LOCK', ['set:hlt', 'set:i18n']), str(g('test_v9103.py')))
ok('① 키 없는 읽기는 PAR 그대로', g('test_v9104.py')[0] == 'PAR', str(g('test_v9104.py')))
ok('① perm.mode 를 바꿈 → SOLO(SETGLOBAL)', g('test_v9105.py')[0] == 'SOLO' and 'SETGLOBAL' in g('test_v9105.py')[2], str(g('test_v9105.py')))
ok('① psql 밖 코드 검사 글자는 세지 않음 → PAR', g('test_v9106.py')[0] == 'PAR', str(g('test_v9106.py')))
ok('① 모든 요청 키 — perm.mode · admin.mfa_required · auth.login.max_fail 잡음 · site.maintenance_mail · i18n.enabled 안 잡음',
   RC is not None and all(RC.GLOBAL_KEY_RE.match(k) for k in ('perm.mode', 'admin.mfa_required', 'auth.login.max_fail', 'signup.open'))
   and not any(RC.GLOBAL_KEY_RE.match(k) for k in ('site.maintenance_mail', 'i18n.enabled', 'perm.modex')))

# ── ② 실제 시험 ──────────────────────────────────────
rows = {r[0]: (r[2], r[3], r[1]) for r in RC.classify(HERE, K)} if RC else {}
I18N = ['test_v1093.py', 'test_v1104.py', 'test_v1105.py', 'test_v1119.py', 'test_v1296.py']
# v10.694 (docs/801) test_v1104 는 손 목록으로 SOLO(혼자 돌면 서로 동시에 안 돎 — 잠금보다 강함)
ok('② i18n.enabled 시험 5개 — 모두 잠금 set:i18n(LOCK) 또는 늘 혼자(SOLO) · 서로 동시에 안 돎',
   all((rows.get(t, ('',))[0] == 'LOCK' and 'set:i18n' in rows.get(t, ('', []))[1]) or rows.get(t, ('',))[0] == 'SOLO' for t in I18N), str({t: rows.get(t, ('',))[:2] for t in I18N}))
JR = ['test_v1382.py', 'test_v1383.py', 'test_v1423.py', 'test_v1428.py', 'test_v1433.py']
ok('② 묶음 실행 POST /admin/…/run(전표 journal/run)을 부르는 시험은 잠금 job — 11/22 전체 점검 test_v1382 가 동시 단계에서 1423 · 1428 · 1433 의 journal/run 에 걸림',
   all('job' in rows.get(t, ('', []))[1] for t in JR) and RC is not None and any(n == 'JOB' and r.search("POST /admin/acct/journal/run None") for n, r in RC.CALL_RULES),
   str({t: rows.get(t, ('', []))[:2] for t in JR}))
GL = ['test_v1564.py', 'test_v1631.py', 'test_v1196_daily.py']
ok('② perm.mode · admin.mfa_required 를 바꾸는 시험은 SOLO', all(rows.get(t, ('',))[0] == 'SOLO' for t in GL), str({t: rows.get(t, ('',))[:1] for t in GL}))

# ── ③ 손 목록 · 문서 · 판 ─────────────────────────────
force = RC.read_list(os.path.join(HERE, 'reg_solo_force.txt')) if RC else set()
# v10.646 (docs/791) test_v1646 더함 — 새 관을 잠깐 열어 /gwans · 머리줄 관 수가 바뀜(규칙은 SETREAD 만 잡음)
# v10.660 (docs/795) test_v1660 더함 — 준비중 새 관을 만들고 지움 · 관 페이지 방문 수 · 예약 게시
# v10.694 (docs/801) test_v1104(동시 단계 번역 줄 겹침) · test_v1147(buyer 비밀번호 재설정으로 옆 시험 로그인 풀림) 더함
ok('③ 늘 혼자 손 목록 = 1570 · 1420 · 1421 · 1646 · 1660 · 1675 · 1680 · 1685 · 1690 · 1104 · 1147', {'test_v1570.py', 'test_v1420.py', 'test_v1421.py'} <= force <= {'test_v1570.py', 'test_v1420.py', 'test_v1421.py', 'test_v1646.py', 'test_v1660.py', 'test_v1675.py', 'test_v1680.py', 'test_v1685.py', 'test_v1690.py', 'test_v1104.py', 'test_v1147.py'}, str(sorted(force)))
d = os.path.join(K, 'docs')
d782 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('782_')), '')
ok('③ 문서 782 — SETREAD · SETGLOBAL · set:i18n', all(w in d782 for w in ('SETREAD', 'SETGLOBAL', 'set:i18n')), str(len(d782)))
ok('③ VERSION v10.638 이상', VT >= (10, 638), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
