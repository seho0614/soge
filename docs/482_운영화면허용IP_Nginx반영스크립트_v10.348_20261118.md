# 482. 운영 화면 허용 IP → Nginx 반영 스크립트 (v10.348 · 2026-11-18)

> 대표 11/18 「관리자 접속 ip 관리 화면 · 적용 버튼으로 엔진엑스 구동하여 적용」 → 방식 질문에 「화면은 목록만 보여주고, 반영 스크립트를 보여준다. 사용 권한 수퍼(SUPER)」 · 허용 IP 목록은 **하나로 합침**(접속 인증의 허용 IP = Nginx 허용) → 계획 「승인 + 통과하면 병합」. 같은 날 같은 요청을 다시 주셔서 확인 → **「단추로 바로 적용 · 감시 서비스」**(스크립트 복사는 비상용으로 남김). 마이그레이션 없음(271).

## 1. 왜 · 왜 이 방식

- 운영 화면 접속 허용 IP 는 사람이 sudo 로 `/etc/nginx/sites-enabled/sgb` 의 allow 줄(3곳)을 고쳤습니다(domain-dns #14). 화면에서 목록을 관리하고 싶다는 요청입니다.
- 운영 프로그램(pm2 · ubuntu)에 sudo 를 주면 웹 프로그램이 뚫렸을 때 서버 전체가 위험해집니다. 그래서 프로그램은 **요청 파일만** 쓰고, 운영 서버의 작은 **루트 감시 서비스**(systemd path)가 그 파일을 다시 검사해 적용합니다. 요청 글은 실행하지 않고 `allow <IP>;` · `deny all;` 줄만 받습니다.
- 감시 서비스를 설치하기 전이나 고장 때는 화면의 **반영 스크립트**를 복사해 사람이 붙여 넣습니다(비상용).

## 2. 바뀐 것

| 곳 | 바뀐 것 |
|---|---|
| 운영 화면 **권한 계층 › 「접속 인증」 › 「허용 IP」** | 이 목록이 Nginx 허용 목록이기도 함(제목 줄 안내) · **마지막 하나는 「빼기」가 막힘** |
| 같은 화면 › 새 상자 **「Nginx 반영」**(SUPER 만) | 목록 수 · 지문(12자) · 마지막으로 고친 때 · 마지막 「반영했음」(때 · 사람 · 지문) · **「아직 Nginx 에 반영하지 않은 목록」** / 「반영한 목록과 같음」 · **지금 접속 주소가 목록에 없으면 「반영하면 지금 자리에서 막힘」** · 반영 스크립트 전문 · **「복사」** · **「반영했음」** |
| 새 API `GET /admin/staff-access/nginx-script` | SUPER · 감사 `STAFF_IP_NGINX_SCRIPT` — 목록 · 지문 · 스크립트(목록이 비면 빈 글자) |
| 새 API `POST /admin/staff-access/nginx-applied` | SUPER · 감사 `STAFF_IP_NGINX_APPLIED`(목록 지문) · 그 사이 목록이 바뀌었으면 409 `NGINX_LIST_CHANGED` |
| API `DELETE /admin/staff-access/allow/{id}` | 마지막 허용 IP 면 422 `IP_LAST` |
| 새 API `POST /admin/staff-access/nginx-apply` | SUPER · 감사 `STAFF_IP_NGINX_APPLY` · 확인 문구 「적용」 · 사유 → 요청 파일 `~/sgb-state/nginx-allow/request.conf` 만 씀. 422 `NGINX_CONFIRM · NGINX_REASON · NGINX_WATCH_NOT_READY`(설치 전) · `NGINX_LIST_EMPTY` · `NGINX_MY_IP_MISSING`(지금 주소가 목록에 없음 — 자기 자신 막힘 방지) · 409 `NGINX_APPLY_PENDING` |
| 같은 상자 › **「적용」**(감시 서비스 설치 뒤 열림) | 사유 · 확인 문구 → 「적용 중…」 → 1분 안에 **「마지막 적용 성공 / 실패」**(메시지 · 때 · 목록 지문). 성공하면 「반영한 목록과 같음」이 저절로 |
| 새 `deploy/aws/nginx-allow-apply.sh` | 루트 감시 서비스가 부르는 스크립트(설치 때 `/usr/local/sbin/sgb-nginx-allow-apply` 로 root 소유 복사) — 링크 · 20KB 넘는 파일 · 모르는 줄 · 잘못된 IP · 빈 목록 거절 · 메모 버림 · 허용 파일 교체 → `nginx -t` → 다시 읽기 · 실패면 되돌림 · 결과 `/var/lib/sgb-nginx-allow/result.json`(정해진 글만) |
| 새 `deploy/aws/nginx-allow-watch-install.sh` | **처음 한 번** — 위 복사 · systemd `sgb-nginx-allow.path` / `.service` · 요청 폴더(ubuntu · 700) · 결과 폴더(root) · `installed` 표시. 보여 주기 뒤 `--apply`. 끄기 `sudo systemctl disable --now sgb-nginx-allow.path` |
| 반영 스크립트(화면이 만듦) | 준비 확인(include 없으면 멈춤) → 새 허용 파일 → **바뀌는 줄(빠짐 · 더함)** → 옛 파일 백업 → 교체 → `nginx -t` → 통과면 다시 읽기 · **실패면 옛 파일로 되돌림**. 메모는 주석으로만(특수 글자 뺌) · IP 모양이 아닌 줄은 뺌 |
| 새 `deploy/aws/nginx-admin-allow-setup.sh` · `nginx_admin_allow_edit.py` | **처음 한 번** — 운영 화면 server 블록의 allow · deny 줄 묶음을 `include /etc/nginx/snippets/sgb-admin-allow.conf;` 한 줄로, 지금 IP 를 그 파일로(허용 IP 그대로). 미리 보기 → `--apply`(백업 · nginx -t 실패면 되돌림). 사용자 웹 블록 · 인증서 줄은 그대로 |

## 3. 시험 (test_v1348)

1. ① 코드 — API 둘(SUPER · 감사) · 마지막 IP 막음 · 화면 상자 · 스크립트(nginx -t · 되돌림 · 준비 확인) · 준비 스크립트 · screens.json · 문서 482 · 판 v10.348
2. ② 준비 편집기 — 예시 설정에서 운영 화면 블록 3곳만 include · 사용자 웹 그대로 · 다시 돌리면 READY
3. ③ API — 스크립트(시험 IP · 메모 특수 글자 뺌) · 반영했음 → 같음 · 목록 바꾸면 다름 · 옛 지문 409 · 마지막 IP 422 · ADMIN 403
4. ④ 스크립트 실행 — 경로를 임시 폴더로 바꾸고 sudo · nginx 를 흉내 내어: 통과면 파일 바뀜 · `nginx -t` 실패면 옛 파일로 되돌림 · 루트 감시 스크립트도 같은 방법(통과 · 되돌림 · 모르는 줄 · 잘못된 IP · 링크 · 빈 목록 거절 · 메모 버림)
   · 점검판에는 감시 서비스가 없어 「적용」 API 는 422 `NGINX_WATCH_NOT_READY` 를 확인합니다(실제 적용은 운영 서버에서만).
5. ⑤ 화면 — 상자 · 「아직 반영 안 함」 · 스크립트 · 복사 단추

## 4. 운영 적용

- 마이그레이션 · 설정 없음.
- 적용 뒤 **처음 한 번**(SUPER · 사람 · 운영 서버 ubuntu):
  1. 운영 화면 › 권한 계층 › 접속 인증 › 「허용 IP」에 집(121.168.92.13) · 사무실(211.193.0.100)이 있는지 봄(없으면 더함).
  2. `bash ~/sgb/deploy/aws/nginx-admin-allow-setup.sh admin.sogaebank.com` — 미리 보기(바뀌는 곳 3곳 · 옮길 IP 2개).
  3. 맞으면 `--apply` → 「준비 끝」 → 운영 화면 Ctrl + F5 로 열리는지.
  4. `bash ~/sgb/deploy/aws/nginx-allow-watch-install.sh` — 보여 주기 → 맞으면 `--apply` → 「설치 끝」.
  5. 운영 화면 › 권한 계층 › 접속 인증 › 「Nginx 반영」 › 사유 「처음 적용」 → 「적용」 → 확인 문구 「적용」 → 1분 안에 「마지막 적용 성공 — 반영함 — 허용 IP 2곳」.
  - 킷에서 `nginx-allow-apply.sh` 가 바뀐 판을 올리면 4 를 다시 칩니다(설치된 복사본은 저절로 바뀌지 않음).
- 되돌리기(rollback): 프로그램만 앞 판으로 돌아가도 Nginx include 는 그대로 돕니다(허용 파일이 그대로라 접속 영향 없음). 앞 판에는 「Nginx 반영」 상자가 없어 허용 IP 를 바꾸려면 sudo 로 `/etc/nginx/snippets/sgb-admin-allow.conf` 를 고칩니다.
