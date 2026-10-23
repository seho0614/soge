"""v10.42 시험 — 옛 도메인 정리(sogaebaenk.co.kr → sogaebank.com · D098) · 나의공간 「소개몰」 꼬리표 · 리드관 보류 삭제

  KIT=… DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1042.py

  ① 킷 — 옛 도메인이 남은 파일은 「적용된 마이그레이션(B900 · C870 · 체크섬 때문에 그대로) · D098(옛 값을 찾아 바꿈) · 옛 판 문서 60 · 이번 판 문서 91」 뿐
  ② DB — site.domain · site.base_url · 예시 값이 sogaebank.com
  ③ D098 — 두 번 돌려도 같음 · 운영자가 고친 값은 그대로(거래 안에서 시험하고 되돌림)
  ④ 꼬리표 · 운영 화면 서브도메인 · 보류 폴더 · 패키지 이름
"""
import json, os, re, subprocess

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
D098 = K + '/prisma/migrations/D098_domain_sogaebank_com/migration.sql'
OLD = 'sogaebaenk'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def psql(*args):
    p = subprocess.run(['psql', DB, '-qtA', '-v', 'ON_ERROR_STOP=1', *args], capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


SETTINGS = "select key || '=' || value || ' | ' || coalesce(value_example,'') from site_settings where key in ('site.domain','site.base_url','site.partner_subdomain') order by key"

# ① 킷
KEEP = ('prisma/migrations/B900_reference_data/', 'prisma/migrations/C870_partner_path/', 'prisma/migrations/D098_domain_sogaebank_com/', 'docs/60_', 'docs/91_',
        'docs/99_', 'docs/111_')   # 99 · 111 — 「옛 도메인 아님 · 정리함」을 설명하는 문장(v10.50 · v10.56 뒤에 생긴 문서)
left = []
for root, ds, fs in os.walk(K):
    ds[:] = [d for d in ds if d not in ('node_modules', '.git', '.next', 'dist')]
    for f in fs:
        p = os.path.join(root, f); rel = os.path.relpath(p, K)
        try: s = open(p, encoding='utf-8').read()
        except Exception: continue
        if OLD in s and not rel.startswith(KEEP): left.append(rel)
ok('킷 — 옛 도메인은 B900 · C870 · D098 · 문서 60 · 91 · 99 · 111 에만 남음', not left, ' · '.join(left[:5]))

# ② DB
rc, out, err = psql('-c', SETTINGS)
ok('DB — site.domain · base_url · 예시 값에 옛 도메인 없음', rc == 0 and OLD not in out and 'site.domain=sogaebank.com' in out and 'site.base_url=https://sogaebank.com' in out, (out or err).replace('\n', ' ; '))
rc, out, err = psql('-c', "select name from schema_migrations where name = 'D098_domain_sogaebank_com'")
ok('D098 적용 기록 있음', out == 'D098_domain_sogaebank_com', out or err)

# ③ D098 다시 돌리기 · 운영자 값 보존 (거래 안 · 끝에 ROLLBACK)
_, before, _ = psql('-c', SETTINGS)
rc, out, err = psql('-c', 'BEGIN', '-f', D098, '-f', D098, '-c', SETTINGS, '-c', 'ROLLBACK')
ok('D098 두 번 돌려도 오류 없음 · 값 그대로', rc == 0 and before in out, err[:200])
rc, out, err = psql('-c', 'BEGIN', '-c', "UPDATE site_settings SET value='staging.sogaebank.net' WHERE key='site.domain'",   # 자리표시자 낱말(example 등 · setting_placeholders)이 없는 값 — 설정 값 검사 트리거가 막지 않게
                    '-f', D098, '-c', "select value from site_settings where key='site.domain'", '-c', 'ROLLBACK')
ok('운영자가 고친 site.domain 은 D098 이 바꾸지 않음', rc == 0 and 'staging.sogaebank.net' in out, (out or err).replace('\n', ' ; ')[-120:])
_, after, _ = psql('-c', SETTINGS)
ok('시험 뒤 개발 DB 값 그대로(되돌림)', after == before, '')

# ④ 화면 · 폴더 · 이름
ui = open(K + '/site/src/components/my/ui.tsx', encoding='utf-8').read()
ok('나의공간 꼬리표 — HLT 는 「소개몰」', "HLT: '소개몰'" in ui and '소개뱅크몰' not in ui, '')
gw = ''.join(open(K + '/web/src/app/admin/' + x, encoding='utf-8').read() for x in ('Gwans.tsx', 'gwans/GwanList.tsx', 'gwans/GwanSettings.tsx')
             if os.path.exists(K + '/web/src/app/admin/' + x))   # v10.86 — 하위 화면을 gwans/ 로 나눔
ok('운영 화면 관 관리 — 서브도메인 xxx.sogaebank.com', gw.count('.sogaebank.com') == 2, '')
ok('리드관 보류 폴더 없음', not os.path.exists(K + '/prisma/migrations-deferred'), '')
names = [json.load(open(K + f, encoding='utf-8'))['name'] for f in ('/package.json', '/site/package.json', '/web/package.json')]
locks = [json.load(open(K + f, encoding='utf-8'))['name'] for f in ('/package-lock.json', '/site/package-lock.json', '/web/package-lock.json')]
ok('패키지 이름 sogaebank · lock 과 같음', names == ['sogaebank', 'sogaebank-site', 'sogaebank-web'] and names == locks, ' · '.join(names))
_v = tuple(int(x) for x in re.findall(r'\d+', (rd('VERSION') if 'rd' in globals() else open(K + '/VERSION').read())))
ok('VERSION v10.42 이상', _v >= (10, 42,), '.'.join(map(str, _v)))

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
