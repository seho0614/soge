"""v10.124 시험 — 남은 영어 빈칸: 신뢰지표 배지 · 구독 안내 · 결제사 주문 이름(D127 · docs/188)

  KIT=$K SITE=http://localhost:15174 API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1124.py

  ① 코드 — D127(함수 칸 더함 · 한국어 칸 그대로 · state_code 1:1) · API(배지 칸 · noticeCode · nameKo) · 사용자 웹(배지 · 구독 안내 · 환불 · 주문 이름) · 사전 ko/en · 판
  ② DB · API — 배지 한국어 글이 D078 과 같은 모양 · 상태 코드가 한국어 상태와 맞음 · 구독 안내 코드 · 요금제 nameKo
  ③ (사용자 웹) 영어 켜고 — 신뢰지표 · 구독 화면이 영어 · 한국어 화면은 서버 글 그대로 — 끝나면 원래대로
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
SITE = os.environ.get('SITE'); API = os.environ.get('API'); DB = os.environ.get('DB')
M = 'site/src/i18n/messages/'
RES = []
ST = {'달성': 'ACHIEVED', '미달': 'NOT_MET', '평가 없음': 'NO_RATING', '기간 미달': 'PERIOD_SHORT', '심사중': 'IN_REVIEW', '반려': 'REJECTED', '미제출': 'NOT_SUBMITTED'}


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def js(rel):
    return json.loads(rd(rel) or '{}')


def flat(d, pre=''):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict): out.update(flat(v, pre + k + '.'))
        else: out[pre + k] = v
    return out


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


def call(p, t=None):
    hd = {'content-type': 'application/json', **({'Authorization': 'Bearer ' + t} if t else {})}
    return json.load(urllib.request.urlopen(urllib.request.Request(API + p, headers=hd), timeout=60))


def login(e):
    r = urllib.request.Request(API + '/auth/login', data=json.dumps({'email': e, 'password': 'sgb-dev-1234'}).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.load(urllib.request.urlopen(r, timeout=30))['accessToken']


# ① 코드
D = rd('prisma/migrations/D127_partner_badge_codes/migration.sql'); D78 = rd('prisma/migrations/D078_partner_badge_label_fix/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 165 · 마지막 D127', (len(mig), mig[-1]) in ((165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate'), (184, 'D146_switch_locks'), (185, 'D147_mail_lock')), f'{len(mig)} · {mig[-1]}')
keep = ["state := CASE WHEN v_deals >= r.threshold THEN '달성' ELSE '미달' END;", "detail := '지금 ' || v_deals || '건(소비자 확인 기준)';",
        "WHEN v_rcnt = 0 THEN '평가 없음' ELSE '미달' END;", "'부터 · 분쟁 ' || v_disp || '건' END;", "state := coalesce(v_qual, '미제출');"]
ok('① D127 — DROP 뒤 다시 만듦 · 새 칸 8개 · 한국어 이름 · 상태 · 설명 식은 D078 과 같음 · 상태 코드 7개',
   'DROP FUNCTION IF EXISTS public.fn_partner_badges(uuid);' in D and 'state_code text, badge_kind text, badge_label text, need_n numeric, need_months int, cur_n int, cur_rating numeric, since_on date' in D
   and all(k in D and k in D78 for k in keep) and all(f"WHEN '{k}' THEN '{v}'" in D for k, v in ST.items()), '')
PS = rd('src/modules/partner/partner.service.ts'); RS = rd('src/modules/billing/recurring.service.ts'); BS = rd('src/modules/billing/billing.service.ts')
ok('① API — 배지 칸 · 구독 noticeCode(7가지 · 한국어 글 그대로) · 요금제 이름 번역은 안내 글을 만든 뒤 · 요금제 nameKo',
   '"stateCode"' in PS and '"sinceOn"' in PS and all(f"{c}:" in RS for c in ('REFUND_OPEN', 'CHARGE_IN_FLIGHT', 'CANCELLED_UNPAID', 'CANCEL_RESERVED', 'PAST_DUE', 'NO_METHOD', 'PLAN_CHANGE'))
   and 'notice, noticeCode,' in RS and RS.index('const notice = noticeCode') < RS.index("'PLAN', (r: any) => r.planCode") and 'r.nameKo = r.name;' in BS, '')
TP = rd('site/src/app/partner/trust/page.tsx'); SP = rd('site/src/app/my/subscription/page.tsx'); PP = rd('site/src/components/billing/PlanPicker.tsx')
ok('① 사용자 웹 — 한국어는 서버 글(f.ko) · 배지 · 구독 안내 · 환불은 코드로 사전 · 주문 이름은 nameKo',
   '{f.ko ? b.name : bName(b)}' in TP and '(f.ko ? b.detail : bDetail(b))' in TP and '!detail0 || f.ko ? detail0' in SP and 'orderName: `${p.nameKo ?? p.name} 구독료`' in PP, '')
pk, pe = flat(js(M + 'ko/partner.json')), flat(js(M + 'en/partner.json')); mk, me_ = flat(js(M + 'ko/my.json')), flat(js(M + 'en/my.json'))
bk = {k for k in pk if k.startswith('trust.badge.')}; sk = {k for k in mk if k.startswith('sub.srv.')}
ok('① 사전 — 배지 21 · 구독 안내 7 + 환불 7 · ko/en 같음 · 상태 사전 = 함수 상태', len(bk) == 21 and len(sk) == 14 and bk <= set(pe) and sk <= set(me_)
   and {pk[f'trust.badge.state.{v}']: v for v in ST.values()} == ST and all(not re.search(r'[가-힣]', pe[k]) for k in bk) and all(not re.search(r'[가-힣]', me_[k]) for k in sk), f'{len(bk)} · {len(sk)}')
ok('① 구독 안내 사전 한국어 = 서버 글(날짜 · 요금제 자리 빼고)', all(mk[f'sub.srv.notice.{c}'].split('{')[0] in RS for c in ('REFUND_OPEN', 'CHARGE_IN_FLIGHT', 'CANCELLED_UNPAID', 'PAST_DUE', 'NO_METHOD'))
   and all(mk[k] in rd('src/modules/billing/recurring-refund.service.ts') for k in ('sub.srv.refund.noteDone', 'sub.srv.refund.noteFailed', 'sub.srv.refund.noteChecking', 'sub.srv.refund.noteStub')), '')
ok('① 판 v10.124 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 124), rd('VERSION').strip())

if API and DB:
    TI = login('intro@x.com')
    pid = psql("SELECT p.id FROM partners p JOIN businesses b ON b.id = p.business_id JOIN accounts a ON a.id = b.account_id WHERE a.email = 'intro@x.com' LIMIT 1")
    rows = [r.split('|') for r in psql(f"SELECT code, name, state, coalesce(detail,''), coalesce(state_code,''), badge_kind FROM fn_partner_badges('{pid}') ORDER BY sort_order").splitlines()]
    ok('② 배지 — 상태 코드가 한국어 상태와 1:1 · 규칙 4개', len(rows) == 4 and all(ST.get(r[2]) == r[4] for r in rows), ' · '.join(f'{r[0]}:{r[2]}={r[4]}' for r in rows))
    b = call('/partner/trust', TI).get('badges') or []
    ok('② API — 배지에 stateCode · kind · 숫자 · 한국어 글 그대로', len(b) == 4 and all(x.get('stateCode') and x.get('kind') and x.get('name') and x.get('state') for x in b)
       and [x['name'] for x in b] == [r[1] for r in rows], json.dumps([x.get('stateCode') for x in b]))
    sd = call('/me/subscription/detail', TI)
    ok('② 구독 — noticeCode 와 한국어 notice 가 함께', (sd.get('noticeCode') is None) == (sd.get('notice') is None), f"{sd.get('noticeCode')} · {str(sd.get('notice'))[:30]}")
    pl = call('/subscription-plans')
    ok('② 요금제 — nameKo = 원래 이름', pl and all(p.get('nameKo') == psql(f"SELECT name FROM subscription_plans WHERE code = '{p['code']}'") for p in pl), '')


def get(path, cookie=''):
    try: h = urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'Cookie': cookie, 'User-Agent': 'test_v1124'}), timeout=120).read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e: h = e.read().decode('utf-8', 'replace')
    return re.sub(r'<script[\s\S]*?</script>', '', h)


def restart_site():
    subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)
    for _ in range(200):
        try:
            if '<html' in get('/login'): return
        except Exception: pass
        time.sleep(5)


if SITE and API and DB:
    C = 'sgb_at=' + TI
    ko_t, ko_s = get('/partner/trust', C), get('/my/subscription', C)
    kn = sd.get('notice') or ''
    ok('③ 한국어 — 신뢰지표 · 구독 화면은 서버 글 그대로', all(r[1] in ko_t and r[2] in ko_t for r in rows) and (not kn or kn in ko_s), '')
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || '|' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        restart_site(); get('/my', C + '; sgb_lang=en')
        en_t, en_s = get('/partner/trust', C + '; sgb_lang=en'), get('/my/subscription', C + '; sgb_lang=en')
        pe_ = flat(js(M + 'en/partner.json'))
        want = [pe_[f'trust.badge.state.{r[4]}'] for r in rows]
        ok('③ 영어 — 신뢰지표 배지 상태 · 이름 영어 · 한국어 글 없음', all(w in en_t for w in want) and 'Rating 4.5+' in en_t and not any(r[1] in en_t for r in rows), ' · '.join(want))
        en_n = me_.get(f"sub.srv.notice.{sd.get('noticeCode')}", '') if sd.get('noticeCode') else ''
        ok('③ 영어 — 구독 안내가 사전 글(한국어 안내 없음)', (not kn) or (en_n.split('{')[0] in en_s and kn not in en_s), f"{sd.get('noticeCode')}")
    finally:
        en0, act0 = (before.split('|') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en0 or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if act0 == 't' else 'false'} WHERE code='en';")
        restart_site()

n = sum(1 for r in RES if r[0])
print(f'결과: {n} / {len(RES)}')
raise SystemExit(0 if n == len(RES) else 1)
