"""v10.40 — 시험이 올리고 남긴 검수 건 정리(운영 화면 「검수 큐」가 시험 자료로 50건을 넘으면 flow_trade 가 방금 올린 건을 첫 쪽에서 못 찾음).
   제목이 시험 머리(V1036 · V1037 · V1038 · V1039 · V1040)로 시작하는 매물 · 요청의 대기 검수 건을 운영 계정으로 반려합니다(API · 사유 THIN_CONTENT · 메모 「시험 자료 정리」).
   API=http://localhost:3000/api/v1 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 review_cleanup.py
"""
import os, json, subprocess, urllib.request, urllib.error
API = os.environ.get('API', 'http://localhost:3000/api/v1'); DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', **({'authorization': 'Bearer ' + tok} if tok else {})}
    r = urllib.request.Request(API + p, method=m, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, json.loads(x.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, None
ids = subprocess.run(['psql', DB, '-X', '-tA', '-c', """select ri.id from review_items ri
  left join listings l on ri.target_type='LISTING' and l.id=ri.target_id left join requests r on ri.target_type='REQUEST' and r.id=ri.target_id
 where ri.status in ('QUEUED','IN_PROGRESS') and coalesce(l.title, r.title) ~ '^V10(3[6-9]|40) '"""], capture_output=True, text=True).stdout.split()
tok = call('POST', '/auth/login', body={'email': 'admin@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
done = sum(1 for i in ids if call('PATCH', f'/admin/reviews/{i}', tok, {'decision': 'REJECTED', 'reasonCode': 'THIN_CONTENT', 'memo': '시험 자료 정리(v10.40 review_cleanup)'})[0] < 300)
print(f'정리 {done} / {len(ids)}')
