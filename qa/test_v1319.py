"""v10.319 (docs/445) — 메인 첫 화면 「상단 고정」 공지 띠 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1319.py

  ① (코드) 메인이 GET /notices 를 불러 「상단 고정」만 최대 2건 → 히어로 맨 위 띠(누르면 /support/notices#n-id) · 사전 ko · en · 운영 화면 안내 · 문서 445 · 판 v10.319
  ② (사용자 웹 · 로그인 안 함) 시험 공지 4개 — 고정 · 전체 공개 2개는 띠에 · 고정 · 로그인 회원만 · 고정 아님은 띠에 없음 · 「공지 모두 보기」
  ③ 시험 공지 지움
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
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



HV, PG, TY, CSS, MO = rd('site/src/components/home/HomeView.tsx'), rd('site/src/app/page.tsx'), rd('site/src/components/home/types.ts'), rd('site/src/styles/home.css'), rd('web/src/app/admin/MainOps.tsx')
KO, EN, D445 = json.loads(rd('site/src/i18n/messages/ko/main.json') or '{}'), json.loads(rd('site/src/i18n/messages/en/main.json') or '{}'), doc('445_')
ok('① 메인 — GET /notices(보는 사람 기준 · 캐시 안 함) 중 「상단 고정」만 최대 2건 → 히어로 맨 위 띠 · 그 공지로 가는 링크 · 「공지 모두 보기」',
   "apiGetPersonal<HomeNotice[]>('/notices')" in PG and '.filter((n) => n.isPinned).slice(0, HOME_NOTICE_MAX)' in PG and 'export const HOME_NOTICE_MAX = 2;' in TY
   and 'notices={pinned}' in PG and ('href={`/support/notices#n-${n.id}`}' in HV or 'href={`/community?board=NOTICE#n-${n.id}`}' in HV)   # v10.320 소개광장 공지로(test_v1320) and 'data-home-notices={notices.length}' in HV and 'data-home-notice-more' in HV
   and '.home-ntc {' in CSS and 'min-height: 44px' in CSS.split('.home-ntci {')[1].split('}')[0], '')
ok('① 사전 · 운영 화면 · 문서 — main.ntc ko · en(aria · label · more) · 공지 등록 칸 「고객센터 › 공지사항 · 상단 고정이면 메인 첫 화면 공지 띠」 · 문서 445 · 판 v10.319',
   set((KO.get('ntc') or {}).keys()) == {'aria', 'label', 'more'} == set((EN.get('ntc') or {}).keys()) and (EN.get('ntc') or {}).get('label') == 'Notice'
   and 'data-notice-where' in MO and '메인 첫 화면 공지 띠' in MO and '공지 띠' in D445 and VT >= (10, 319), VER)
if API and DB and SITE:
    stamp = int(time.time()) % 100000
    T = f'시험 1319 {stamp}'
    clean = lambda: psql("DELETE FROM notices WHERE title LIKE '시험 1319 %'")
    clean()
    ins = psql(f"""INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES
      ('{T} 고정A', 'a', true, now(), ARRAY['PUBLIC']),
      ('{T} 고정B', 'b', true, now() - interval '1 second', ARRAY['PUBLIC']),
      ('{T} 회원만', 'm', true, now() - interval '2 seconds', ARRAY['MEMBER']),
      ('{T} 고정아님', 'n', false, now(), ARRAY['PUBLIC'])""")
    ids = dict(x.split('|') for x in psql(f"SELECT replace(title, '{T} ', '') || '|' || id FROM notices WHERE title LIKE '{T} %'").splitlines() if '|' in x)
    try:
        html = ''
        for _ in range(3):
            try:
                html = urllib.request.urlopen(urllib.request.Request(SITE + '/', headers={'Accept-Language': 'ko'}), timeout=120).read().decode('utf-8', 'replace')
            except Exception as e:
                html = f'!{e}'
            if 'data-home-notices' in html:
                break
            time.sleep(3)
        m = re.search(r'data-home-notices="(\d+)"', html)
        has = {k: (f'data-home-notice="{v}"' in html) for k, v in ids.items()}
        ok('② 사용자 웹 메인(로그인 안 함) — 고정 · 전체 공개 2개만 띠에(최근 순) · 로그인 회원만 · 고정 아님은 없음 · 그 공지 링크 · 「공지 모두 보기」',
           not ins.startswith('!') and len(ids) == 4 and m and m.group(1) == '2' and has.get('고정A') and has.get('고정B') and not has.get('회원만') and not has.get('고정아님')
           and (f'/support/notices#n-{ids.get("고정A")}' in html or f'/community?board=NOTICE#n-{ids.get("고정A")}' in html) and '공지 모두 보기' in html and T + ' 고정A' in html,
           f"ins {ins[:80]} · n {m.group(1) if m else None} · {has}")
    finally:
        clean()
    ok('③ 지움 — 시험 공지 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1319 %'") == '0', '')
else:
    print('  (API · DB · SITE 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
