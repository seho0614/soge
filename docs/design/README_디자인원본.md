# 디자인 원본 그림 — 킷 밖 「디자인 원본 묶음」으로 분리 (v10.31.1 · 2026-10-11)

킷 크기(파일 하나 30MB 한도) 때문에 받은 디자인 원본 그림 3장은 **zip · tar 묶음에서 빼고** 따로 드립니다.
→ `SGB_Design_Originals_20261011.zip` (한 번만 받으면 됩니다 — 원본이 바뀌지 않는 한 다음 판에도 다시 보내지 않습니다)

| 파일(킷 안 제자리) | 크기 | sha256 | 쓰는 곳 |
|---|---|---|---|
| `sgb/docs/design/plaza_design_20261007.png` | 2,017,769 바이트 | `d46a1cddb9de5bd97e5a9ea9fb3d0eba3efd2f0f94a1799337c480fbd551235c` | 소개광장 그림 조각(`site/public/b2`) · 시험 cut_b2 · srv_cmu_ui · proto_cmu |
| `sgb/docs/design/mall_design_from_chat_89332263.jpeg` | 376,185 바이트 | `913a22f2a662741ecb628afac104e849a6d223c61513e589118a0175e1391a8f` | 소개몰 그림 조각(`site/public/shop`) · 시험 cut_mall |
| `sgb/spec/design/hero_page_20261002.png` | 1,910,641 바이트 | `3f6fe15f4a2d59734ad0dbd0e2ad3cec97a72df60c61fff4d0d96acd60149d1f` | 메인(hero) 그림 조각(`site/public/home/d`) · crop_design.py |
| (참고) `sgb/docs/design/money_main_20261009.webp` | 3.3MB | `72d7a168…` | v10.30 부터 킷 밖 — PC `C:\cludel\Claude outputs\소개장터_메인_받은그림_원본_money_main_20261009.webp` |

## 원본이 없어도 되는 이유
- 실제 웹 · 운영 화면 · 서버 · 시안은 원본을 읽지 않습니다. 원본에서 **잘라 낸 조각**(킷 안 `site/public/b2 · shop · home/d`)만 씁니다.
- 원본을 읽던 것은 검사 도구뿐입니다. 원본이 없으면 검사 도구는 `qa/design_fingerprints.json` 의 지문(원본과 견줘 통과한 조각 파일의 sha256)과 견줍니다 — 조각이 한 점이라도 바뀌면 실패합니다.

## 원본이 필요한 경우
- 조각을 **새로 자를 때**(디자인이 바뀌어 다시 자름) · 원본과 **직접** 견주고 싶을 때 → 묶음을 풀어 위 표의 제자리에 두면 검사 도구가 자동으로 원본과 직접 견줍니다.
