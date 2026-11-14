"""v10.296 (D217 · docs/416) — 공지 자동 번역 대기열(자동 번역 스위치가 켜져 있을 때)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1296.py

  ① (코드) D217 translation_jobs 대상 NOTICE · 공지 트리거(게시 · 예약 · 게시 뒤 제목 · 본문 · 등급 · 관리자만 뺌) · 한꺼번에 넣기에 공지 · 공지용 지시문 · 운영 화면 「자동 번역」 글
  ② (API · DB) 스위치 꺼짐 → 줄 없음 · 켬 → 게시 · 예약 공지 줄 · 관리자만 · 초안은 없음 · 초안을 게시하면 줄 · 고정만 바꾸면 그대로 · 제목을 고치면 다시 대기
     · (시험 엔진 MOCK 일 때) 배치가 번역 · 자동 승인 · 영어로 고객센터 목록을 보면 번역 제목
  시험 공지는 끝냄 · 작업 줄 · 번역 · 스위치는 되돌림(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB, SITE = os.environ.get('ADMIN_WEB'), os.environ.get('SITE')
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
D416 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('416_')), '')
verok = lambda n: tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, n)
M17 = rd('prisma/migrations/D217_notice_files_translate_rate_send/migration.sql')
TR, TW = rd('src/modules/i18n/translate.service.ts'), rd('web/src/app/admin/Translations.tsx')
ok('① D217 — 작업 줄 대상에 NOTICE · 공지 트리거(게시 · 예약 포함 · 끝나지 않음 · 관리자만 뺌 · 처음 게시 · 제목 · 본문 · 등급) · D118 넣기 함수 그대로',
   "CHECK (target_type IN ('LISTING','REQUEST','NOTICE'))" in M17 and 'CREATE TRIGGER trg_notice_translation_enqueue AFTER INSERT OR UPDATE OF published_at, title, body, grades ON public.notices' in M17
   and "PERFORM public.fn_translation_enqueue('NOTICE', NEW.id::text)" in M17 and "WHERE g <> 'STAFF'" in M17 and 'OLD.published_at IS NULL' in M17, '')
ok('① 서버 · 화면 — 한꺼번에 넣기에 공지(관리자만 뺌) · 공지용 지시문 · 운영 화면 「자동 번역 (매물 · 요청 · 공지)」 · 문서 416 · 판 v10.296',
   "UNION ALL SELECT 'NOTICE', id::text FROM notices" in TR and "j.target_type === 'NOTICE' ? 'announcements from the operator of a referral marketplace'" in TR
   and '자동 번역 (매물 · 요청 · 공지)' in TW and '번역' in D416 and verok(296), f'{VER}')

def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(raw) if raw else {}
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
tag = f'T{stamp}X'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    KEYS = ['i18n.auto_translate.enabled', 'agent.enabled', 'agent.monthly_cap_usd', 'i18n.enabled', 'i18n.auto_langs']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    en_before = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
    Sset = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
    made = []
    jobs = lambda i: psql(f"SELECT state FROM translation_jobs WHERE target_type = 'NOTICE' AND target_id = '{i}' AND lang = 'en'")
    now_ = lambda d=-60: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + d))

    def mk(title, grades, pub):
        r = call('POST', '/admin/notices', {'title': f'시험 1296 {tag} {title}', 'body': f'번역 시험 본문 {title}', 'grades': grades, **({'publishedAt': pub} if pub else {})}, TS)
        if r.get('id'):
            made.append(r['id'])
        return r.get('id') or ''
    try:
        Sset('i18n.auto_translate.enabled', 'off')
        n0 = mk('꺼짐', ['MEMBER'], now_())
        ok('② 스위치 꺼짐 — 공지를 게시해도 번역 줄 없음', bool(n0) and jobs(n0) == '', jobs(n0))
        Sset('i18n.auto_translate.enabled', 'on'); Sset('i18n.auto_langs', 'en')
        nL, nT, nD, nF = mk('게시', ['MEMBER'], now_()), mk('관리자', ['STAFF'], now_()), mk('초안', ['MEMBER'], None), mk('예약', ['PUBLIC'], now_(86400))
        ok('② 켬 — 게시 · 예약 공지는 대기 줄 · 관리자만 · 초안은 줄 없음',
           jobs(nL) == 'QUEUED' and jobs(nF) == 'QUEUED' and jobs(nT) == '' and jobs(nD) == '', f'{jobs(nL)} · {jobs(nF)} · {jobs(nT)!r} · {jobs(nD)!r}')
        pb = call('POST', f'/admin/notices/{nD}/publish', {}, TS)
        psql(f"UPDATE translation_jobs SET state = 'DONE', result = 'SKIPPED' WHERE target_type = 'NOTICE' AND target_id = '{nL}'")
        pin = call('PATCH', f'/admin/notices/{nL}', {'isPinned': True, 'reason': '시험 1296 고정'}, TS)
        s_pin = jobs(nL)
        ed = call('PATCH', f'/admin/notices/{nL}', {'title': f'시험 1296 {tag} 게시 고침', 'reason': '시험 1296 제목'}, TS)
        ok('② 초안을 게시하면 줄 · 고정만 바꾸면 그대로(끝) · 제목을 고치면 다시 대기',
           pb.get('ok') is True and jobs(nD) == 'QUEUED' and pin.get('ok') is True and s_pin == 'DONE' and ed.get('ok') is True and jobs(nL) == 'QUEUED',
           f"{pb.get('ok')} {jobs(nD)} · {s_pin} · {jobs(nL)}")
        prov = call('GET', '/admin/i18n/jobs?size=1', None, TS).get('provider')
        if prov != 'MOCK':
            print(f'  (번역 엔진이 시험 엔진이 아님 — provider={prov} · 배치 단계 건너뜀)')
        else:
            for k, v in (('agent.enabled', 'on'), ('agent.monthly_cap_usd', '5'), ('i18n.enabled', 'on')):
                Sset(k, v)
            psql("UPDATE i18n_langs SET is_active = true WHERE code = 'en'")
            for _ in range(40):
                call('POST', '/admin/jobs', {'job': 'translate_jobs'}, TS)
                if jobs(nL) == 'DONE' and jobs(nD) == 'DONE':
                    break
            res = psql(f"SELECT result FROM translation_jobs WHERE target_type = 'NOTICE' AND target_id = '{nL}' AND lang = 'en'")
            ct = psql(f"SELECT status || '|' || engine || '|' || text FROM content_translations WHERE target_type = 'NOTICE' AND target_id = '{nL}' AND field = 'title' AND lang = 'en'")
            time.sleep(31)   # 손님 화면 번역 설정 기억(30초)
            hd = {'content-type': 'application/json', 'Authorization': 'Bearer ' + TB, 'X-Lang': 'en'}
            try:
                en = json.loads(urllib.request.urlopen(urllib.request.Request(API + '/notices', headers=hd), timeout=60).read())
            except Exception as ex:
                en = []
            ko = call('GET', '/notices', None, TB)
            te = next((x.get('title') for x in (en if isinstance(en, list) else []) if x.get('id') == nL), None)
            tk = next((x.get('title') for x in (ko if isinstance(ko, list) else []) if x.get('id') == nL), None)
            ok('② (시험 엔진) 배치가 공지를 번역 · 자동 승인 · 영어로 보면 번역 제목 · 한국어는 원문',
               jobs(nL) == 'DONE' and res == 'AUTO_APPROVED' and ct == f'AUTO_APPROVED|MOCK|[MOCK en] 시험 1296 {tag} 게시 고침'
               and te == f'[MOCK en] 시험 1296 {tag} 게시 고침' and tk == f'시험 1296 {tag} 게시 고침', f'{jobs(nL)} · {res} · {ct} · {te} · {tk}')
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = $v${v}$v$ WHERE key = '{k}'")
        psql(f"UPDATE i18n_langs SET is_active = {'true' if en_before == 't' else 'false'} WHERE code = 'en'")
        for x in made:
            psql(f"DELETE FROM translation_jobs WHERE target_type = 'NOTICE' AND target_id = '{x}'")
            psql(f"DELETE FROM content_translations WHERE target_type = 'NOTICE' AND target_id = '{x}'")
            psql(f"UPDATE notices SET is_pinned = false, ends_at = now() WHERE id = '{x}' AND published_at IS NOT NULL AND published_at <= now() AND ends_at IS NULL")
            psql(f"UPDATE notices SET published_at = NULL WHERE id = '{x}' AND published_at > now()")
        ok('② 끝나면 되돌림 — 스위치 · 시험 공지 작업 줄 · 번역',
           all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items())
           and all(jobs(x) == '' for x in made), str(before))
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
