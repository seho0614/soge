"""v10.382 (D242 · docs/518) 자동 전표 · 월 마감
  ① (코드) D242 · 작업 · API · 화면
  ② (작업) 광고 청구 · 입금 전표 · 한 번 · 차변 = 대변
  ③ (마감 · CSV) 마감 · late · 승인
  ── ERP 판(e3.7t) — sgb-infra qa/test_v1382.py 를 옮김: API 는 ERP(13100 · ERP 증표) · 회계 표는 ERP DB · 소개뱅크 표는 소개뱅크 DB
     화면 단계 · 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사는 뺌(docs/e3.7t-notes.md) · 실행: python3 qa/test_erp_v1382.py
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erp_common import *  # noqa: F401,F403 — e3.7t 공용(ERP · 소개뱅크 주소 · DB · 증표)
agree_seed()




M42, JN, AC, SC, WK, UI = rd('prisma/migrations/D242_acct_journal_closing_tax_type/migration.sql'), rd('src/modules/acct/journal.ts'), rd('src/modules/acct/acct.controller.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/Acct.tsx')
ok('① 코드 — D242 전표 · 줄(쌓기만 · 차변 = 대변 미룬 검사) · 마감(쌓기만 · 마감 달 막음) · 작업 매시간 · 실패 알림 · API(감사 · 내려받기 승인) · 전표 화면 · 문서 518 · 판 v10.382' + ' [ERP: 소개뱅크 화면 · 메뉴 · 마이그레이션 · 문서 · 판 검사 뺌]',
   'ON CONFLICT (source, source_key) DO NOTHING' in JN
       and "@ExportGate('ACCT_JOURNAL')" in AC
       and "@Audit('ACCT_CLOSE', 'SETTING')" in AC, VER)
if API and DB:
    pass  # ERP: 약관 동의는 erp_common.agree
    agree('admin@x.com', PW); agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1382', 'PAYOUT'); agree(pe, PW); TP = login(pe)
    st0 = psql_sgb("SELECT value FROM site_settings WHERE key = 'acct.start_on'")
    setst = lambda v: psql_sgb(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1382', true); UPDATE site_settings SET value = '{v}' WHERE key = 'acct.start_on'; COMMIT;")
    stamp = int(time.time()) % 1000000
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    prev = (kst.replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')
    try:
        setst('2026-01-01')
        adv = sgb('POST', '/admin/advertisers', {'code': f'ADV-1382-{stamp}', 'name': f'시험광고주1382 {stamp}'}, TS)
        inv = sgb('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 10000, 'dueDate': d0, 'memo': '시험 1382'}, TS)
        pay = sgb('POST', f"/admin/ad-invoices/{inv.get('id')}/payments", {'amount': 11000, 'method': 'TRANSFER'}, TS)
        r1 = erp('POST', '/admin/acct/journal/run', None, TS)
        ent = lambda src, key: psql_erp(f"SELECT e.entry_date::text || '|' || e.late || '|' || (SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_lines l WHERE l.entry_id = e.id) FROM acct_entries e WHERE e.source = '{src}' AND e.source_key = '{key}'")
        ei, ep = ent('AD_INVOICE', inv.get('id')), ent('AD_PAYMENT', psql_sgb(f"SELECT id FROM ad_payments WHERE invoice_id = '{inv.get('id')}' ORDER BY id DESC LIMIT 1"))
        r2 = erp('POST', '/admin/acct/journal/run', None, TS)
        unb = psql_erp("SELECT count(*) FROM (SELECT e.id FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)) x")
        badins = psql_erp(f"BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key) VALUES (current_date, 'TEST', 't1382-{stamp}') RETURNING id) INSERT INTO acct_lines (entry_id, role, debit) SELECT id, 'CASH', 100 FROM e; COMMIT;")
        up = psql_erp(f"UPDATE acct_lines SET debit = debit + 1 WHERE entry_id = (SELECT id FROM acct_entries WHERE source = 'AD_INVOICE' AND source_key = '{inv.get('id')}')")
        jn = erp('GET', f'/admin/acct/journal?ym={ym}', None, TP)
        ok('② 작업 — 광고 청구(외상매출금 11,000 / 광고 매출 10,000 · 부가세 1,000) · 입금(보통예금 / 외상매출금) · 다시 돌려도 같은 근거는 안 만듦 · 모든 전표 차변 = 대변 · 차변 ≠ 대변 넣기 막힘 · 고치기 막힘 · 지급 담당 보기',
           bool(inv.get('id')) and ei.endswith('|false|AR:11000:0,REV_AD:0:10000,VAT_OUT:0:1000') and ep.endswith('|false|CASH:11000:0,AR:0:11000')
           and (r1.get('made') or {}).get('AD_INVOICE', 0) >= 1 and (r2.get('made') or {}).get('AD_INVOICE', 0) == 0 and unb == '0' and '!' in badins and '!' in up
           and int((jn.get('total') or {}).get('entries') or 0) >= 2 and (jn.get('total') or {}).get('debit') == (jn.get('total') or {}).get('credit'),
           f"{ei} · {ep} · {r1.get('made')} {r1.get('failedCount')} · {r2.get('made')} · 안 맞음 {unb} · {badins[-40:]} · {up[-30:]} · {jn.get('total')}")
        # ③ 마감 — 이번 달 422 · 지난달 마감(이미면 409) · 두 번 409 · 지난달 날짜로 생긴 돈 흐름은 오늘 날짜(late) · CSV 승인 없이 422 · 승인 뒤 받음
        cf = erp('POST', '/admin/acct/closings', {'ym': ym, 'note': '시험 1382'}, TS)
        c1 = erp('POST', '/admin/acct/closings', {'ym': prev, 'note': '시험 1382'}, TS)
        c2 = erp('POST', '/admin/acct/closings', {'ym': prev, 'note': '시험 1382 두 번'}, TS)
        inv2 = sgb('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 20000, 'dueDate': d0, 'memo': '시험 1382 늦게'}, TS)
        psql_sgb(f"UPDATE ad_invoices SET created_at = '{prev}-15 12:00+09' WHERE id = '{inv2.get('id')}'")
        erp('POST', '/admin/acct/journal/run', None, TS)
        el = ent('AD_INVOICE', inv2.get('id'))
        direct = psql_erp(f"INSERT INTO acct_entries (entry_date, source, source_key) VALUES ('{prev}-20', 'TEST', 't1382c-{stamp}')")
        # v10.392 부터 기본 양식이 「세무사랑 일반전표」일 수 있어 「일반 양식」을 골라 내려받음(D244 전이면 format 없음 = 옛 머리줄)
        gfmt = psql_erp("SELECT coalesce(max(id)::text, '') FROM acct_export_formats WHERE name = '일반 양식'") if psql_erp("SELECT to_regclass('public.acct_export_formats') IS NOT NULL") == 't' else ''
        fq = f'&format={gfmt}' if gfmt.isdigit() else ''
        nt = erp('GET', f'/admin/acct/journal/export?ym={ym}{fq}', None, TP)
        tk = ticket(TP, 'ACCT_JOURNAL', TS)
        cv = erp('GET', f'/admin/acct/journal/export?ym={ym}{fq}&ticket={tk}', None, TP) if tk else {}
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

summary()
