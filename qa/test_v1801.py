"""v10.801 (docs/917 · D335) 묶음 8 — ERP 내부 API 14 · 관 점검 지금 끝내기 경합 · 알림 STOCK_ · 집합 함수 ROWS(A2)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1801.py
  ① (코드) 내부 길 14개 · ErpLinkGuard · AI 본문 8MB 는 토큰 꼴일 때만 · STOCK_ · gwan tick(forceEndId) · 문서 917 · 판
  ② (DB) D335 — 22개 ROWS · 새 집합 함수는 ROWS 를 적거나 아래 목록(여러 줄 · 단독 호출)에 있어야 함
  ③ (API) 서비스 토큰 없이 내부 길 403 · 틀린 꼴 토큰 403
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




def call_h(m_, p, hd, b=None):
    h = {'content-type': 'application/json', **hd}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ == 'POST' else None), headers=h, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        return {'_err': e.code}

ALLOW_MULTI = set(['fn_ad_anonymize', 'fn_adx_click', 'fn_adx_serve', 'fn_check_banned_words', 'fn_check_k_alert', 'fn_classify', 'fn_classify_blocked', 'fn_classify_board', 'fn_classify_learn', 'fn_classify_terms', 'fn_consult_deliver', 'fn_directory_expiry_tick', 'fn_end_promo', 'fn_hlt_benefit_apply', 'fn_hlt_license_watch', 'fn_hlt_settle_close', 'fn_integ_secret_set', 'fn_jobs_due', 'fn_lead_assign', 'fn_lead_assign_tick', 'fn_lead_candidates', 'fn_login_fail', 'fn_mal_partner_bulk_migrate', 'fn_notice_audience', 'fn_notice_notify_due', 'fn_open_phase', 'fn_ops_alert_mail_pending', 'fn_ops_alert_push_pending', 'fn_ops_alert_remail_pending', 'fn_ops_alert_repush_pending', 'fn_ops_alert_slack_pending', 'fn_ops_alert_slack_repush_pending', 'fn_ops_board_purge', 'fn_partner_badges', 'fn_payout_reveal', 'fn_perm_effective', 'fn_perm_widen_effective', 'fn_plan_update', 'fn_plink_click', 'fn_ptn_perf_series', 'fn_request_candidates', 'fn_risk_learn', 'fn_risk_scan', 'fn_segment_learn', 'fn_sfx_retention_sync', 'fn_smq_grade_calc', 'fn_verify_invariants', 'opb_alert_route_pending', 'pgp_armor_headers', 'regexp_split_to_table', 'regexp_split_to_table', 'sec2_staff_day_counts'])   # 11/26 D335 뒤 기본 1000 그대로 둔 집합 함수(여러 줄 · 단독 · 배치) — 새로 넣으면 ROWS 를 적거나 여기에 사유와 함께

CT = rd('src/modules/erp-link/erp-link-more.controller.ts') + rd('src/modules/erp-link/erp-link.controller.ts')
SH = rd('src/common/security-headers.ts')
IN = rd('src/modules/erp-link/erp-internal.ts')
GM = rd('src/modules/site/gwan-maint.service.ts')
MIG = rd('prisma/migrations/D335_srf_rows/migration.sql')
paths = ['export/consume', 'agent/allowed', 'agent/provider', 'agent/complete', 'agent/record', 'files/:id/content', 'biz-status',
         'mail/ready', "'mail'", 'etax/send', 'products/tax-type', 'bank/fetch', 'taxinbox/fetch', 'transfer/send']
missing = [p for p in paths if p.strip("'") not in CT]
ok('① 내부 길 14 · 가드 · AI 8MB 는 토큰 꼴(erp_ + 64)일 때만 · STOCK_ · 관 점검 tick(forceEndId)',
   not missing and 'ErpLinkGuard' in CT and "/^erp_[0-9a-f]{64}$/" in SH and '|STOCK)_' in IN
   and 'tick(forceEndId' in GM and 'OR id = $1::int' in GM, f'없음 {missing}')
ok('① D335 22줄 · 문서 917 · 판 v10.801 이상', MIG.count('ALTER FUNCTION public.') == 22 and doc('917_') != '' and VT >= (10, 801), VER)

if DB:
    rows = psql("SELECT p.proname || '=' || p.prorows FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public' WHERE p.proretset")
    got = dict(x.split('=') for x in rows.split() if '=' in x)
    one = ['fn_mtr_trust', 'fn_search_normalize', 'fn_login_gate', 'fn_refund_basis', 'fn_trust_score']
    bad_new = sorted(k for k, v in got.items() if v == '1000' and k not in ALLOW_MULTI)
    ok('② DB — ROWS 1 · 매칭 점수 5 · 새 집합 함수는 ROWS 또는 목록', all(got.get(k) == '1' for k in one) and got.get('fn_match_scores') == '5' and not bad_new,
       f'새 기본값 {bad_new[:5]}')
if API:
    r1 = call('POST', '/internal/erp/export/consume', {'id': '1', 'target': 'ACCT_LEDGER', 'accountId': '00000000-0000-0000-0000-000000000000'})
    r2 = call_h('GET', '/internal/erp/mail/ready', {'X-Erp-Service-Token': 'erp_' + '0' * 64})
    ok('③ 토큰 없이 403 · 틀린 토큰 403', r1.get('_err') == 403 and r2.get('_err') == 403, f"{r1.get('_err')} · {r2.get('_err')}")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
