"""v10.160 시험 — 옛 약관 게시 스크립트를 운영에서 막음 · postcheck 안내(docs/244)

  docker run --rm -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core sgb-qa:v1 python3 test_v1160.py

  ① 코드 — publish-terms.sh 맨 앞(DATABASE_URL · 덮어쓰기 전)에 운영 막음 · postcheck [9] 안내가 운영 화면 · docs/84 · 228 · 244 · 판
  ② 스크립트를 임시 폴더에 복사해 돌림 — 운영 .env → 멈춤(1 · 안내) · 환경 NODE_ENV=production → 멈춤 · SGB_TERMS_SCRIPT_OK=yes → 지나감 · 개발 .env → 지나감
     (지나간 것은 DATABASE_URL 이 없어 다음 줄에서 멈춤 — DB 에 붙지 않음)
"""
import os, re, shutil, subprocess, tempfile

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(n):
    d = os.path.join(K, 'docs')
    return next((rd('docs/' + f) for f in os.listdir(d) if f.startswith(f'{n}_')), '')


# ── ① 코드 ────────────────────────────────────────────────────────────
PT = rd('scripts/publish-terms.sh'); PC = rd('deploy/aws/postcheck.sh')
g = PT.find('SGB_TERMS_SCRIPT_OK'); u = PT.find('UPDATE terms SET body'); dbu = PT.find(': "${DATABASE_URL:?')
ok('① publish-terms.sh — 운영(NODE_ENV=production · .env) 막음이 DATABASE_URL · 본문 덮어쓰기보다 앞 · 운영 화면 안내',
   0 < g < dbu < u and 'NODE_ENV' in PT[:g + 200] and '법정 고지' in PT[:dbu] and 'exit 1' in PT[g:dbu], f'{g} < {dbu} < {u}')
ok('① postcheck [9] — 약관 안내가 운영 화면 · terms:publish 쓰지 않음',
   '법정 고지 › 「약관」 에서 시행일 · 게시(SUPER)' in PC and 'npm run terms:publish"' not in PC.replace('npm run terms:publish 는 쓰지 않음', ''), '')
D244 = doc(244)
ok('① docs/84 · 228 은 운영 화면으로 · docs/244 · 판 v10.160 이상',
   'docs/244' in doc(84) and 'docs/244' in doc(228) and all(x in D244 for x in ('NODE_ENV=production', 'SGB_TERMS_SCRIPT_OK=yes', '「고치기」', 'postcheck'))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 160), rd('VERSION').strip())


# ── ② 돌려 봄 ───────────────────────────────────────────────────────────
def run(envfile, **env):
    t = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(t, 'scripts'))
        shutil.copy(os.path.join(K, 'scripts/publish-terms.sh'), os.path.join(t, 'scripts/publish-terms.sh'))
        if envfile is not None:
            open(os.path.join(t, '.env'), 'w').write(envfile)
        e = {k: v for k, v in os.environ.items() if k not in ('NODE_ENV', 'DATABASE_URL', 'SGB_TERMS_SCRIPT_OK')}
        e.update(env)
        r = subprocess.run(['bash', os.path.join(t, 'scripts/publish-terms.sh')], capture_output=True, text=True, env=e, timeout=30)
        out = r.stdout + r.stderr
        return r.returncode, ('막음' if '운영 서버(NODE_ENV=production)' in out else '지나감' if 'DATABASE_URL 필요' in out else out[:80])
    finally:
        shutil.rmtree(t, ignore_errors=True)


got = {
    '운영 .env': run('NODE_ENV=production\n'),
    '운영 .env (따옴표 · 띄어쓰기)': run('  NODE_ENV = "production"\n'),
    '환경 NODE_ENV=production': run(None, NODE_ENV='production'),
    '운영 + SGB_TERMS_SCRIPT_OK=yes': run('NODE_ENV=production\n', SGB_TERMS_SCRIPT_OK='yes'),
    '개발 .env': run('NODE_ENV=development\n'),
    '.env 없음': run(None),
}
want = {'운영 .env': (1, '막음'), '운영 .env (따옴표 · 띄어쓰기)': (1, '막음'), '환경 NODE_ENV=production': (1, '막음'),
        '운영 + SGB_TERMS_SCRIPT_OK=yes': (1, '지나감'), '개발 .env': (1, '지나감'), '.env 없음': (1, '지나감')}
ok('② 운영이면 막음 · SGB_TERMS_SCRIPT_OK=yes · 개발 · .env 없음은 지나감(DATABASE_URL 줄에서 멈춤)', got == want, str(got))

# ── ①' docs/245(운영 적용 절차서 · 킷에 있을 때만) ───────────────────────
F245 = next((f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('245_')), '')
D245 = rd('docs/' + F245) if F245 else ''
ok("①' docs/245 — 운영 적용 v10.158 → v10.160 · 마이그레이션 없음 · 188 · 스냅샷 v10-160 · 킷 ~/kits/release · sha256 · 하지 말 것",
   not F245 or ('v10.160' in F245 and '`적용됨 188 · 새 킷의 파일 188 · 올릴 것 0 · 바뀐 파일 0`' in D245 and '`적용 0 · 기존 188 · 변경감지 0`' in D245
   and '188 / 188' in D245 and 'sgb-before-v10-160' in D245 and '~/kits/release/' in D245 and '70f7e2bc6c2b6bd86d47382a3f26bbda4dcfbcaa52bd8ead0b15ae41afde9557' in D245
   and 'SGB_TERMS_SCRIPT_OK=yes' in D245 and '하지 말 것' in D245), F245 or '(킷에 아직 없음)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
