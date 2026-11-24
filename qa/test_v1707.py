"""v10.707 (docs/815) 닫힌 관 손님 안내 — 점검 중이면 관 화면 · 404 대신 「잠시 점검 중 · ○시에 다시 엽니다」 · 48시간 안 다음 점검 띠
  ① (코드) MaintBand · MaintNotice · 관 화면([gwan] · /g · 소개리드 · 허브)에 붙음 · 사전 ko · en gwan.maint · 공개 GET /gwans/{code}/maintenance
  ③ (API · 화면) 소개리드(LED) 점검 1시간 뒤 → 공개 next · BIZ 1시간 뒤 → /biz 맨 위 「점검 예정」 띠(관이 열려 있을 때) — 끝나면 지움(늘 혼자)
  ④ 문서 815 · 판
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

MB, GP, LD, EP = rd('site/src/components/gwan/MaintBand.tsx'), rd('site/src/app/[gwan]/page.tsx'), rd('site/src/app/lead/page.tsx'), rd('site/src/app/earn/page.tsx')
KO = json.loads(rd('site/src/i18n/messages/ko/gwan.json') or '{}').get('maint', {}); EN = json.loads(rd('site/src/i18n/messages/en/gwan.json') or '{}').get('maint', {})
ok('① 부품 — 점검 중 안내(끝 시각 · 글 · 처음 화면) · 48시간 안 다음 점검 띠 · 30초 캐시 · 없으면 그리지 않음',
   'export async function MaintNotice(' in MB and 'export async function MaintBand(' in MB and "apiGet<MaintStatus>(`/gwans/${code}/maintenance`, 30)" in MB
   and 'data-gwan-maint="running"' in MB and 'data-gwan-maint="next"' in MB and "if (!s?.running) return null;" in MB, '')
ok('① 붙는 곳 — 관 화면(점검 중이면 404 · 관 화면 대신) · 소개리드 · 허브 · 띠 5곳',
   'if (mt?.running && !staff) return <><MaintNotice code={code} m={mt} />' in GP and GP.count('{band}') == 5 and "if (mt?.running && !staff) return <><MaintNotice code=\"LED\"" in LD
   and "if (mt?.running && !staff) return <><MaintNotice code=\"EARN\"" in EP and LD.index("MaintNotice code=\"LED\"") < LD.index('if (!g) notFound();'), str(GP.count('{band}')))
ok('① 사전 ko · en — 제목 · 다시 여는 시각 · 예정 · 처음 화면', all(k in KO and k in EN for k in ('title', 'until', 'next', 'home')) and '{time}' in KO.get('until', '') and '{from}' in EN.get('next', ''), str(list(KO)))

if up():
    mark = psql("SELECT coalesce(max(id), 0) FROM gwan_maintenances")
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        iso = lambda s: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + s))
        call('POST', '/admin/gwan-maintenances', {'gwanCode': 'LED', 'startsAt': iso(3600), 'endsAt': iso(5400), 'note': '시험 1707 리드'}, TS)
        call('POST', '/admin/gwan-maintenances', {'gwanCode': 'BIZ', 'startsAt': iso(3600), 'endsAt': iso(5400), 'note': '시험 1707 창업'}, TS)
        pl = call('GET', '/gwans/LED/maintenance')
        ok('③ 공개 안내 — 다음 점검(48시간 안) · 점검 중 아님', pl.get('running') is None and (pl.get('next') or {}).get('note') == '시험 1707 리드', str(pl))
        if SITE and psql("SELECT is_active FROM gwans WHERE code = 'BIZ'") == 't':
            st, h = page_until('/biz', lambda h: 'data-gwan-maint="next"' in h and '시험 1707 창업' in h)
            ok('③ 사용자 웹 /biz — 맨 위 「점검 예정」 띠 · 관 화면 그대로', st == 200 and 'data-gwan-maint="next"' in h and '시험 1707 창업' in h and 'data-gwan-maint="running"' not in h, str(st))
    finally:
        psql(f"DELETE FROM gwan_maintenances WHERE id > {int(mark or 0)}")
        ok('③ 끝 — 시험 점검 지움', psql(f"SELECT count(*) FROM gwan_maintenances WHERE id > {int(mark or 0)}") == '0', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('815_')
ok('④ 문서 815 — 손님 안내 · 점검 중 · 다시 엽니다 · 점검 예정', all(w in d for w in ('손님', '점검 중', '다시 엽니다', '점검 예정')), str(len(d)))
ok('④ VERSION v10.707 이상', VT >= (10, 707), VER)
done()
