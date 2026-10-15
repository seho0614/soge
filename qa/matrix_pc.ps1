# =====================================================================
# 매트릭스 엑셀 — 집 PC (v10.43 · 2026-10-15)
#   kit 폴더에서:   .\qa\matrix_pc.ps1
#   먼저 .\dev.ps1 realcheck (또는 .\dev.ps1 up) 으로 컨테이너가 떠 있어야 합니다.
#
# 하는 일
#   1. API 컨테이너 안에서 API 문서 → 매트릭스(scripts/gen-matrix.js · 코드 + 개발 DB)
#   2. 개발 DB 에서 함수 · 외부 연동 목록(csv)
#   3. 파이썬 컨테이너(python:3.12-slim · openpyxl)로 엑셀을 만듦
#   결과: qa\matrix_out\SGB_Matrix_Verification_<날짜>_<판>.xlsx  → 이 파일을 보내 주십시오.
#   개발 데이터는 바꾸지 않습니다(읽기만). 컨테이너 안에 생긴 문서 파일은 컨테이너를 다시 만들면 사라집니다.
# =====================================================================
$ErrorActionPreference = "Continue"   # docker 는 진행 상황을 오류 줄로 냄 — 성공 여부는 종료 코드로만 봄
Set-Location (Split-Path -Parent $PSScriptRoot)
$out = Join-Path "qa" "matrix_out"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Path $out | Out-Null

function Run([string]$what, [scriptblock]$cmd) {
  Write-Host "[$what]"
  & $cmd
  if ($LASTEXITCODE -ne 0) { Write-Host "  실패 — $what (종료 코드 $LASTEXITCODE)"; exit 1 }
  Write-Host "  통과"
}

Run "1. API 문서 · 매트릭스 (API 컨테이너 · 몇 분)" {
  docker compose exec -T api sh -c "node scripts/gen-docs.js >/dev/null && npx ts-node -P tsconfig.scripts.json scripts/dump-swagger.ts >/dev/null && node scripts/merge-openapi.js >/dev/null && node scripts/gen-matrix.js"
}
Run "   matrix.json 꺼내기" { docker compose cp api:/app/docs/matrix/matrix.json "$out/matrix.json" }

$fn = "\copy (select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as returns, regexp_replace(coalesce(obj_description(p.oid,'pg_proc'),''), '\s+', ' ', 'g') as comment, (select count(*) from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal) as triggers from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p') order by 1, 2) to '/tmp/functions.csv' csv header"
$ig = "\copy (select code, name, purpose, coalesce(provider,'') as provider, status, requires_ip, coalesce(secret_key_name,'') as secret_key_name, secret_registered, blocks_open, regexp_replace(coalesce(memo,''), '\s+', ' ', 'g') as memo from integrations order by sort_order, code) to '/tmp/integrations.csv' csv header"
Run "2. 함수 · 연동 목록 (개발 DB · 읽기만)" {
  docker compose exec -T db psql -U sgb -d sgb -v ON_ERROR_STOP=1 -c $fn -c $ig
}
Run "   함수 csv 꺼내기" { docker compose cp db:/tmp/functions.csv "$out/functions.csv" }
Run "   연동 csv 꺼내기" { docker compose cp db:/tmp/integrations.csv "$out/integrations.csv" }

Copy-Item (Join-Path "sgb" "VERSION") (Join-Path $out "VERSION")
$rc = Get-ChildItem -Filter "realcheck_*.txt" | Sort-Object Name | Select-Object -Last 1
if ($rc) { Copy-Item $rc.FullName $out; Write-Host "  realcheck 결과 포함: $($rc.Name)" } else { Write-Host "  realcheck 결과 없음 — 엑셀의 realcheck 시트가 비어 있습니다" }

$q = (Resolve-Path "qa").Path
Run "3. 엑셀 만들기 (python:3.12-slim · openpyxl)" {
  docker run --rm -v "${q}:/q" -w /q python:3.12-slim sh -c "pip install -q --disable-pip-version-check --root-user-action=ignore openpyxl && python build_matrix_pc.py matrix_out"
}
Get-ChildItem $out -Filter "*.xlsx" | ForEach-Object { Write-Host "결과: $($_.FullName)" }
