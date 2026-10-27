"""v10.123 시험 — DB 기준표 문구의 영어(D126 · docs/187)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1123.py

  ① 코드 — D126(대상 7개 · fn_i18n_source · 영어 초안은 DRAFT · 원문이 같을 때만) · I18N_FIELDS · 원문 목록 · 운영 화면 대상 · API 7곳에서 얹음 · 판
  ② DB — 초안 216칸이 모두 DRAFT · 원문과 해시가 맞음(낡지 않음) · 원문 목록에 새 대상이 나옴
  ③ 켜고 — 승인 전(DRAFT)에는 영어 화면도 원문 · 대상마다 한 칸씩 승인하면 영어로 · 한국어 요청은 원문 — 끝나면 DRAFT · 설정 원래대로
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
NEW = ['NOTIFY_EVENT', 'REPORT_REASON', 'PLAN', 'INTRO_GRADE', 'GWAN_FORM', 'UI_MESSAGE', 'AD_PLACEMENT']


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try: return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


# ① 코드
M = rd('prisma/migrations/D126_i18n_db_text/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 164 · 마지막 D126(v10.124 부터 D127 · 165)', (len(mig), mig[-1]) in ((164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill')), f'{len(mig)} · {mig[-1]}')
ok('① D126 — 대상 7개 더함(옛 18개 그대로) · fn_i18n_source 에 7개 · 광고 소재 번호는 uuid 검사',
   "'NOTIFY_EVENT','REPORT_REASON','PLAN','INTRO_GRADE','GWAN_FORM','UI_MESSAGE','AD_PLACEMENT'" in M and "'FOOTER_LINK','SETTING','POLL','POLL_OPT','INGREDIENT','HLT_CONCERN'," in M
   and all(re.search(rf"WHEN '{t}'\s+THEN", M) for t in NEW + ['NOTICE', 'HLT_CONCERN', 'PROFILE_OPT']) and "'POLL_OPT','AD_PLACEMENT') AND p_id !~*" in M, '')
ok('① 영어 초안은 DRAFT · 원문이 같을 때만 · 있으면 그대로 · 216칸',
   "'DRAFT', 'MANUAL'" in M and 'WHERE s.src = v.ko' in M and 'ON CONFLICT (target_type, target_id, field, lang) DO NOTHING' in M
   and len(re.findall(r"^  \('(?:" + '|'.join(NEW) + r")', ", M, re.M)) == 216, str(len(re.findall(r"^  \('", M, re.M))))
I = rd('src/modules/i18n/i18n.service.ts'); C = rd('src/modules/i18n/i18n.controller.ts'); T = rd('web/src/app/admin/Translations.tsx')
ok('① I18N_FIELDS · 원문 목록(SRC) · 컨트롤러 · 운영 화면에 7개',
   all(f'{t}: [' in I and f'{t}: {{ from:' in I and f"'{t}'" in C and f"{t}: '" in T and f"'{t}'" in T for t in NEW)
   and "GWAN_FORM: ['subject', 'title_hint', 'body_hint', 'notice']" in I and "legal_basis: '근거'" in T, '')
S = {n: rd(p) for n, p in (('mn', 'src/modules/me/me-notify.service.ts'), ('ab', 'src/modules/review/abuse.service.ts'), ('bl', 'src/modules/billing/billing.service.ts'),
                            ('in', 'src/modules/introducer/introducer.service.ts'), ('pu', 'src/modules/public/public.service.ts'), ('ad', 'src/modules/ads/ads.service.ts'))}
ok('① API 에서 얹음 — 알림 설정 · 신고 사유 · 내 신고 · 요금제(혜택 줄 나눔) · 등급 · 내 등급 · 고정 문구 · 등록 안내 · 광고(serve · 미리보기 · 인피드)',
   "'NOTIFY_EVENT', (r: any) => r.eventCode, { name: 'name', reason: 'legal_basis' }" in S['mn'] and S['ab'].count("'REPORT_REASON'") == 2
   and "'PLAN', (r) => r.code, { name: 'name', features: 'features' }" in S['bl'] and ".split('\\n')" in S['bl'] and S['in'].count("'INTRO_GRADE'") == 2
   and "'UI_MESSAGE', (r) => r.code" in S['pu'] and "'GWAN_FORM', (r) => `${gwanCode}:${r.role}`" in S['pu'] and S['ad'].count("'AD_PLACEMENT'") == 4, '')
ok('① 판 v10.123 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 123), rd('VERSION').strip())

if API and DB:
    TA = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    TI = call('POST', '/auth/login', {'email': 'intro@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    q = "target_type IN ('" + "','".join(NEW) + "') AND lang = 'en'"
    st = psql(f"SELECT status, count(*) FROM content_translations WHERE {q} GROUP BY 1")
    ok('② 초안 — 모두 DRAFT(승인 전) · 213칸 이상(점검판 216 · 빈 DB 213 — 개발 시험 자료에만 있는 광고 소재 3개는 원문이 없어 건너뜀)',
   st.startswith('DRAFT|') and '\n' not in st and int(st.split('|')[1]) >= 213, st)
    stale = psql(f"SELECT count(*) FROM v_translation_state WHERE {q} AND (is_stale OR source_missing)")
    ok('② 초안이 원문과 맞음(낡음 · 원문 없음 0)', stale == '0', stale)
    cat = {t: call('GET', f'/admin/i18n/catalog?targetType={t}&lang=en&size=100', t=TA) for t in NEW}
    ok('② 원문 목록 — 7개 대상이 나오고 칸마다 초안 상태', all((c.get('items') or []) and all(f.get('status') == 'DRAFT' for x in c['items'] for f in x['fields'] if f.get('id')) for c in cat.values()),
       json.dumps({t: len(c.get('items') or []) for t, c in cat.items()}))
    PICK = [('NOTIFY_EVENT', 'LOGIN_LOCKED', 'name'), ('NOTIFY_EVENT', 'LOGIN_LOCKED', 'legal_basis'), ('REPORT_REASON', 'SPAM', 'label'), ('PLAN', 'BASIC', 'name'), ('PLAN', 'BASIC', 'features'),
            ('INTRO_GRADE', 'SEED', 'name'), ('GWAN_FORM', 'MAL:OFFER', 'notice'), ('UI_MESSAGE', 'DISPUTE_HOLD', 'message')]
    ad = psql("SELECT a.id FROM v_ad_serving a JOIN content_translations c ON c.target_type = 'AD_PLACEMENT' AND c.target_id = a.id::text AND c.field = 'title' "
              "ORDER BY a.slot_code LIMIT 1")
    if ad: PICK.append(('AD_PLACEMENT', ad, 'title'))
    ids = [psql(f"SELECT id FROM content_translations WHERE target_type = '{t}' AND target_id = '{i}' AND field = '{f}' AND lang = 'en'") for t, i, f in PICK]
    EN = {(t, i, f): psql(f"SELECT text FROM content_translations WHERE id = {x}") for (t, i, f), x in zip(PICK, ids)}
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || '|' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    H = {'X-Lang': 'en'}

    def views(h=None):
        pr = {r['eventCode']: r for r in (call('GET', '/me/notification-prefs', t=TI, h=h).get('items') or [])}
        rr = {r['code']: r['label'] for r in call('GET', '/report-reasons', h=h)}
        pl = {r['code']: r for r in call('GET', '/subscription-plans', h=h)}
        gr = {r['code']: r['name'] for r in call('GET', '/me/introducer/grades', t=TI, h=h)}
        fc = {r['role']: r['notice'] for r in call('GET', '/gwans/MAL/form-copy', h=h)}
        um = call('GET', '/ui-messages', h=h)
        ac = call('GET', f'/ads/{ad}', h=h) if ad else {}
        return {('NOTIFY_EVENT', 'LOGIN_LOCKED', 'name'): pr.get('LOGIN_LOCKED', {}).get('name'), ('NOTIFY_EVENT', 'LOGIN_LOCKED', 'legal_basis'): pr.get('LOGIN_LOCKED', {}).get('reason'),
                ('REPORT_REASON', 'SPAM', 'label'): rr.get('SPAM'), ('PLAN', 'BASIC', 'name'): pl.get('BASIC', {}).get('name'),
                ('PLAN', 'BASIC', 'features'): '\n'.join(pl.get('BASIC', {}).get('features') or []), ('INTRO_GRADE', 'SEED', 'name'): gr.get('SEED'),
                ('GWAN_FORM', 'MAL:OFFER', 'notice'): fc.get('OFFER'), ('UI_MESSAGE', 'DISPUTE_HOLD', 'message'): um.get('DISPUTE_HOLD'),
                **({('AD_PLACEMENT', ad, 'title'): ac.get('title')} if ad else {})}
    ko0 = views()
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)   # overlay 설정 기억(30초)
        en0 = views(H)
        ok('③ 켬 · 승인 전 — 영어 요청도 원문(초안은 나가지 않음)', en0 == ko0 and all(ko0.values()), ' · '.join(f'{k[0]}:{v}' for k, v in en0.items() if v != ko0.get(k))[:200])
        for x in ids: call('POST', f'/admin/i18n/translations/{x}/approve', t=TA)
        en1 = views(H); ko1 = views()
        bad = [f'{k[0]}.{k[2]}={str(en1.get(k))[:30]}' for k in EN if en1.get(k) != EN[k]]
        ok(f'③ 승인한 {len(PICK)}칸 — 영어 요청은 영어(요금제 혜택은 줄로 나뉨)', not bad, ' · '.join(bad))
        ok('③ 한국어 요청은 원문 그대로', ko1 == ko0, '')
    finally:
        if ids: psql(f"UPDATE content_translations SET status = 'DRAFT', approved_by = NULL, approved_at = NULL WHERE id = ANY('{{{','.join(ids)}}}'::bigint[]);")
        en_, act_ = (before.split('|') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en_ or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act_ == 't' else 'false'} WHERE code='en';")

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
