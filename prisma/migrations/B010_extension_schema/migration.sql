-- =====================================================================
-- B010_extension_schema
--
-- 확장과 스키마. 다른 모든 것의 전제입니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS audit;

CREATE SCHEMA IF NOT EXISTS pii;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
