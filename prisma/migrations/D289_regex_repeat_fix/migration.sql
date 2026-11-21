/* D289 (v10.558 · docs/696) DB 검사 정규식 반복 수 고침 — PostgreSQL 정규식은 {m,n} 의 n 이 255 까지만 됩니다
 *   255 를 넘으면 값을 넣는 순간 「invalid regular expression: invalid repetition count(s)」로 INSERT · UPDATE 가 통째로 실패합니다(500).
 *   빈 칸(NULL)은 검사하지 않아 지금까지 드러나지 않았습니다. 점검 9(11/21) 회귀 test_v1517 에서 찾음.
 *   ① biz_axis_items.source_url  (D054 · 운영에 있음) — 소개창업 정책 글 「출처 주소」를 넣으면 실패
 *   ② affiliate_products.image_path (D075 · 운영에 있음) — 제휴상품 사진 주소(https)를 넣으면 실패
 *   ③ prx_popups.link_url (D277) — 메인 팝업 단추 주소를 넣으면 실패
 *   뜻은 그대로입니다 — {4,500} 은 {4,250} 뒤 {0,250}, {0,300} 은 {0,250} 뒤 {0,50} 로 나눠 같은 길이를 받습니다(서버 정규식 POPUP_LINK_RE 와 같음).
 *   지금 값이 들어 있는 줄은 없습니다(넣을 수 없었음) — 다시 붙일 때 검사가 바로 끝납니다.
 *   다시 돌려도 같음(DROP CONSTRAINT IF EXISTS 뒤 ADD) · INV-9 · INV-11 감시 낱말 칸 없음 · 주석 안에 별표 빗금 없음 */

ALTER TABLE public.biz_axis_items DROP CONSTRAINT IF EXISTS biz_axis_items_source_url_check;
ALTER TABLE public.biz_axis_items ADD CONSTRAINT biz_axis_items_source_url_check
  CHECK (source_url IS NULL OR source_url ~ '^https://[^\s]{4,250}[^\s]{0,250}$');

ALTER TABLE public.affiliate_products DROP CONSTRAINT IF EXISTS affiliate_products_image_path_check;
ALTER TABLE public.affiliate_products ADD CONSTRAINT affiliate_products_image_path_check
  CHECK (image_path IS NULL OR image_path ~ '^(/[A-Za-z0-9._/-]{1,200}|https://[A-Za-z0-9.-]+/[A-Za-z0-9._/%?=&-]{0,250}[A-Za-z0-9._/%?=&-]{0,50})$');

ALTER TABLE public.prx_popups DROP CONSTRAINT IF EXISTS prx_popups_link_url_check;
ALTER TABLE public.prx_popups ADD CONSTRAINT prx_popups_link_url_check
  CHECK (link_url IS NULL OR link_url ~ '^(/[A-Za-z0-9/_?=&#.-]{0,250}[A-Za-z0-9/_?=&#.-]{0,50}|https://[A-Za-z0-9.-]{3,100}(/[A-Za-z0-9/_?=&#.%-]{0,250}[A-Za-z0-9/_?=&#.%-]{0,50})?)$');
