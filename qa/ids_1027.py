"""v10.27 — 시안 새 화면의 화면 ID 를 spec/proto_ids.json 에 더합니다(매트릭스 「시안 연결」). 여러 번 돌려도 같은 결과."""
import json, os
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = os.path.join(K, 'spec/proto_ids.json')
d = json.load(open(P, encoding='utf-8'))
NOTE = '20261009 v10.27 — '
ADD = {
  'termsv':  (['SB-HOM-ETC-021'], '약관 전문', 'G-199 약관 전문 화면'),
  'safgd':   (['SB-MNY-SAF-020'], '사기 예방 가이드', 'G-130'),
  'bpolsrc': (['SB-BIZ-POL-030'], '공고 원문', 'G-130 · 시안만(개발중)'),
  'adland':  (['SB-ADS-LND-010'], '광고주 랜딩', 'G-130 · 시안만(개발중)'),
  'admptnd': (['SB-ADM-PTN-011'], '파트너사 상세', 'G-130'),
  'admaudl': (['SB-ADM-AUD-020'], '감사 기록', 'G-130'),
  'admsegp': (['SB-ADM-SEG-020'], '옮길 대상 미리보기', 'G-130 · 시안만(개발중)'),
  'ctrform': (['SB-MYP-CTR-030'], '계약서 양식 전문', 'G-130'),
  'health#/my/orders/H20261002-000041/track/carrier': (['SB-HLT-MYO-040'], '택배사 조회', 'G-130 · 소개몰 겹쳐 뜨는 틀'),
}
for k, (ids, h1, why) in ADD.items():
    d[k] = {'ids': ids, 'h1': h1, 'mapped': NOTE + why}
json.dump(d, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('proto_ids', len(d))
