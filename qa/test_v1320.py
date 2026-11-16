"""v10.320 (docs/446) — 공지 한 곳으로(소개광장 › 공지 = 운영 공지) · 공지 알림 기본 켬 · 알림은 소개광장 공지로 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1320.py

  ① (코드) D221 알림 주소 · 소개광장 공지 부품(GET /notices) · 소개광장 공지 글쓰기 입구 막힘(CreatePostDto) · 머리줄 점 · 알림 단추 「공지 보기」 · 운영 화면 알림 기본 켬 · 사전 · 문서 446 · 판 v10.320
  ② (DB) fn_notice_notify 주소 · schema_migrations D221
  ③ (API) 운영 공지(로그인 회원 · 고정 · 알림) 등록 → buyer 알림 주소 = 소개광장 그 공지 · 소개광장 공지 글쓰기 400
  ④ (사용자 웹 · 로그인 안 함) 소개광장 「공지」 탭에 전체 공개 공지 · 회원만 공지 없음 · 「전체」 탭 맨 위 고정 공지 · 시험 공지 지움
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




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


M21 = rd('prisma/migrations/D221_notice_link_plaza/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if x[:1] in 'ABCD') if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
CP, PN, UH, NF, MO, PD = rd('site/src/app/community/page.tsx'), rd('site/src/components/community/PlazaNotices.tsx'), rd('site/src/components/common/UniHeader.tsx'), rd('site/src/app/my/notifications/page.tsx'), rd('web/src/app/admin/MainOps.tsx'), rd('src/modules/community/community.dto.ts')
KO = lambda n: json.loads(rd(f'site/src/i18n/messages/ko/{n}.json') or '{}')
EN = lambda n: json.loads(rd(f'site/src/i18n/messages/en/{n}.json') or '{}')
D446 = doc('446_')
ok('① DB — D221 fn_notice_notify 다시 만듦 · 알림 주소 /community?board=NOTICE#n-<id> · 지우는 문장 없음 · 마이그레이션 259',
   'CREATE OR REPLACE FUNCTION public.fn_notice_notify' in M21 and "'/community?board=NOTICE#n-' || n.id::text FROM pick" in M21
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', M21) and len(mig) >= 259 and 'D221_notice_link_plaza' in mig, f'{len(mig)}')
ok('① 소개광장 — 「공지」 탭 맨 위 운영 공지(GET /notices · 펼치기 · 첨부 · #n-id) · 「전체」 첫 쪽 고정 2줄 · 공지 글쓰기는 입구(CreatePostDto)에서 받지 않음',
   ("apiGetPersonal<PlazaNotice[]>('/notices')" in CP or "apiGetPersonal<PlazaNotice[]>(`/notices${" in CP) and "mode={cur === 'NOTICE' ? 'full' : 'pinned'}" in CP and 'id={`n-${n.id}`}' in PN and '<NoticeFiles' in PN
   and 'export const PLAZA_PINNED_MAX = 2;' in PN and "@IsIn(['REVIEW', 'TRADE', 'QNA'])" in PD and "'NOTICE'" not in PD.split('class CreatePostDto')[1].split('class UpdatePostDto')[0].replace('★ NOTICE', ''), '')
ok('① 알림 · 머리줄 · 운영 화면 · 사전 · 문서 — 머리줄 공지 점 → 소개광장 공지 · 알림 단추 「공지 보기」 · 공지 등록 「알림」 처음부터 켬 · plaza.ntc · my.ntf.link.notice ko · en · 문서 446 · 판 v10.320',
   'href="/community?board=NOTICE"' in UH and "'notice']," in NF and "notify: true });   // v10.320" in MO and '소개광장 › 공지' in MO
   and set((KO('plaza').get('ntc') or {}).keys()) == set((EN('plaza').get('ntc') or {}).keys()) >= {'h', 'empty', 'posts', 'badge', 'pinnedAria'}   # v10.322 readAll 더함(test_v1322)
   and KO('my')['ntf']['link'].get('notice') == '공지 보기' and EN('my')['ntf']['link'].get('notice') == 'View notice'
   and '소개광장' in D446 and VT >= (10, 320), VER)
if API and DB:
    ok('② DB — fn_notice_notify 주소 바뀜 · schema_migrations D221',
       psql("SELECT count(*) FROM pg_proc WHERE proname = 'fn_notice_notify' AND prosrc LIKE '%/community?board=NOTICE#n-%'") == '1'
       and psql("SELECT count(*) FROM schema_migrations WHERE name = 'D221_notice_link_plaza'") == '1', '')
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('buyer@x.com', PW)
    TA = login('admin@x.com')
    stamp = int(time.time()) % 100000
    T = f'시험 1320 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notifications WHERE event_code = 'NOTICE_PUBLISHED' AND title LIKE '새 공지 — 시험 1320 %'; "
                         "DELETE FROM notice_notified WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1320 %'); "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1320 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1320 %'")
    clean()
    try:
        now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        r = call('POST', '/admin/notices', {'title': f'{T} 회원', 'body': '회원만 공지 본문', 'grades': ['MEMBER'], 'isPinned': True, 'notify': True,
                                            'publishedAt': now, 'notifyConfirm': '모두에게 알림'}, TA)
        nid = r.get('id')
        link = psql(f"SELECT n.link_url FROM notifications n JOIN accounts a ON a.id = n.account_id WHERE a.email = 'buyer@x.com' AND n.event_code = 'NOTICE_PUBLISHED' AND n.title LIKE '새 공지 — {T} 회원%' LIMIT 1") if nid else ''
        bad = call('POST', '/me/community/posts', {'board': 'NOTICE', 'title': f'{T} 글', 'body': '소개광장에서 공지 글을 써 봄 — 막혀야 함'}, login('buyer@x.com'))
        ok('③ API — 운영 공지(로그인 회원 · 고정 · 알림) 등록 → buyer 알림 주소 = /community?board=NOTICE#n-<id> · 소개광장 공지 글쓰기 400',
           bool(nid) and link == f'/community?board=NOTICE#n-{nid}' and bad.get('_err') == 400, f"{r.get('_err')} {r.get('code')} · {link} · {bad.get('_err')}")
        if SITE:
            pub = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} 전체', '전체 공개 본문', true, now(), ARRAY['PUBLIC']) RETURNING id").splitlines()[0]
            def get(path):
                for _ in range(3):
                    try:
                        return urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'Accept-Language': 'ko'}), timeout=120).read().decode('utf-8', 'replace')
                    except Exception as e:
                        err = f'!{e}'
                        time.sleep(3)
                return err
            hn, ha = get('/community?board=NOTICE'), get('/community')
            ok('④ 사용자 웹(로그인 안 함) — 「공지」 탭: 전체 공개 공지 있음 · 회원만 공지 없음 · 「운영 공지」 제목 / 「전체」 탭 맨 위 고정 공지 → 공지 탭 그 공지',
               f'data-plaza-notice="{pub}"' in hn and (not nid or f'data-plaza-notice="{nid}"' not in hn) and '운영 공지' in hn and f'id="n-{pub}"' in hn
               and f'data-plaza-pin="{pub}"' in ha and f'/community?board=NOTICE#n-{pub}' in ha,
               f"{pub} · 공지탭 {('data-plaza-notice=' + chr(34) + pub) in hn} · 전체 {('data-plaza-pin=' + chr(34) + pub) in ha} · {hn[:60] if hn.startswith('!') else ''}")
        else:
            print('  (SITE 없음 — ④ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 공지 · 알림 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1320 %'") == '0'
       and psql("SELECT count(*) FROM notifications WHERE title LIKE '새 공지 — 시험 1320 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
