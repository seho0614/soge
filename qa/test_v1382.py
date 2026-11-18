"""v10.382 (D242 · docs/518) 자동 전표 · 월 마감
  ① (코드) D242 · 작업 · API · 화면
  ② (작업) 광고 청구 · 입금 전표 · 한 번 · 차변 = 대변
  ③ (마감 · CSV) 마감 · late · 승인
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

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

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)




M42, JN, AC, SC, WK, UI = rd('prisma/migrations/D242_acct_journal_closing_tax_type/migration.sql'), rd('src/modules/acct/journal.ts'), rd('src/modules/acct/acct.controller.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/Acct.tsx')
ok('① 코드 — D242 전표 · 줄(쌓기만 · 차변 = 대변 미룬 검사) · 마감(쌓기만 · 마감 달 막음) · 작업 매시간 · 실패 알림 · API(감사 · 내려받기 승인) · 전표 화면 · 문서 518 · 판 v10.382',
   'CREATE TABLE IF NOT EXISTS public.acct_entries' in M42 and 'DEFERRABLE INITIALLY DEFERRED' in M42 and 'trg_acct_entries_closed' in M42 and "('acct_journal', 60," in M42
   and 'ON CONFLICT (source, source_key) DO NOTHING' in JN and "case 'acct_journal':" in SC and "'ACCT_JOURNAL_FAIL'" in SC and "'acct_journal'," in WK
   and "@ExportGate('ACCT_JOURNAL')" in AC and "@Audit('ACCT_CLOSE', 'SETTING')" in AC and 'data-acct-journal=' in UI and '마감' in doc('518_') and VT >= (10, 382), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1382', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    st0 = psql("SELECT value FROM site_settings WHERE key = 'acct.start_on'")
    setst = lambda v: psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1382', true); UPDATE site_settings SET value = '{v}' WHERE key = 'acct.start_on'; COMMIT;")
    stamp = int(time.time()) % 1000000
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    prev = (kst.replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')
    try:
        setst('2026-01-01')
        adv = call('POST', '/admin/advertisers', {'code': f'ADV-1382-{stamp}', 'name': f'시험광고주1382 {stamp}'}, TS)
        inv = call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 10000, 'dueDate': d0, 'memo': '시험 1382'}, TS)
        pay = call('POST', f"/admin/ad-invoices/{inv.get('id')}/payments", {'amount': 11000, 'method': 'TRANSFER'}, TS)
        r1 = call('POST', '/admin/acct/journal/run', None, TS)
        ent = lambda src, key: psql(f"SELECT e.entry_date::text || '|' || e.late || '|' || (SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_lines l WHERE l.entry_id = e.id) FROM acct_entries e WHERE e.source = '{src}' AND e.source_key = '{key}'")
        ei, ep = ent('AD_INVOICE', inv.get('id')), ent('AD_PAYMENT', psql(f"SELECT id FROM ad_payments WHERE invoice_id = '{inv.get('id')}' ORDER BY id DESC LIMIT 1"))
        r2 = call('POST', '/admin/acct/journal/run', None, TS)
        unb = psql("SELECT count(*) FROM (SELECT e.id FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)) x")
        badins = psql(f"BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key) VALUES (current_date, 'TEST', 't1382-{stamp}') RETURNING id) INSERT INTO acct_lines (entry_id, role, debit) SELECT id, 'CASH', 100 FROM e; COMMIT;")
        up = psql(f"UPDATE acct_lines SET debit = debit + 1 WHERE entry_id = (SELECT id FROM acct_entries WHERE source = 'AD_INVOICE' AND source_key = '{inv.get('id')}')")
        jn = call('GET', f'/admin/acct/journal?ym={ym}', None, TP)
        ok('② 작업 — 광고 청구(외상매출금 11,000 / 광고 매출 10,000 · 부가세 1,000) · 입금(보통예금 / 외상매출금) · 다시 돌려도 같은 근거는 안 만듦 · 모든 전표 차변 = 대변 · 차변 ≠ 대변 넣기 막힘 · 고치기 막힘 · 지급 담당 보기',
           bool(inv.get('id')) and ei.endswith('|false|AR:11000:0,REV_AD:0:10000,VAT_OUT:0:1000') and ep.endswith('|false|CASH:11000:0,AR:0:11000')
           and (r1.get('made') or {}).get('AD_INVOICE', 0) >= 1 and (r2.get('made') or {}).get('AD_INVOICE', 0) == 0 and unb == '0' and '!' in badins and '!' in up
           and int((jn.get('total') or {}).get('entries') or 0) >= 2 and (jn.get('total') or {}).get('debit') == (jn.get('total') or {}).get('credit'),
           f"{ei} · {ep} · {r1.get('made')} {r1.get('failedCount')} · {r2.get('made')} · 안 맞음 {unb} · {badins[-40:]} · {up[-30:]} · {jn.get('total')}")
        # ③ 마감 — 이번 달 422 · 지난달 마감(이미면 409) · 두 번 409 · 지난달 날짜로 생긴 돈 흐름은 오늘 날짜(late) · CSV 승인 없이 422 · 승인 뒤 받음
        cf = call('POST', '/admin/acct/closings', {'ym': ym, 'note': '시험 1382'}, TS)
        c1 = call('POST', '/admin/acct/closings', {'ym': prev, 'note': '시험 1382'}, TS)
        c2 = call('POST', '/admin/acct/closings', {'ym': prev, 'note': '시험 1382 두 번'}, TS)
        inv2 = call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 20000, 'dueDate': d0, 'memo': '시험 1382 늦게'}, TS)
        psql(f"UPDATE ad_invoices SET created_at = '{prev}-15 12:00+09' WHERE id = '{inv2.get('id')}'")
        call('POST', '/admin/acct/journal/run', None, TS)
        el = ent('AD_INVOICE', inv2.get('id'))
        direct = psql(f"INSERT INTO acct_entries (entry_date, source, source_key) VALUES ('{prev}-20', 'TEST', 't1382c-{stamp}')")
        nt = call('GET', f'/admin/acct/journal/export?ym={ym}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_JOURNAL', TS)
        cv = call('GET', f'/admin/acct/journal/export?ym={ym}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        ok('③ 마감 · CSV — 이번 달 422 · 지난달 마감(이미면 409) · 두 번 409 · 마감 달 돈 흐름은 오늘 날짜 · late · 마감 달 날짜로 넣기 막힘 · CSV 승인 없이 422 · 지급 담당 요청 → SUPER 승인 → 받음(일반 양식 머리줄)',
           cf.get('code') == 'ACCT_CLOSE_FUTURE' and (c1.get('ok') is True or c1.get('code') == 'ACCT_CLOSED') and c2.get('code') == 'ACCT_CLOSED'
           and el.startswith(f'{d0}|true|') and '!' in direct and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk)
           and head == '일자,전표번호,줄,계정코드,계정명,차변,대변,거래처,적요,증빙,근거' and int(cv.get('rows') or 0) >= 4,
           f"{cf.get('code')} · {c1.get('ok') or c1.get('code')} · {c2.get('code')} · {el} · {direct[-30:]} · {nt.get('code')} · {bool(tk)} · {head[:40]} · {cv.get('rows')}")
    finally:
        setst(st0 or '2026-11-01')
        rm_role(pid, '1382')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
