-- =====================================================================
-- B080_views
--
-- 뷰 34개. 조회 경로와 회귀 감시(INV-9 · INV-11 · 미아 참조 · 문구 충돌)를 포함합니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE VIEW public.v_ad_advertiser_stats AS
 SELECT a.id,
    a.code,
    a.name,
    a.status,
    count(DISTINCT b.id) AS bookings,
    count(DISTINCT i.id) AS invoices,
    COALESCE(sum(i.total), (0)::numeric) AS billed,
    COALESCE(sum(i.paid_amount), (0)::numeric) AS collected,
    (COALESCE(sum(i.total), (0)::numeric) - COALESCE(sum(i.paid_amount), (0)::numeric)) AS unpaid
   FROM ((public.advertisers a
     LEFT JOIN public.ad_bookings b ON ((b.advertiser_id = a.id)))
     LEFT JOIN public.ad_invoices i ON (((i.advertiser_id = a.id) AND (i.status <> 'VOID'::text))))
  GROUP BY a.id, a.code, a.name, a.status;

CREATE VIEW public.v_ad_attr_orphan AS
 SELECT id,
    code,
    ad_creative_code,
    occurred_at
   FROM public.attribution_events
  WHERE ((source = 'AD'::text) AND (ad_advertiser_biz_id IS NULL));

CREATE VIEW public.v_ad_attribution_on AS
 SELECT creative_code,
    advertiser,
    slot_code,
    status,
    advertiser_business_id,
    ( SELECT count(*) AS count
           FROM public.attribution_events e
          WHERE (e.ad_creative_code = p.creative_code)) AS attributed
   FROM public.ad_placements p
  WHERE attribution_enabled
  ORDER BY creative_code;

CREATE VIEW public.v_ad_waitlist_monthly AS
 SELECT (date_trunc('month'::text, created_at))::date AS month,
    slot_code,
    count(DISTINCT advertiser_id) AS advertisers
   FROM public.ad_waitlist
  WHERE (expires_at > now())
  GROUP BY ((date_trunc('month'::text, created_at))::date), slot_code;

CREATE VIEW public.v_ad_auction_ready AS
 WITH m AS (
         SELECT v_ad_waitlist_monthly.month,
            v_ad_waitlist_monthly.slot_code,
            v_ad_waitlist_monthly.advertisers,
            lag(v_ad_waitlist_monthly.advertisers, 1) OVER (PARTITION BY v_ad_waitlist_monthly.slot_code ORDER BY v_ad_waitlist_monthly.month) AS prev1,
            lag(v_ad_waitlist_monthly.advertisers, 2) OVER (PARTITION BY v_ad_waitlist_monthly.slot_code ORDER BY v_ad_waitlist_monthly.month) AS prev2
           FROM public.v_ad_waitlist_monthly
        )
 SELECT slot_code,
    month,
    ((advertisers >= 3) AND (prev1 >= 3) AND (prev2 >= 3)) AS t1_met
   FROM m
  WHERE (month = (date_trunc('month'::text, now()))::date);

CREATE VIEW public.v_ad_capacity AS
 SELECT code AS slot,
    name AS slot_name,
        CASE code
            WHEN 'HERO'::text THEN '메인 방문마다 1회'::text
            WHEN 'ENTRY'::text THEN '하루 1회 · 닫으면 소진'::text
            WHEN 'FLOAT'::text THEN '세션당 1회 · 닫으면 소진'::text
            WHEN 'RECS'::text THEN '추천 목록을 본 사람만'::text
            WHEN 'INFEED'::text THEN '목록 8건마다 · 스크롤할수록 늘어남'::text
            WHEN 'GHERO'::text THEN '관을 옮길 때마다'::text
            WHEN 'DTAIL'::text THEN '상세를 끝까지 본 사람만'::text
            ELSE NULL::text
        END AS basis,
        CASE code
            WHEN 'INFEED'::text THEN 'HIGH'::text
            WHEN 'HERO'::text THEN 'MID'::text
            WHEN 'GHERO'::text THEN 'MID'::text
            WHEN 'ENTRY'::text THEN 'MID'::text
            WHEN 'FLOAT'::text THEN 'MID'::text
            WHEN 'DTAIL'::text THEN 'LOW'::text
            WHEN 'RECS'::text THEN 'LOW'::text
            ELSE NULL::text
        END AS volume
   FROM public.ad_slots s
  WHERE is_active
  ORDER BY code;

CREATE VIEW public.v_ad_demo AS
 SELECT creative_code,
    slot_code,
    advertiser,
    impressions,
    clicks,
    round(((100.0 * (clicks)::numeric) / (NULLIF(impressions, 0))::numeric), 2) AS ctr_pct
   FROM public.ad_placements
  WHERE (advertiser ~~ '%(데모)%'::text)
  ORDER BY slot_code, creative_code;

CREATE VIEW public.v_ad_expiring AS
 SELECT creative_code,
    slot_code,
    advertiser,
    ends_at,
    ((ends_at)::date - CURRENT_DATE) AS days_left
   FROM public.ad_placements
  WHERE ((status = 'ACTIVE'::text) AND (ends_at IS NOT NULL) AND (((ends_at)::date >= CURRENT_DATE) AND ((ends_at)::date <= (CURRENT_DATE + 7))))
  ORDER BY ends_at;

CREATE VIEW public.v_ad_inventory AS
 SELECT code,
    name,
    is_active,
    ( SELECT count(*) AS count
           FROM public.ad_bookings b
          WHERE ((b.slot_code = s.code) AND (b.period @> CURRENT_DATE))) AS booked_now,
    ( SELECT count(*) AS count
           FROM public.ad_products p
          WHERE (p.slot_code = s.code)) AS products
   FROM public.ad_slots s
  WHERE is_active
  ORDER BY code;

CREATE VIEW public.v_ad_no_product AS
 SELECT code,
    name
   FROM public.ad_slots s
  WHERE (is_active AND (NOT (EXISTS ( SELECT 1
           FROM public.ad_products p
          WHERE ((p.slot_code = s.code) AND p.is_active)))));

CREATE VIEW public.v_ad_no_slot AS
 SELECT creative_code,
    advertiser,
    status,
    is_regulated
   FROM public.ad_placements
  WHERE ((status = 'ACTIVE'::text) AND (slot_code IS NULL));

CREATE VIEW public.v_ad_only_industries AS
 SELECT code,
    name,
    gwan_code,
    legal_basis,
    '광고 가능 · 소개 불가'::text AS status
   FROM public.restricted_industries
  WHERE (is_active AND (mode = 'AD_ONLY'::text))
  ORDER BY code, gwan_code;

CREATE VIEW public.v_ad_only_leak AS
 SELECT code,
    gwan_code
   FROM public.restricted_industries r
  WHERE (is_active AND (mode = 'AD_ONLY'::text) AND (NOT public.fn_is_intro_blocked(code, COALESCE(gwan_code, 'MNY'::text))));

CREATE VIEW public.v_ad_overdue_running AS
 SELECT p.creative_code,
    a.name AS advertiser,
    i.invoice_no,
    (i.total - COALESCE(i.paid_amount, (0)::bigint)) AS unpaid,
    (CURRENT_DATE - i.due_date) AS overdue_days
   FROM (((public.ad_invoices i
     JOIN public.advertisers a ON ((a.id = i.advertiser_id)))
     JOIN public.ad_bookings b ON ((b.id = i.booking_id)))
     JOIN public.ad_placements p ON ((p.creative_code = b.creative_code)))
  WHERE ((i.status = ANY (ARRAY['ISSUED'::text, 'PARTIAL'::text, 'OVERDUE'::text])) AND (i.due_date < CURRENT_DATE) AND (p.status = 'ACTIVE'::text));

CREATE VIEW public.v_ad_platform AS
 SELECT code AS slot,
    name AS slot_name,
    placement,
    is_active,
    in_ranking,
    ( SELECT count(*) AS count
           FROM public.ad_products p
          WHERE ((p.slot_code = s.code) AND p.is_active)) AS products,
    ( SELECT bool_or(p.is_intro_price) AS bool_or
           FROM public.ad_products p
          WHERE (p.slot_code = s.code)) AS intro_price,
    ( SELECT count(*) AS count
           FROM public.ad_placements c
          WHERE ((c.slot_code = s.code) AND (c.status = 'ACTIVE'::text) AND ((c.starts_at IS NULL) OR (c.starts_at <= CURRENT_DATE)) AND ((c.ends_at IS NULL) OR (c.ends_at >= CURRENT_DATE)))) AS live_creatives,
    ( SELECT count(*) AS count
           FROM public.ad_bookings b
          WHERE ((b.slot_code = s.code) AND (b.period @> CURRENT_DATE))) AS booked,
    ( SELECT COALESCE(sum(c.impressions), (0)::numeric) AS "coalesce"
           FROM public.ad_placements c
          WHERE (c.slot_code = s.code)) AS impressions,
    ( SELECT COALESCE(sum(c.clicks), (0)::numeric) AS "coalesce"
           FROM public.ad_placements c
          WHERE (c.slot_code = s.code)) AS clicks,
    ( SELECT round(((100.0 * sum(c.clicks)) / NULLIF(sum(c.impressions), (0)::numeric)), 2) AS round
           FROM public.ad_placements c
          WHERE (c.slot_code = s.code)) AS ctr_pct,
    ( SELECT count(*) AS count
           FROM public.ad_placements c
          WHERE ((c.slot_code = s.code) AND (c.advertiser ~~ '%(데모)%'::text))) AS demo_creatives
   FROM public.ad_slots s
  ORDER BY code;

CREATE VIEW public.v_ad_privacy_leak AS
 SELECT column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name = 'v_ad_stats_for_advertiser'::name) AND ((column_name)::name ~ 'account|member|email|phone|segment'::text));

CREATE VIEW public.v_ad_receivables AS
 SELECT i.id,
    i.invoice_no,
    a.name AS advertiser,
    a.contact_phone,
    i.total,
    COALESCE(i.paid_amount, (0)::bigint) AS paid,
    (i.total - COALESCE(i.paid_amount, (0)::bigint)) AS unpaid,
    i.due_date,
    (CURRENT_DATE - i.due_date) AS overdue_days,
    i.status
   FROM (public.ad_invoices i
     JOIN public.advertisers a ON ((a.id = i.advertiser_id)))
  WHERE ((i.status = ANY (ARRAY['ISSUED'::text, 'PARTIAL'::text, 'OVERDUE'::text])) AND (i.total > COALESCE(i.paid_amount, (0)::bigint)))
  ORDER BY i.due_date;

CREATE VIEW public.v_ad_sellable_gap AS
 SELECT slot,
    slot_name,
    products,
    live_creatives,
    booked
   FROM public.v_ad_platform
  WHERE (is_active AND (((products > 0) AND (live_creatives = 0)) OR ((booked > 0) AND (live_creatives = 0))));

CREATE VIEW public.v_ad_serving AS
SELECT
    NULL::uuid AS id,
    NULL::text AS creative_code,
    NULL::text AS advertiser,
    NULL::text AS title,
    NULL::text AS body,
    NULL::text AS cta,
    NULL::text AS landing_route,
    NULL::text AS slot_code,
    NULL::text AS category,
    NULL::text[] AS segments;

CREATE VIEW public.v_ad_settlement_hold AS
 SELECT id,
    slot_code,
    advertiser_id,
    amount,
    expected_impressions,
    actual_impressions,
    round(((100.0 * (COALESCE(actual_impressions, 0))::numeric) / (NULLIF(expected_impressions, 0))::numeric), 1) AS ratio_pct
   FROM public.ad_bookings b
  WHERE ((status = 'CONFIRMED'::text) AND (upper(period) < CURRENT_DATE) AND ((COALESCE(actual_impressions, 0))::numeric < ((COALESCE(expected_impressions, 0))::numeric * 0.5)));

CREATE VIEW public.v_ad_slot_conflict AS
 SELECT b1.slot_code AS slot_a,
    b2.slot_code AS slot_b,
    b1.period
   FROM (public.ad_bookings b1
     JOIN public.ad_bookings b2 ON (((b1.period && b2.period) AND (b1.id < b2.id))))
  WHERE ((b1.slot_code = 'ENTRY'::text) AND (b2.slot_code = 'FLOAT'::text));

CREATE VIEW public.v_ad_slot_empty AS
 SELECT code,
    name
   FROM public.ad_slots s
  WHERE (is_active AND (NOT (EXISTS ( SELECT 1
           FROM public.ad_placements p
          WHERE ((p.slot_code = s.code) AND (p.status = 'ACTIVE'::text) AND ((p.starts_at IS NULL) OR (p.starts_at <= CURRENT_DATE)) AND ((p.ends_at IS NULL) OR (p.ends_at >= CURRENT_DATE)))))));

CREATE VIEW public.v_ad_stats_for_advertiser AS
 SELECT c.creative_code,
    c.advertiser,
    c.slot_code,
    count(*) FILTER (WHERE (e.event_type = 'IMPRESSION'::text)) AS impressions,
    count(*) FILTER (WHERE (e.event_type = 'CLICK'::text)) AS clicks,
    round(((100.0 * (count(*) FILTER (WHERE (e.event_type = 'CLICK'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (e.event_type = 'IMPRESSION'::text)), 0))::numeric), 2) AS ctr
   FROM (public.ad_placements c
     LEFT JOIN public.ad_events e ON ((e.creative_id = c.id)))
  GROUP BY c.creative_code, c.advertiser, c.slot_code;

CREATE VIEW public.v_address_detail_leak AS
 SELECT table_name,
    column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name ~~ 'v_%'::text) AND ((column_name)::name = 'address_detail'::name));

CREATE VIEW public.v_ai_client_scored AS
 SELECT id,
    partner_id,
    lead_id,
    delivered_at
   FROM public.lead_deliveries d
  WHERE ((delivered_at > (now() - '30 days'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.fn_match_candidates(d.lead_id, 50) c(partner_id, company, total, parts)
          WHERE (c.partner_id = d.partner_id)))));

CREATE VIEW public.v_ai_decision_stats AS
 SELECT kind,
    count(*) AS total,
    count(DISTINCT rule_version) AS versions,
    max(decided_at) AS last_at
   FROM public.ai_decisions
  GROUP BY kind;

CREATE VIEW public.v_ai_match_fee_violation AS
 SELECT id,
    match_source,
    agreed_fee,
    introducer_account_id
   FROM public.deals
  WHERE ((match_source = 'AI_DIRECT'::text) AND ((COALESCE(agreed_fee, (0)::numeric) > (0)::numeric) OR (introducer_account_id IS NOT NULL)));

CREATE VIEW public.v_assumed_on AS
 SELECT key,
    value,
    description
   FROM public.site_settings
  WHERE ((key ~~ 'assume.%'::text) AND (value = 'on'::text));

CREATE VIEW public.v_attribution_channels AS
 SELECT channel,
    count(*) AS events,
    count(DISTINCT code) AS codes,
    count(DISTINCT visitor_key) AS visitors
   FROM public.attribution_events
  GROUP BY channel;

CREATE VIEW public.v_attribution_health AS
 SELECT (date_trunc('month'::text, created_at))::date AS month,
    count(*) AS deals,
    count(*) FILTER (WHERE (attributed_event_id IS NOT NULL)) AS attributed,
    round((((count(*) FILTER (WHERE (attributed_event_id IS NOT NULL)))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 1) AS attribution_rate_pct,
    count(*) FILTER (WHERE ((introducer_account_id IS NOT NULL) AND (attributed_event_id IS NULL))) AS unresolved
   FROM public.deals d
  GROUP BY ((date_trunc('month'::text, created_at))::date)
  ORDER BY ((date_trunc('month'::text, created_at))::date);

CREATE VIEW public.v_audit_admin_burst AS
 WITH t AS (
         SELECT audit_thresholds.threshold,
            audit_thresholds.window_hrs
           FROM public.audit_thresholds
          WHERE ((audit_thresholds.code = 'ADMIN_BURST'::text) AND audit_thresholds.is_active)
        )
 SELECT l.actor_account_id,
    a.name,
    l.actor_role,
    count(*) AS actions,
    count(DISTINCT l.action) AS kinds,
    max(l.occurred_at) AS last_at,
    ( SELECT t.threshold
           FROM t) AS threshold
   FROM (audit.audit_logs l
     LEFT JOIN public.accounts a ON ((a.id = l.actor_account_id)))
  WHERE ((l.occurred_at > (now() - ((( SELECT t.window_hrs
           FROM t) || ' hours'::text))::interval)) AND (l.action !~~ '%TEST%'::text))
  GROUP BY l.actor_account_id, a.name, l.actor_role
 HAVING (count(*) > ( SELECT t.threshold
           FROM t));

CREATE VIEW public.v_audit_admin_night AS
 WITH t AS (
         SELECT audit_thresholds.threshold,
            audit_thresholds.window_hrs
           FROM public.audit_thresholds
          WHERE ((audit_thresholds.code = 'ADMIN_NIGHT'::text) AND audit_thresholds.is_active)
        )
 SELECT l.actor_account_id,
    a.name,
    count(*) AS actions,
    string_agg(DISTINCT l.action, ', '::text) AS kinds,
    max(l.occurred_at) AS last_at,
    ( SELECT t.threshold
           FROM t) AS threshold
   FROM (audit.audit_logs l
     LEFT JOIN public.accounts a ON ((a.id = l.actor_account_id)))
  WHERE ((l.occurred_at > (now() - ((( SELECT t.window_hrs
           FROM t) || ' hours'::text))::interval)) AND (l.action !~~ '%TEST%'::text) AND ((EXTRACT(hour FROM (l.occurred_at AT TIME ZONE 'Asia/Seoul'::text)) >= (22)::numeric) OR (EXTRACT(hour FROM (l.occurred_at AT TIME ZONE 'Asia/Seoul'::text)) < (7)::numeric)))
  GROUP BY l.actor_account_id, a.name
 HAVING (count(*) > ( SELECT t.threshold
           FROM t));

CREATE VIEW public.v_audit_night_access AS
 WITH t AS (
         SELECT audit_thresholds.threshold,
            audit_thresholds.window_hrs
           FROM public.audit_thresholds
          WHERE ((audit_thresholds.code = 'PII_NIGHT'::text) AND audit_thresholds.is_active)
        )
 SELECT p.actor_account_id,
    a.name,
    count(*) AS views,
    max(p.occurred_at) AS last_at,
    ( SELECT t.threshold
           FROM t) AS threshold
   FROM (audit.pii_access_logs p
     LEFT JOIN public.accounts a ON ((a.id = p.actor_account_id)))
  WHERE ((p.occurred_at > (now() - ((( SELECT t.window_hrs
           FROM t) || ' hours'::text))::interval)) AND (COALESCE(p.reason, ''::text) !~~ '%시험%'::text) AND ((EXTRACT(hour FROM (p.occurred_at AT TIME ZONE 'Asia/Seoul'::text)) >= (22)::numeric) OR (EXTRACT(hour FROM (p.occurred_at AT TIME ZONE 'Asia/Seoul'::text)) < (7)::numeric)))
  GROUP BY p.actor_account_id, a.name
 HAVING (count(*) > ( SELECT t.threshold
           FROM t));

CREATE VIEW public.v_audit_pii_burst AS
 WITH t AS (
         SELECT audit_thresholds.threshold,
            audit_thresholds.window_hrs
           FROM public.audit_thresholds
          WHERE ((audit_thresholds.code = 'PII_BURST'::text) AND audit_thresholds.is_active)
        )
 SELECT p.actor_account_id,
    a.name,
    a.email,
    count(*) AS views,
    count(DISTINCT p.target_account_id) AS targets,
    min(p.occurred_at) AS first_at,
    max(p.occurred_at) AS last_at,
    ( SELECT t.threshold
           FROM t) AS threshold
   FROM (audit.pii_access_logs p
     LEFT JOIN public.accounts a ON ((a.id = p.actor_account_id)))
  WHERE ((p.occurred_at > (now() - ((( SELECT t.window_hrs
           FROM t) || ' hours'::text))::interval)) AND (COALESCE(p.reason, ''::text) !~~ '%시험%'::text) AND (COALESCE(p.reason, ''::text) !~~ '%TEST%'::text))
  GROUP BY p.actor_account_id, a.name, a.email
 HAVING (count(*) > ( SELECT t.threshold
           FROM t));

CREATE VIEW public.v_audit_same_target AS
 WITH t AS (
         SELECT audit_thresholds.threshold,
            audit_thresholds.window_hrs
           FROM public.audit_thresholds
          WHERE ((audit_thresholds.code = 'SAME_TARGET'::text) AND audit_thresholds.is_active)
        )
 SELECT p.actor_account_id,
    a.name AS actor,
    p.target_account_id,
    b.name AS target,
    count(*) AS views,
    max(p.occurred_at) AS last_at,
    ( SELECT t.threshold
           FROM t) AS threshold
   FROM ((audit.pii_access_logs p
     LEFT JOIN public.accounts a ON ((a.id = p.actor_account_id)))
     LEFT JOIN public.accounts b ON ((b.id = p.target_account_id)))
  WHERE ((p.occurred_at > (now() - ((( SELECT t.window_hrs
           FROM t) || ' hours'::text))::interval)) AND (p.target_account_id IS NOT NULL) AND (COALESCE(p.reason, ''::text) !~~ '%시험%'::text) AND (COALESCE(p.reason, ''::text) !~~ '%TEST%'::text))
  GROUP BY p.actor_account_id, a.name, p.target_account_id, b.name
 HAVING (count(*) > ( SELECT t.threshold
           FROM t));

CREATE VIEW public.v_audit_anomalies AS
 SELECT 'PII_BURST'::text AS code,
    v_audit_pii_burst.actor_account_id,
    v_audit_pii_burst.name AS who,
    v_audit_pii_burst.views AS n,
    v_audit_pii_burst.threshold,
    v_audit_pii_burst.last_at
   FROM public.v_audit_pii_burst
UNION ALL
 SELECT 'PII_NIGHT'::text AS code,
    v_audit_night_access.actor_account_id,
    v_audit_night_access.name AS who,
    v_audit_night_access.views AS n,
    v_audit_night_access.threshold,
    v_audit_night_access.last_at
   FROM public.v_audit_night_access
UNION ALL
 SELECT 'SAME_TARGET'::text AS code,
    v_audit_same_target.actor_account_id,
    v_audit_same_target.actor AS who,
    v_audit_same_target.views AS n,
    v_audit_same_target.threshold,
    v_audit_same_target.last_at
   FROM public.v_audit_same_target
UNION ALL
 SELECT 'ADMIN_BURST'::text AS code,
    v_audit_admin_burst.actor_account_id,
    v_audit_admin_burst.name AS who,
    v_audit_admin_burst.actions AS n,
    v_audit_admin_burst.threshold,
    v_audit_admin_burst.last_at
   FROM public.v_audit_admin_burst
UNION ALL
 SELECT 'ADMIN_NIGHT'::text AS code,
    v_audit_admin_night.actor_account_id,
    v_audit_admin_night.name AS who,
    v_audit_admin_night.actions AS n,
    v_audit_admin_night.threshold,
    v_audit_admin_night.last_at
   FROM public.v_audit_admin_night;

CREATE VIEW public.v_audit_no_reason AS
 SELECT p.id,
    p.actor_account_id,
    a.name,
    p.access_type,
    p.occurred_at
   FROM (audit.pii_access_logs p
     LEFT JOIN public.accounts a ON ((a.id = p.actor_account_id)))
  WHERE ((COALESCE(btrim(p.reason), ''::text) = ''::text) AND (p.occurred_at > (now() - '30 days'::interval)));

CREATE VIEW public.v_audit_sample_queue AS
 SELECT ri.id,
    ri.target_type,
    ri.target_id,
    ri.decided_at,
    l.title,
    l.desired_fee
   FROM (public.review_items ri
     LEFT JOIN public.listings l ON ((l.id = ri.target_id)))
  WHERE (ri.audit_sampled AND (ri.decision_mode = 'AUTO'::text))
  ORDER BY ri.decided_at DESC;

CREATE VIEW public.v_auto_approved_recent AS
 SELECT l.id,
    l.title,
    l.gwan_code,
    l.created_at,
    (0)::bigint AS reports
   FROM (public.listings l
     JOIN public.review_items ri ON ((ri.target_id = l.id)))
  WHERE ((ri.decision_mode = 'AUTO'::text) AND (l.created_at > (now() - '7 days'::interval)))
  ORDER BY l.created_at DESC;

CREATE VIEW public.v_auto_approved_reported AS
 SELECT id,
    title,
    reports
   FROM public.v_auto_approved_recent
  WHERE (reports > 0);

CREATE VIEW public.v_auto_review_rate AS
 SELECT (date_trunc('day'::text, submitted_at))::date AS day,
    count(*) AS submitted,
    count(*) FILTER (WHERE (decision_mode = 'AUTO'::text)) AS auto_approved,
    count(*) FILTER (WHERE (decision_mode = 'MANUAL'::text)) AS manual_queue,
    round((((count(*) FILTER (WHERE (decision_mode = 'AUTO'::text)))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 1) AS auto_rate_pct,
    count(*) FILTER (WHERE audit_sampled) AS audit_sampled
   FROM public.review_items
  GROUP BY ((date_trunc('day'::text, submitted_at))::date)
  ORDER BY ((date_trunc('day'::text, submitted_at))::date) DESC;

CREATE VIEW public.v_b12_rollback_scope AS
 SELECT 'member_ad_profiles'::text AS target,
    (count(*))::integer AS rows
   FROM public.member_ad_profiles
UNION ALL
 SELECT 'ad_events(segment)'::text AS target,
    (count(*))::integer AS rows
   FROM public.ad_events
  WHERE (ad_events.segment_code IS NOT NULL);

CREATE VIEW public.v_badge_stats AS
 SELECT badge_type,
    status,
    count(*) AS cnt
   FROM public.listing_badges
  GROUP BY badge_type, status
  ORDER BY badge_type, status;

CREATE VIEW public.v_bank_assumed AS
 SELECT ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'company.bank_name'::text)) AS bank,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'company.bank_account'::text)) AS account,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'company.bank_holder'::text)) AS holder,
    ( SELECT (site_settings.value = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key = 'assume.bank'::text)) AS assumed
  WHERE (( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'assume.bank'::text)) = 'on'::text);

CREATE VIEW public.v_banned_word_wildcards AS
 SELECT id,
    word,
    match_type
   FROM public.banned_words
  WHERE (is_active AND (match_type = 'CONTAINS'::text) AND ((word ~~ like_escape('%\%%'::text, '\'::text)) OR (word ~~ like_escape('%\_%'::text, '\'::text))));

CREATE VIEW public.v_billing_after_cancel AS
 SELECT i.id AS invoice_id,
    i.subscription_id,
    i.period_start,
    s.cancel_at
   FROM (public.subscription_invoices i
     JOIN public.subscriptions s ON ((s.id = i.subscription_id)))
  WHERE ((s.cancel_at IS NOT NULL) AND (i.period_start >= s.cancel_at) AND (i.status = ANY (ARRAY['PENDING'::text, 'PAID'::text])));

CREATE VIEW public.v_billing_attempts_today AS
 SELECT subscription_id,
    count(*) AS tries,
    count(*) FILTER (WHERE (result = 'PAID'::text)) AS paid,
    count(*) FILTER (WHERE (result = 'RETRYABLE'::text)) AS retryable,
    count(*) FILTER (WHERE (result = 'TERMINAL'::text)) AS terminal,
    max(attempted_at) AS last_attempt,
    (array_agg(detail ORDER BY attempted_at DESC))[1] AS last_detail
   FROM public.billing_attempts a
  WHERE (attempted_at >= date_trunc('day'::text, now()))
  GROUP BY subscription_id;

CREATE VIEW public.v_billing_due AS
 WITH today AS (
         SELECT a.subscription_id,
            count(*) AS tries,
            bool_or((a.result = 'TERMINAL'::text)) AS had_terminal
           FROM public.billing_attempts a
          WHERE (a.attempted_at >= date_trunc('day'::text, now()))
          GROUP BY a.subscription_id
        )
 SELECT s.id AS subscription_id,
    s.account_id,
    s.plan_code,
    p.name AS plan_name,
    p.monthly_price AS amount,
    s.current_period_end AS due_at,
    s.current_period_end AS next_period_start,
    (s.current_period_end + '30 days'::interval) AS next_period_end,
    b.id AS billing_key_id,
    s.status,
    COALESCE(t.tries, (0)::bigint) AS tries_today,
        CASE
            WHEN COALESCE(t.had_terminal, false) THEN public.fn_setting_int('billing.terminal_retry_per_day'::text, 1)
            ELSE public.fn_setting_int('billing.retry_per_day'::text, 10)
        END AS retry_cap
   FROM (((public.subscriptions s
     JOIN public.subscription_plans p ON ((p.code = s.plan_code)))
     LEFT JOIN public.billing_keys b ON (((b.account_id = s.account_id) AND (b.status = 'ACTIVE'::text))))
     LEFT JOIN today t ON ((t.subscription_id = s.id)))
  WHERE ((s.status = ANY (ARRAY['ACTIVE'::text, 'PAST_DUE'::text])) AND (s.current_period_end <= now()) AND (p.monthly_price > (0)::numeric) AND (s.cancel_at IS NULL) AND ((s.promo_ends_at IS NULL) OR (s.promo_ends_at <= now())) AND (NOT (EXISTS ( SELECT 1
           FROM public.subscription_invoices i
          WHERE ((i.subscription_id = s.id) AND (i.period_start = s.current_period_end) AND (i.status = ANY (ARRAY['PENDING'::text, 'PAID'::text])))))) AND (COALESCE(t.tries, (0)::bigint) <
        CASE
            WHEN COALESCE(t.had_terminal, false) THEN public.fn_setting_int('billing.terminal_retry_per_day'::text, 1)
            ELSE public.fn_setting_int('billing.retry_per_day'::text, 10)
        END));

CREATE VIEW public.v_billing_duplicates AS
 SELECT subscription_id,
    period_start,
    count(*) AS n
   FROM public.subscription_invoices
  WHERE (status = ANY (ARRAY['PENDING'::text, 'PAID'::text]))
  GROUP BY subscription_id, period_start
 HAVING (count(*) > 1);

CREATE VIEW public.v_billing_key_exposure AS
 SELECT table_name,
    column_name
   FROM information_schema.columns c
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name ~~ 'v_%'::text) AND ((column_name)::name = 'billing_key'::name));

CREATE VIEW public.v_billing_notice_missing AS
 SELECT id AS subscription_id,
    account_id,
    plan_code,
    current_period_end AS due_at,
    ( SELECT max(a.attempted_at) AS max
           FROM public.billing_attempts a
          WHERE ((a.subscription_id = s.id) AND (a.result <> 'PAID'::text))) AS last_failure
   FROM public.subscriptions s
  WHERE ((status = 'PAST_DUE'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.notifications n
          WHERE ((n.account_id = s.account_id) AND (n.template_code ~~ 'SUBSCRIPTION_%'::text) AND (n.created_at >= (now() - '7 days'::interval)))))));

CREATE VIEW public.v_billing_policy AS
 SELECT 'billing.grace_days'::text AS key,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'billing.grace_days'::text)) AS stored,
    public.fn_setting_int('billing.grace_days'::text, 7) AS effective,
    '유예 일수 — 첫 실패 시점부터'::text AS meaning
UNION ALL
 SELECT 'billing.retry_per_day'::text AS key,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'billing.retry_per_day'::text)) AS stored,
    public.fn_setting_int('billing.retry_per_day'::text, 10) AS effective,
    '재시도 가능한 실패의 하루 한도'::text AS meaning
UNION ALL
 SELECT 'billing.terminal_retry_per_day'::text AS key,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'billing.terminal_retry_per_day'::text)) AS stored,
    public.fn_setting_int('billing.terminal_retry_per_day'::text, 1) AS effective,
    '카드 교체가 필요한 실패의 하루 한도'::text AS meaning;

CREATE VIEW public.v_billing_policy_mismatch AS
 SELECT key,
    stored,
    effective
   FROM public.v_billing_policy
  WHERE (stored IS DISTINCT FROM (effective)::text);

CREATE VIEW public.v_billing_retry_overrun AS
 SELECT subscription_id,
    tries,
    public.fn_setting_int('billing.retry_per_day'::text, 10) AS cap
   FROM public.v_billing_attempts_today
  WHERE (tries > public.fn_setting_int('billing.retry_per_day'::text, 10));

CREATE VIEW public.v_broker_commission_leak AS
 SELECT table_name,
    column_name,
    '소개형 4관은 공제 0원입니다(INV-9) — 이 컬럼을 두면 안 됩니다'::text AS note
   FROM information_schema.columns c
  WHERE (((table_schema)::name = 'public'::name) AND ((column_name)::name ~ 'deduct|commission|platform_fee|withhold|take_rate'::text) AND ((table_name)::name !~ '^(hlt_|v_hlt_)'::text));

CREATE VIEW public.v_broker_gate_leak AS
 SELECT id,
    title,
    owner_account_id,
    status
   FROM public.listings l
  WHERE ((gwan_code = 'MAL'::text) AND (NOT public.fn_is_verified_broker(owner_account_id)) AND (NOT (EXISTS ( SELECT 1
           FROM public.owner_verifications o
          WHERE ((o.listing_id = l.id) AND (o.state = 'VERIFIED'::text))))));

CREATE VIEW public.v_broker_pending AS
 SELECT v.id,
    b.company_name AS company,
    v.license_no,
    v.office_name,
    v.lookup_result,
    v.state,
    v.created_at
   FROM (public.broker_verifications v
     JOIN public.businesses b ON ((b.id = v.business_id)))
  WHERE (v.state = ANY (ARRAY['SUBMITTED'::text, 'PENDING'::text]))
  ORDER BY v.created_at;

CREATE VIEW public.v_broker_recheck_due AS
 SELECT v.id,
    b.company_name AS company,
    v.license_no,
    v.recheck_due
   FROM (public.broker_verifications v
     JOIN public.businesses b ON ((b.id = v.business_id)))
  WHERE ((v.state = 'VERIFIED'::text) AND (v.recheck_due < CURRENT_DATE));

CREATE VIEW public.v_business_region AS
 SELECT id AS business_id,
    account_id,
    sido,
    sigungu,
    ((sido || ' '::text) || sigungu) AS region_label
   FROM public.businesses b
  WHERE ((sido IS NOT NULL) AND (sigungu IS NOT NULL));

CREATE VIEW public.v_partner_eligible AS
 SELECT p.id AS partner_id,
    p.grade,
    p.unpaid_cap,
    COALESCE(sum(f.amount) FILTER (WHERE (f.state = 'PENDING'::text)), (0)::numeric) AS unpaid,
    (COALESCE(sum(f.amount) FILTER (WHERE (f.state = 'PENDING'::text)), (0)::numeric) < p.unpaid_cap) AS can_receive
   FROM (public.partners p
     LEFT JOIN public.lead_fees f ON ((f.partner_id = p.id)))
  WHERE ((p.status = 'ACTIVE'::text) AND (EXISTS ( SELECT 1
           FROM public.partner_services s
          WHERE ((s.partner_id = p.id) AND (s.status = 'APPROVED'::text)))) AND (EXISTS ( SELECT 1
           FROM public.partner_regions r
          WHERE (r.partner_id = p.id))))
  GROUP BY p.id, p.grade, p.unpaid_cap;

CREATE VIEW public.v_business_signals AS
 SELECT '검수 대기 24시간 초과'::text AS signal,
    ( SELECT count(*) AS count
           FROM public.review_items
          WHERE ((review_items.status = 'QUEUED'::text) AND (review_items.sla_due_at < now()))) AS value,
    'SLA 위반 — 등록자가 기다립니다'::text AS meaning
UNION ALL
 SELECT '응답 없는 요청 (7일)'::text AS signal,
    ( SELECT count(*) AS count
           FROM public.requests r
          WHERE ((r.status = 'PUBLISHED'::text) AND (r.created_at < (now() - '7 days'::interval)) AND (NOT (EXISTS ( SELECT 1
                   FROM public.introducer_responses x
                  WHERE (x.request_id = r.id)))))) AS value,
    '소개자가 없거나 매칭이 안 맞습니다'::text AS meaning
UNION ALL
 SELECT '동의 없이 만료된 초대 (30일)'::text AS signal,
    ( SELECT count(*) AS count
           FROM public.introduction_invites
          WHERE ((introduction_invites.state = ANY (ARRAY['EXPIRED'::text, 'DECLINED'::text])) AND (introduction_invites.created_at >= (now() - '30 days'::interval)))) AS value,
    '초대 문구나 대상 선정을 봐야 합니다'::text AS meaning
UNION ALL
 SELECT '결제 실패 미해결'::text AS signal,
    ( SELECT count(*) AS count
           FROM public.subscriptions s
          WHERE (s.status = 'PAST_DUE'::text)) AS value,
    '유예가 지나면 구독이 만료됩니다'::text AS meaning
UNION ALL
 SELECT '미청구 이용료 한도 초과 파트너'::text AS signal,
    ( SELECT count(*) AS count
           FROM public.v_partner_eligible
          WHERE (NOT v_partner_eligible.can_receive)) AS value,
    '리드가 가지 않아 매출이 멈춥니다'::text AS meaning;

CREATE VIEW public.v_card_columns AS
 SELECT table_name,
    column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((column_name)::name ~* 'card_?(no|num|pan)|cvc|cvv|expiry|exp_date'::text));

CREATE VIEW public.v_checklist_for_gwan AS
 SELECT g.code AS gwan_code,
    c.code,
    c.label,
    c.is_required,
    c.check_sql,
    c.fail_message,
    c.sort_order,
    (c.gwan_code IS NOT NULL) AS is_gwan_specific
   FROM (public.gwans g
     JOIN public.listing_checklist c ON (((c.gwan_code IS NULL) OR (c.gwan_code = g.code))))
  WHERE g.is_active
  ORDER BY g.code, c.sort_order;

CREATE VIEW public.v_classify_accuracy AS
 SELECT count(*) AS total,
    count(*) FILTER (WHERE unclassified) AS missed,
    count(*) FILTER (WHERE ((chosen IS NOT NULL) AND (chosen = suggested))) AS matched,
    count(*) FILTER (WHERE ((chosen IS NOT NULL) AND (chosen IS DISTINCT FROM suggested))) AS corrected,
    round(((100.0 * (count(*) FILTER (WHERE ((chosen IS NOT NULL) AND (chosen = suggested))))::numeric) / (NULLIF(count(*) FILTER (WHERE (chosen IS NOT NULL)), 0))::numeric), 1) AS accuracy_pct
   FROM public.classify_logs
  WHERE (created_at >= (now() - '30 days'::interval));

CREATE VIEW public.v_classify_corrections AS
 SELECT suggested,
    chosen,
    count(*) AS n,
    (array_agg("left"(input_text, 60) ORDER BY created_at DESC))[1:3] AS samples
   FROM public.classify_logs
  WHERE ((chosen IS NOT NULL) AND (chosen IS DISTINCT FROM suggested) AND (created_at >= (now() - '30 days'::interval)))
  GROUP BY suggested, chosen
  ORDER BY (count(*)) DESC;

CREATE VIEW public.v_classify_misses AS
 SELECT "left"(input_text, 80) AS input_text,
    created_at
   FROM public.classify_logs
  WHERE (unclassified AND (created_at >= (now() - '30 days'::interval)))
  ORDER BY created_at DESC;

CREATE VIEW public.v_classify_unlinked AS
 SELECT code,
    name,
    gwan_code
   FROM public.classify_categories c
  WHERE (is_active AND (category_id IS NULL));

CREATE VIEW public.v_classify_vocab_conflicts AS
 SELECT term,
    count(*) AS in_categories,
    array_agg(category_code ORDER BY weight DESC) AS categories,
    array_agg(weight ORDER BY weight DESC) AS weights
   FROM public.classify_vocab
  GROUP BY term
 HAVING ((count(*) > 1) AND (count(DISTINCT weight) = 1));

CREATE VIEW public.v_classify_vocab_wildcards AS
 SELECT category_code,
    term
   FROM public.classify_vocab
  WHERE ((term ~~ like_escape('%\%%'::text, '\'::text)) OR (term ~~ like_escape('%\_%'::text, '\'::text)));

CREATE VIEW public.v_code_coverage AS
 WITH allowed AS (
         SELECT t.domain,
            t.code
           FROM ( SELECT 'listing.status'::text AS domain,
                    unnest(ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text, 'REJECTED'::text, 'SUSPENDED'::text, 'ARCHIVED'::text]) AS code
                UNION ALL
                 SELECT 'deal.status'::text AS text,
                    unnest(ARRAY['INQUIRY'::text, 'NEGOTIATING'::text, 'CONTRACTED'::text, 'PAYMENT_REPORTED'::text, 'CONFIRMED'::text, 'SETTLED'::text, 'DISPUTED'::text, 'CANCELLED'::text]) AS unnest
                UNION ALL
                 SELECT 'settlement.status'::text AS text,
                    unnest(ARRAY['REQUESTED'::text, 'PAID'::text, 'HELD'::text, 'REJECTED'::text]) AS unnest
                UNION ALL
                 SELECT 'success_fee.status'::text AS text,
                    unnest(ARRAY['BILLED'::text, 'PAID'::text, 'WAIVED'::text, 'CANCELLED'::text]) AS unnest
                UNION ALL
                 SELECT 'subscription.status'::text AS text,
                    unnest(ARRAY['ACTIVE'::text, 'PAST_DUE'::text, 'CANCELLED'::text, 'EXPIRED'::text]) AS unnest
                UNION ALL
                 SELECT 'request.status'::text AS text,
                    unnest(ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text, 'REJECTED'::text, 'CLOSED'::text, 'ARCHIVED'::text]) AS unnest
                UNION ALL
                 SELECT 'badge.status'::text AS text,
                    unnest(ARRAY['REQUESTED'::text, 'IN_REVIEW'::text, 'GRANTED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'REVOKED'::text]) AS unnest
                UNION ALL
                 SELECT 'badge.type'::text AS text,
                    unnest(ARRAY['URGENT'::text, 'VERIFIED_DOC'::text]) AS unnest
                UNION ALL
                 SELECT 'review.status'::text AS text,
                    unnest(ARRAY['QUEUED'::text, 'IN_PROGRESS'::text, 'APPROVED'::text, 'REJECTED'::text]) AS unnest
                UNION ALL
                 SELECT 'dispute.status'::text AS text,
                    unnest(ARRAY['OPEN'::text, 'IN_REVIEW'::text, 'RESOLVED'::text, 'REJECTED'::text]) AS unnest) t
        )
 SELECT a.domain,
    a.code,
    (l.code IS NOT NULL) AS has_label
   FROM (allowed a
     LEFT JOIN public.code_labels l ON (((l.domain = a.domain) AND (l.code = a.code))));

CREATE VIEW public.v_code_missing_labels AS
 SELECT domain,
    code,
    has_label
   FROM public.v_code_coverage
  WHERE (NOT has_label);

CREATE VIEW public.v_collect_gate_status AS
 SELECT id,
    code,
    name,
    state,
    (robots_at IS NOT NULL) AS robots_ok,
    (legal_at IS NOT NULL) AS legal_ok,
    interval_ms,
    last_run_at,
        CASE
            WHEN (robots_at IS NULL) THEN 'robots 확인이 필요합니다'::text
            WHEN (legal_at IS NULL) THEN '법무 회신이 필요합니다'::text
            ELSE NULL::text
        END AS blocker
   FROM public.collect_sources s;

CREATE VIEW public.v_collect_match_rate AS
 SELECT s.code,
    s.name,
    count(i.id) AS items,
    COALESCE(sum(i.matched_count), (0)::bigint) AS matched,
    COALESCE(sum(array_length(i.unmatched, 1)), (0)::bigint) AS unmatched,
    max(f.ended_at) AS last_done
   FROM ((public.collect_sources s
     LEFT JOIN public.collect_fetches f ON ((f.source_id = s.id)))
     LEFT JOIN public.collect_items i ON ((i.fetch_id = f.id)))
  GROUP BY s.code, s.name;

CREATE VIEW public.v_collect_stuck AS
 SELECT f.id,
    s.code,
    s.name,
    f.started_at,
    (EXTRACT(epoch FROM (now() - f.started_at)) / (60)::numeric) AS running_min
   FROM (public.collect_fetches f
     JOIN public.collect_sources s ON ((s.id = f.source_id)))
  WHERE ((f.status = 'RUNNING'::text) AND (f.started_at < (now() - '02:00:00'::interval)));

CREATE VIEW public.v_company_account AS
 SELECT ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'company.bank_name'::text)) AS bank,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'company.bank_account'::text)) AS account,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'company.bank_holder'::text)) AS holder,
    ( SELECT count(*) AS count
           FROM public.site_settings
          WHERE ((site_settings.key ~~ 'company.bank%'::text) AND (COALESCE(btrim(site_settings.value), ''::text) = ''::text))) AS missing;

CREATE VIEW public.v_connection_without_consent AS
 SELECT c.id AS connection_id,
    i.state
   FROM (public.introduction_connections c
     JOIN public.introduction_invites i ON ((i.id = c.invite_id)))
  WHERE (i.state <> 'CONSENTED'::text);

CREATE VIEW public.v_content_missing AS
 SELECT 'FAQ'::text AS kind,
    '활성 FAQ 없음'::text AS item,
    '고객센터가 비어 보입니다'::text AS reason
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.faqs
          WHERE faqs.is_active)))
UNION ALL
 SELECT 'FORM_COPY'::text AS kind,
    (g.code || ' 등록 폼 문구 없음'::text) AS item,
    '등록 화면이 비어 보입니다'::text AS reason
   FROM public.gwans g
  WHERE (g.is_active AND (NOT (EXISTS ( SELECT 1
           FROM public.gwan_form_copy f
          WHERE (f.gwan_code = g.code)))))
UNION ALL
 SELECT 'UI_MESSAGE'::text AS kind,
    ui_messages.code AS item,
    ('법적 근거 있는 문구가 비활성입니다 — '::text || COALESCE(ui_messages.basis, ''::text)) AS reason
   FROM public.ui_messages
  WHERE ((NOT ui_messages.is_active) AND (ui_messages.basis IS NOT NULL));

CREATE VIEW public.v_contract_conversion AS
 SELECT (date_trunc('month'::text, c.created_at))::date AS month,
    count(DISTINCT c.id) AS conversations,
    count(DISTINCT d.id) AS deals,
    count(DISTINCT ct.deal_id) AS contracts_issued,
    count(DISTINCT d.id) FILTER (WHERE (d.status = ANY (ARRAY['CONFIRMED'::text, 'SETTLED'::text]))) AS confirmed,
    round((((count(DISTINCT ct.deal_id))::numeric / (NULLIF(count(DISTINCT d.id), 0))::numeric) * (100)::numeric), 1) AS contract_rate_pct
   FROM ((public.conversations c
     LEFT JOIN public.deals d ON ((d.conversation_id = c.id)))
     LEFT JOIN public.deal_contracts ct ON ((ct.deal_id = d.id)))
  GROUP BY ((date_trunc('month'::text, c.created_at))::date)
  ORDER BY ((date_trunc('month'::text, c.created_at))::date);

CREATE VIEW public.v_contract_no_template AS
 SELECT id,
    template_code
   FROM public.deal_contracts c
  WHERE ((template_code IS NULL) OR (NOT (EXISTS ( SELECT 1
           FROM public.contract_templates t
          WHERE ((t.code = c.template_code) AND t.is_active)))));

CREATE VIEW public.v_contract_progress AS
 SELECT id,
    deal_id,
    state,
    terms,
    (agreed_by_buyer_at IS NOT NULL) AS buyer_agreed,
    (agreed_by_seller_at IS NOT NULL) AS seller_agreed,
    (signed_by_buyer_at IS NOT NULL) AS buyer_signed,
    (signed_by_seller_at IS NOT NULL) AS seller_signed,
    updated_at,
    ((now() - updated_at) > '3 days'::interval) AS stalled
   FROM public.deal_contracts c
  WHERE (state <> ALL (ARRAY['FULFILLED'::text, 'CANCELLED'::text]));

CREATE VIEW public.v_contract_stalled AS
 SELECT id,
    deal_id,
    state,
    updated_at
   FROM public.v_contract_progress
  WHERE stalled;

CREATE VIEW public.v_contract_stub AS
 SELECT id,
    template_code,
    state,
    issued_at
   FROM public.deal_contracts c
  WHERE (esign_stub AND (state = ANY (ARRAY['SIGNED'::text, 'FULFILLED'::text])));

CREATE VIEW public.v_contract_unfulfilled AS
 SELECT id,
    deal_id,
    updated_at
   FROM public.deal_contracts
  WHERE ((state = 'SIGNED'::text) AND (updated_at < (now() - '30 days'::interval)));

CREATE VIEW public.v_daily_metrics AS
 WITH d AS (
         SELECT (generate_series((((now() - '29 days'::interval))::date)::timestamp with time zone, ((now())::date)::timestamp with time zone, '1 day'::interval))::date AS day
        )
 SELECT day,
    ( SELECT count(*) AS count
           FROM public.accounts a
          WHERE ((a.created_at)::date = d.day)) AS signups,
    ( SELECT count(*) AS count
           FROM public.businesses b
          WHERE ((b.verified_at)::date = d.day)) AS biz_verified,
    ( SELECT count(*) AS count
           FROM public.requests r
          WHERE ((r.created_at)::date = d.day)) AS requests,
    ( SELECT count(*) AS count
           FROM public.listings l
          WHERE ((l.created_at)::date = d.day)) AS listings,
    ( SELECT count(*) AS count
           FROM public.deals dl
          WHERE ((dl.confirmed_at)::date = d.day)) AS deals,
    ( SELECT COALESCE(sum(i.amount), (0)::numeric) AS "coalesce"
           FROM public.subscription_invoices i
          WHERE ((i.paid_at)::date = d.day)) AS revenue
   FROM d
  ORDER BY day DESC;

CREATE VIEW public.v_dangling_refs AS
 SELECT p.proname AS routine,
    t.tbl AS missing_table
   FROM (pg_proc p
     CROSS JOIN ( VALUES ('bank_accounts'::text), ('payment_transactions'::text), ('tax_invoices'::text), ('deal_payment_records'::text), ('settlement_batches'::text), ('ledger_entries'::text)) t(tbl))
  WHERE ((p.pronamespace = ('public'::regnamespace)::oid) AND (p.prosrc ~~ (('%'::text || t.tbl) || '%'::text)));

CREATE VIEW public.v_direct_gwans AS
 SELECT code,
    name,
    sale_mode
   FROM public.gwans
  WHERE ((sale_mode = 'DIRECT'::text) AND is_active);

CREATE VIEW public.v_direct_notice_missing AS
 SELECT code,
    name
   FROM public.gwans g
  WHERE ((sale_mode = 'DIRECT'::text) AND is_active AND (COALESCE(( SELECT btrim(site_settings.value) AS btrim
           FROM public.site_settings
          WHERE (site_settings.key = 'legal.direct_notice'::text)), ''::text) = ''::text));

CREATE VIEW public.v_domain_mismatch AS
 SELECT ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'site.domain'::text)) AS domain,
    ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'site.base_url'::text)) AS base_url
  WHERE (( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'site.base_url'::text)) !~~ (('%'::text || ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'site.domain'::text))) || '%'::text));

CREATE VIEW public.v_duty_conflict AS
 SELECT a.email,
    string_agg(r.role, '·'::text ORDER BY r.role) AS roles
   FROM (public.account_roles r
     JOIN public.accounts a ON ((a.id = r.account_id)))
  WHERE ((r.role = ANY (ARRAY['ADMIN'::text, 'PAYOUT'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.account_roles s
          WHERE ((s.account_id = r.account_id) AND (s.role = 'SUPER'::text))))))
  GROUP BY a.email
 HAVING (count(DISTINCT r.role) > 1);

CREATE VIEW public.v_event_ungranted AS
 SELECT j.id,
    j.event_id,
    e.code AS event_code,
    e.title,
    j.account_id,
    j.created_at,
    (CURRENT_DATE - (j.created_at)::date) AS waiting_days
   FROM (public.event_joins j
     JOIN public.events e ON ((e.id = j.event_id)))
  WHERE (j.granted_at IS NULL)
  ORDER BY j.created_at;

CREATE VIEW public.v_events_live AS
 SELECT id,
    code,
    title,
    summary,
    body,
    benefit,
    gwan_code,
    join_type,
    max_joins,
    landing_url,
    starts_at,
    ends_at,
    ( SELECT count(*) AS count
           FROM public.event_joins j
          WHERE (j.event_id = e.id)) AS joins,
        CASE
            WHEN (max_joins IS NULL) THEN NULL::bigint
            ELSE GREATEST((max_joins - ( SELECT count(*) AS count
               FROM public.event_joins j
              WHERE (j.event_id = e.id))), (0)::bigint)
        END AS remain,
    ((ends_at)::date - CURRENT_DATE) AS days_left
   FROM public.events e
  WHERE ((status = 'PUBLISHED'::text) AND ((now() >= starts_at) AND (now() <= ends_at)))
  ORDER BY ends_at;

CREATE VIEW public.v_events_to_close AS
 SELECT id,
    code,
    title,
    ends_at
   FROM public.events
  WHERE ((status = 'PUBLISHED'::text) AND (ends_at < now()));

CREATE VIEW public.v_feature_flags AS
 SELECT replace(key, 'feature.'::text, ''::text) AS feature,
    (value = 'on'::text) AS enabled,
    description
   FROM public.site_settings
  WHERE (key ~~ 'feature.%'::text);

CREATE VIEW public.v_fee_mixing_check AS
 SELECT f.deal_id,
    f.amount AS success_fee,
    s.amount AS settlement_amount
   FROM (public.success_fees f
     JOIN public.settlements s ON ((s.deal_id = f.deal_id)))
  WHERE (s.amount < ( SELECT d.agreed_fee
           FROM public.deals d
          WHERE (d.id = f.deal_id)));

CREATE VIEW public.v_footer_links AS
 SELECT section,
    label,
    target_type,
    target_ref,
    sort_order,
        CASE
            WHEN (target_type = 'TERM'::text) THEN (EXISTS ( SELECT 1
               FROM public.terms t
              WHERE ((t.code = f.target_ref) AND (t.status = 'PUBLISHED'::text))))
            WHEN (target_type = 'NONE'::text) THEN false
            ELSE true
        END AS available,
    COALESCE(tip, ( SELECT t.blocked_by
           FROM public.terms t
          WHERE (t.code = f.target_ref)
          ORDER BY t.effective_from DESC
         LIMIT 1), blocked_by) AS tip
   FROM public.footer_links f
  WHERE is_active
  ORDER BY sort_order;

CREATE VIEW public.v_gated_no_review AS
 SELECT l.id,
    l.gwan_code,
    l.title,
    c.name AS category,
    r.code AS restricted
   FROM ((public.listings l
     JOIN public.categories c ON ((c.id = l.category_id)))
     JOIN public.restricted_industries r ON (((r.code = c.restricted_code) AND (r.gwan_code = l.gwan_code) AND r.is_active)))
  WHERE ((r.mode = 'GATED'::text) AND (COALESCE(btrim(l.review_no), ''::text) = ''::text) AND (l.status = ANY (ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text])));

CREATE VIEW public.v_gated_unchecked AS
 SELECT l.id,
    l.title,
    l.review_no,
    l.created_at,
    (CURRENT_DATE - (l.created_at)::date) AS waiting_days
   FROM ((public.listings l
     JOIN public.categories c ON ((c.id = l.category_id)))
     JOIN public.restricted_industries r ON (((r.code = c.restricted_code) AND (r.gwan_code = l.gwan_code) AND r.is_active)))
  WHERE ((r.mode = 'GATED'::text) AND (l.review_checked_at IS NULL) AND (l.status = 'PUBLISHED'::text))
  ORDER BY l.created_at;

CREATE VIEW public.v_grade_no_rank AS
 SELECT grade,
    gwan_code,
    rank
   FROM public.lead_grade_rates
  WHERE (rank >= 99);

CREATE VIEW public.v_guarantee_custody_risk AS
 SELECT table_name,
    column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name = ANY (ARRAY['fee_guarantees'::name, 'settlements'::name])) AND ((column_name)::name ~ 'balance|deposit|charged|wallet|잔액'::text));

CREATE VIEW public.v_gwan_admin AS
 SELECT code,
    name,
    is_active,
    is_hub,
    sort_order,
    ( SELECT count(*) AS count
           FROM public.categories c
          WHERE ((c.gwan_code = g.code) AND (c.status = 'APPROVED'::text))) AS categories,
    ( SELECT count(*) AS count
           FROM public.listings l
          WHERE ((l.gwan_code = g.code) AND (l.status = 'PUBLISHED'::text))) AS listings,
    (code = ( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'site.landing_after_login'::text))) AS is_landing
   FROM public.gwans g
  ORDER BY sort_order;

CREATE VIEW public.v_gwan_cards AS
 SELECT code,
    name,
    description,
    sort_order,
    (sort_order <= ( SELECT (site_settings.value)::integer AS value
           FROM public.site_settings
          WHERE (site_settings.key = 'site.gwan_cards_max'::text))) AS on_main
   FROM public.gwans g
  WHERE (is_active AND (NOT is_hub))
  ORDER BY sort_order;

CREATE VIEW public.v_gwan_hub AS
 SELECT code,
    name,
    is_active,
    ( SELECT count(*) AS count
           FROM public.listings l
          WHERE ((l.gwan_code = g.code) AND (l.status = 'PUBLISHED'::text))) AS listings,
    ( SELECT count(*) AS count
           FROM public.requests r
          WHERE ((r.gwan_code = g.code) AND (r.status = 'PUBLISHED'::text))) AS requests,
    ( SELECT count(*) AS count
           FROM public.categories c
          WHERE ((c.gwan_code = g.code) AND (c.status = 'APPROVED'::text))) AS categories,
    ( SELECT count(*) AS count
           FROM public.review_items ri
          WHERE ((ri.gwan_code = g.code) AND (ri.status = 'QUEUED'::text))) AS review_pending,
    ( SELECT count(*) AS count
           FROM public.banned_words w
          WHERE (w.gwan_code = g.code)) AS own_words
   FROM public.gwans g
  ORDER BY sort_order;

CREATE VIEW public.v_gwan_system AS
 SELECT code,
    name,
    ( SELECT count(*) AS count
           FROM public.categories c
          WHERE ((c.gwan_code = g.code) AND (c.status = 'APPROVED'::text))) AS categories,
    ( SELECT count(*) AS count
           FROM public.listing_checklist x
          WHERE (x.gwan_code = g.code)) AS own_checklist,
    ( SELECT count(*) AS count
           FROM public.report_reasons r
          WHERE (r.gwan_code = g.code)) AS own_reports,
    ( SELECT count(*) AS count
           FROM public.lead_grade_rates l
          WHERE (l.gwan_code = g.code)) AS own_rates,
    ( SELECT count(*) AS count
           FROM public.terms t
          WHERE ((t.gwan_code = g.code) AND (t.status = 'PUBLISHED'::text))) AS own_terms,
    ( SELECT count(*) AS count
           FROM public.restricted_industries i
          WHERE ((i.gwan_code = g.code) AND i.is_active)) AS restrictions
   FROM public.gwans g
  WHERE (is_active AND (NOT is_hub))
  ORDER BY sort_order;

CREATE VIEW public.v_gwan_without_category AS
 SELECT code,
    name
   FROM public.gwans g
  WHERE (is_active AND (NOT is_hub) AND (NOT (EXISTS ( SELECT 1
           FROM public.categories c
          WHERE ((c.gwan_code = g.code) AND (c.status = 'APPROVED'::text))))));

CREATE VIEW public.v_high_fee_eligible AS
 SELECT listing_id,
    business_id,
    kind,
    amount,
    custodian,
    verified_at
   FROM public.fee_guarantees g
  WHERE ((verified_at IS NOT NULL) AND ((expires_at IS NULL) OR (expires_at > now())));

CREATE VIEW public.v_hlt_carryover_large AS
 SELECT s.code,
    s.name,
    st.carried_out,
    st.period_to,
    ( SELECT count(*) AS count
           FROM public.hlt_settlements x
          WHERE ((x.seller_id = s.id) AND (x.carried_out < 0))) AS negative_weeks
   FROM (public.hlt_settlements st
     JOIN public.hlt_sellers s ON ((s.id = st.seller_id)))
  WHERE ((st.carried_out < '-100000'::integer) AND (st.period_from = ( SELECT max(hlt_settlements.period_from) AS max
           FROM public.hlt_settlements
          WHERE (hlt_settlements.seller_id = st.seller_id))));

CREATE VIEW public.v_hlt_cart AS
 SELECT ci.account_id,
    count(*) AS lines,
    sum(ci.qty) AS items,
    sum((p.price * ci.qty)) AS goods,
        CASE
            WHEN (sum((p.price * ci.qty)) >= (30000)::numeric) THEN 0
            ELSE 3000
        END AS ship_fee,
    (sum((p.price * ci.qty)) + (
        CASE
            WHEN (sum((p.price * ci.qty)) >= (30000)::numeric) THEN 0
            ELSE 3000
        END)::numeric) AS total,
    bool_or(((p.stock < ci.qty) OR (p.status <> 'ON_SALE'::text))) AS has_problem
   FROM (public.hlt_cart_items ci
     JOIN public.hlt_products p ON ((p.id = ci.product_id)))
  GROUP BY ci.account_id;

CREATE VIEW public.v_hlt_license_expired AS
 SELECT s.code,
    s.name,
    l.kind,
    l.expires_at,
    (CURRENT_DATE - l.expires_at) AS days_over,
    ( SELECT count(*) AS count
           FROM public.hlt_products p
          WHERE ((p.seller_id = s.id) AND (p.status = 'ON_SALE'::text))) AS on_sale
   FROM (public.hlt_seller_licenses l
     JOIN public.hlt_sellers s ON ((s.id = l.seller_id)))
  WHERE ((l.expires_at IS NOT NULL) AND (l.expires_at < CURRENT_DATE) AND (EXISTS ( SELECT 1
           FROM public.hlt_products p
          WHERE ((p.seller_id = s.id) AND (p.status = 'ON_SALE'::text)))));

CREATE VIEW public.v_hlt_license_expiring AS
 SELECT s.code,
    s.name,
    l.kind,
    l.expires_at,
    (l.expires_at - CURRENT_DATE) AS days_left
   FROM (public.hlt_seller_licenses l
     JOIN public.hlt_sellers s ON ((s.id = l.seller_id)))
  WHERE ((l.expires_at >= CURRENT_DATE) AND (l.expires_at <= (CURRENT_DATE + 30)));

CREATE VIEW public.v_hlt_paid_no_actor AS
 SELECT st.id,
    s.code,
    st.period_from,
    st.net_amount
   FROM (public.hlt_settlements st
     JOIN public.hlt_sellers s ON ((s.id = st.seller_id)))
  WHERE ((st.status = 'PAID'::text) AND (st.paid_by IS NULL));

CREATE VIEW public.v_hlt_refund_pending AS
 SELECT r.id,
    o.order_no,
    r.refund_amount,
    r.decided_at,
    (CURRENT_DATE - (r.decided_at)::date) AS days_since
   FROM (public.hlt_returns r
     JOIN public.hlt_orders o ON ((o.id = r.order_id)))
  WHERE ((r.state = 'APPROVED'::text) AND (r.refunded_at IS NULL));

CREATE VIEW public.v_hlt_returns_pending AS
 SELECT r.id,
    o.order_no,
    r.kind,
    r.reason,
    r.state,
    r.created_at,
    (CURRENT_DATE - (r.created_at)::date) AS waiting_days,
    o.total
   FROM (public.hlt_returns r
     JOIN public.hlt_orders o ON ((o.id = r.order_id)))
  WHERE (r.state = 'REQUESTED'::text)
  ORDER BY r.created_at;

CREATE VIEW public.v_hlt_sale_leak AS
 SELECT l.id,
    l.title,
    r.code AS restricted,
    r.mode
   FROM ((public.listings l
     JOIN public.categories c ON ((c.id = l.category_id)))
     JOIN public.restricted_industries r ON (((r.code = c.restricted_code) AND (r.gwan_code = 'HLT'::text) AND r.is_active)))
  WHERE ((l.gwan_code = 'HLT'::text) AND (r.mode = ANY (ARRAY['BLOCK'::text, 'AD_ONLY'::text])));

CREATE VIEW public.v_hlt_sale_violation AS
 SELECT l.id,
    l.title,
    c.name AS category,
    r.code AS restricted,
    r.mode
   FROM ((public.listings l
     JOIN public.categories c ON ((c.id = l.category_id)))
     JOIN public.restricted_industries r ON (((r.code = c.restricted_code) AND (r.gwan_code = 'HLT'::text) AND r.is_active)))
  WHERE ((l.gwan_code = 'HLT'::text) AND (r.mode = ANY (ARRAY['BLOCK'::text, 'AD_ONLY'::text])) AND (l.status = ANY (ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text])));

CREATE VIEW public.v_hlt_seller_no_submerchant AS
 SELECT code,
    name,
    type,
    status
   FROM public.hlt_sellers
  WHERE ((status = 'ACTIVE'::text) AND (type <> 'DIRECT'::text) AND (COALESCE(btrim(submerchant_id), ''::text) = ''::text));

CREATE VIEW public.v_hlt_settle_blocked AS
 SELECT code,
    name,
    type,
    '하위가맹점 ID 가 없습니다 — PG 계약 뒤에 채우십시오'::text AS reason
   FROM public.hlt_sellers s
  WHERE ((type <> 'DIRECT'::text) AND (status = 'ACTIVE'::text) AND (COALESCE(btrim(submerchant_id), ''::text) = ''::text));

CREATE VIEW public.v_hlt_settle_ready AS
 SELECT id AS order_id,
    seller_id,
    order_no,
    goods_amount,
    ( SELECT COALESCE(sum(i.commission_amount), (0)::numeric) AS "coalesce"
           FROM public.hlt_order_items i
          WHERE (i.order_id = o.id)) AS commission,
    delivered_at,
    (delivered_at + '7 days'::interval) AS confirm_at
   FROM public.hlt_orders o
  WHERE ((status = 'DELIVERED'::text) AND (delivered_at IS NOT NULL) AND (delivered_at < (now() - '7 days'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.hlt_settlement_items si
          WHERE ((si.order_id = o.id) AND (si.kind = 'SALE'::text))))) AND (NOT (EXISTS ( SELECT 1
           FROM public.hlt_returns r
          WHERE ((r.order_id = o.id) AND (r.state = ANY (ARRAY['APPROVED'::text, 'REFUNDED'::text])))))));

CREATE VIEW public.v_hlt_settle_missed AS
 SELECT order_no,
    seller_id,
    confirm_at,
    (CURRENT_DATE - (confirm_at)::date) AS days_over
   FROM public.v_hlt_settle_ready
  WHERE (confirm_at < (now() - '14 days'::interval));

CREATE VIEW public.v_hlt_settlement_ready AS
 SELECT o.seller_id,
    s.code AS seller_code,
    s.name AS seller_name,
    count(*) AS orders,
    sum(o.goods_amount) AS gross,
    sum(( SELECT COALESCE(sum(i.commission_amount), (0)::numeric) AS "coalesce"
           FROM public.hlt_order_items i
          WHERE (i.order_id = o.id))) AS commission
   FROM (public.hlt_orders o
     JOIN public.hlt_sellers s ON ((s.id = o.seller_id)))
  WHERE ((o.status = 'DELIVERED'::text) AND (o.delivered_at < (now() - '7 days'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.hlt_settlement_items si
          WHERE (si.order_id = o.id)))))
  GROUP BY o.seller_id, s.code, s.name;

CREATE VIEW public.v_hlt_ship_overdue AS
 SELECT order_no,
    paid_at,
    total,
    (CURRENT_DATE - (paid_at)::date) AS days_since_paid
   FROM public.hlt_orders o
  WHERE ((status = ANY (ARRAY['PAID'::text, 'PREPARING'::text])) AND (paid_at < (now() - '3 days'::interval)));

CREATE VIEW public.v_hlt_wrong_gwan AS
 SELECT p.code,
    p.name,
    c.gwan_code
   FROM (public.hlt_products p
     JOIN public.categories c ON ((c.id = p.category_id)))
  WHERE (c.gwan_code <> 'HLT'::text);

CREATE VIEW public.v_individual_listing AS
 SELECT l.id,
    l.title,
    l.item_type,
    a.email
   FROM (public.listings l
     JOIN public.accounts a ON ((a.id = l.owner_account_id)))
  WHERE ((a.account_type IS DISTINCT FROM 'BUSINESS'::text) AND (COALESCE(l.item_type, ''::text) <> 'PERSON'::text));

CREATE VIEW public.v_integration_readiness AS
 SELECT code,
    name,
    status,
    secret_registered,
    blocks_open,
    requires_ip,
        CASE
            WHEN (status = 'LIVE'::text) THEN '완료'::text
            WHEN ((status = 'TESTING'::text) AND secret_registered) THEN '키 있음 · 실호출 확인 필요'::text
            WHEN (status = 'TESTING'::text) THEN '코드 준비됨 · 키 필요'::text
            WHEN requires_ip THEN 'IP 등록 필요(2~4주)'::text
            ELSE '미착수'::text
        END AS next_step
   FROM public.integrations
  ORDER BY blocks_open DESC, sort_order;

CREATE VIEW public.v_integration_status AS
 SELECT code,
    name,
    status,
    requires_ip,
    (egress_ip IS NOT NULL) AS ip_registered,
    secret_registered,
    blocks_open,
        CASE
            WHEN (status = 'LIVE'::text) THEN 0
            WHEN (requires_ip AND (ip_approved_at IS NULL)) THEN (COALESCE(lead_time_weeks, 0) + 4)
            ELSE COALESCE(lead_time_weeks, 0)
        END AS est_weeks_remaining
   FROM public.integrations
  ORDER BY sort_order;

CREATE VIEW public.v_internal_key_missing AS
 SELECT key,
    '내부 API 키가 비어 있습니다'::text AS note
   FROM public.site_settings
  WHERE ((key = 'internal.api_key'::text) AND (COALESCE(btrim(value), ''::text) = ''::text));

CREATE VIEW public.v_intro_money_ledger AS
 SELECT s.payee_account_id AS account_id,
    s.deal_id,
    s.amount,
    s.status,
    s.paid_marked_at,
    d.match_source
   FROM (public.settlements s
     JOIN public.deals d ON ((d.id = s.deal_id)))
  WHERE (d.match_source = 'HUMAN'::text);

CREATE VIEW public.v_introducer_matched_requests AS
 SELECT p.account_id AS introducer_id,
    q.id AS request_id,
    q.title,
    q.gwan_code,
    q.category_id,
    q.closes_at
   FROM (public.introducer_profiles p
     JOIN public.requests q ON ((q.status = 'OPEN'::text)))
  WHERE ((q.owner_account_id <> p.account_id) AND (NOT (EXISTS ( SELECT 1
           FROM public.introducer_responses r
          WHERE ((r.request_id = q.id) AND (r.introducer_id = p.account_id))))));

CREATE VIEW public.v_introducer_scorecard AS
 SELECT p.account_id,
    p.grade,
    p.is_founding,
    count(DISTINCT r.id) FILTER (WHERE (r.answer = 'KNOW'::text)) AS responses,
    count(DISTINCT i.id) AS invites_sent,
    count(DISTINCT i.id) FILTER (WHERE (i.state = 'CONSENTED'::text)) AS invites_consented,
    count(DISTINCT c.id) FILTER (WHERE c.is_valid) AS valid_connections,
    count(DISTINCT c.id) FILTER (WHERE c.reported) AS reported,
    round(((100.0 * (count(DISTINCT i.id) FILTER (WHERE (i.state = 'CONSENTED'::text)))::numeric) / (NULLIF(count(DISTINCT i.id), 0))::numeric), 1) AS consent_rate,
    round(avg(c.rating) FILTER (WHERE (c.rating IS NOT NULL)), 2) AS avg_rating
   FROM (((public.introducer_profiles p
     LEFT JOIN public.introducer_responses r ON ((r.introducer_id = p.account_id)))
     LEFT JOIN public.introduction_invites i ON ((i.introducer_id = p.account_id)))
     LEFT JOIN public.introduction_connections c ON ((c.introducer_id = p.account_id)))
  GROUP BY p.account_id, p.grade, p.is_founding;

CREATE VIEW public.v_introducer_stats AS
 SELECT introducer_account_id AS account_id,
    count(*) FILTER (WHERE (status = ANY (ARRAY['CONFIRMED'::text, 'SETTLED'::text]))) AS confirmed_deals,
    count(*) AS total_deals,
    COALESCE(sum(agreed_fee) FILTER (WHERE (status = 'SETTLED'::text)), (0)::numeric) AS settled_amount,
    max(confirmed_at) AS last_confirmed_at
   FROM public.deals d
  WHERE (introducer_account_id IS NOT NULL)
  GROUP BY introducer_account_id;

CREATE VIEW public.v_inv11_violations AS
 SELECT table_name,
    column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((column_name)::name ~ 'account_no|bank_code|pg_provider|pg_tid|escrow|vaccount|card_no'::text) AND (NOT (((table_name)::name = 'hlt_payments'::name) AND ((column_name)::name = 'pg_tid'::name))));

CREATE VIEW public.v_inv9_violations AS
 SELECT table_name,
    column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((column_name)::name ~ 'deduct|commission|platform_fee|withhold|take_rate'::text) AND ((table_name)::name !~ '^(hlt_|v_hlt_)'::text));

CREATE VIEW public.v_invite_contact_residue AS
 SELECT id,
    invite_id,
    channel,
    state,
    queued_at
   FROM public.invite_deliveries
  WHERE ((contact_enc IS NOT NULL) AND (state <> 'QUEUED'::text));

CREATE VIEW public.v_invite_self_contact AS
 SELECT id,
    invite_id
   FROM public.invite_deliveries
  WHERE ((channel = 'SELF'::text) AND ((contact_enc IS NOT NULL) OR (contact_hash IS NOT NULL)));

CREATE VIEW public.v_job_failures AS
 SELECT job,
    slot,
    started_at,
    ended_at,
    detail
   FROM public.job_runs
  WHERE ((ok = false) AND (started_at >= (now() - '24:00:00'::interval)))
  ORDER BY started_at DESC;

CREATE VIEW public.v_job_stale AS
 SELECT s.job,
    s.description,
    s.every_min,
    max(r.started_at) AS last_run,
    (now() - max(r.started_at)) AS since,
    (max(r.started_at) IS NULL) AS never_ran
   FROM (public.job_schedules s
     LEFT JOIN public.job_runs r ON ((r.job = s.job)))
  WHERE s.is_active
  GROUP BY s.job, s.description, s.every_min
 HAVING ((max(r.started_at) IS NULL) OR (max(r.started_at) < (now() - (((s.every_min * 3) || ' minutes'::text))::interval)));

CREATE VIEW public.v_k_value AS
 SELECT (date_trunc('month'::text, b.verified_at))::date AS cohort_month,
    count(DISTINCT b.id) AS businesses,
    count(l.id) AS listings,
    round(((count(l.id))::numeric / (NULLIF(count(DISTINCT b.id), 0))::numeric), 2) AS k
   FROM (public.businesses b
     LEFT JOIN public.listings l ON ((l.owner_account_id = b.account_id)))
  WHERE (b.verified_at IS NOT NULL)
  GROUP BY ((date_trunc('month'::text, b.verified_at))::date);

CREATE VIEW public.v_landing_broken AS
 SELECT s.key,
    s.value,
    g.is_active
   FROM (public.site_settings s
     LEFT JOIN public.gwans g ON ((g.code = s.value)))
  WHERE ((s.key = ANY (ARRAY['site.landing_after_login'::text, 'site.landing_new_member'::text])) AND (COALESCE(btrim(s.value), ''::text) <> ''::text) AND ((g.code IS NULL) OR (NOT g.is_active)));

CREATE VIEW public.v_lead_economics AS
 WITH d AS (
         SELECT (count(*))::numeric AS delivered,
            (count(*) FILTER (WHERE (lead_deliveries.viewed_at IS NOT NULL)))::numeric AS viewed
           FROM public.lead_deliveries
        ), f AS (
         SELECT COALESCE(sum(lead_fees.amount), (0)::numeric) AS billed,
            (count(*))::numeric AS fee_rows
           FROM public.lead_fees
          WHERE (lead_fees.state <> 'VOID'::text)
        )
 SELECT d.delivered,
    d.viewed,
    round((((100)::numeric * d.viewed) / NULLIF(d.delivered, (0)::numeric)), 1) AS view_rate_pct,
    f.billed,
    f.fee_rows,
    round((f.billed / NULLIF(f.fee_rows, (0)::numeric))) AS avg_fee,
    round(((1215)::numeric / NULLIF((d.viewed / NULLIF(d.delivered, (0)::numeric)), (0)::numeric))) AS breakeven_fee
   FROM d,
    f;

CREATE VIEW public.v_lead_below_breakeven AS
 SELECT avg_fee,
    breakeven_fee,
    view_rate_pct
   FROM public.v_lead_economics
  WHERE ((fee_rows >= (20)::numeric) AND (avg_fee < breakeven_fee));

CREATE VIEW public.v_lead_fee_coupling AS
 SELECT column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name = 'lead_fees'::name) AND ((column_name)::name ~ 'deal|referral|success|commission|settle'::text));

CREATE VIEW public.v_lead_fee_due AS
 SELECT partner_id,
    count(*) AS items,
    sum(amount) AS amount,
    min(incurred_at) AS oldest
   FROM public.lead_fees f
  WHERE (state = 'PENDING'::text)
  GROUP BY partner_id;

CREATE VIEW public.v_lead_fee_raised AS
 SELECT c.name AS category,
    ch.old_fee,
    ch.new_fee,
    ch.changed_at
   FROM (public.lead_fee_changes ch
     JOIN public.categories c ON ((c.id = ch.category_id)))
  WHERE ((ch.new_fee > COALESCE(ch.old_fee, (0)::numeric)) AND (ch.changed_at >= (now() - '30 days'::interval)))
  ORDER BY ch.changed_at DESC;

CREATE VIEW public.v_lead_fee_void_mismatch AS
 SELECT id,
    partner_id,
    state,
    voided_at
   FROM public.lead_fees
  WHERE ((voided_at IS NOT NULL) <> (state = 'VOIDED'::text));

CREATE VIEW public.v_lead_fee_void_without_rule AS
 SELECT id,
    partner_id,
    amount,
    voided_at,
    state
   FROM public.lead_fees
  WHERE (((voided_at IS NOT NULL) OR (state = 'VOIDED'::text)) AND (COALESCE(btrim(void_rule), ''::text) = ''::text));

CREATE VIEW public.v_lead_fee_without_view AS
 SELECT f.id,
    f.partner_id,
    f.amount
   FROM (public.lead_fees f
     JOIN public.lead_deliveries d ON ((d.id = f.delivery_id)))
  WHERE (d.viewed_at IS NULL);

CREATE VIEW public.v_lead_fee_zero AS
 SELECT id,
    delivery_id,
    partner_id
   FROM public.lead_fees
  WHERE ((amount = (0)::numeric) AND (state <> 'VOID'::text));

CREATE VIEW public.v_lead_price_table AS
 SELECT c.id AS category_id,
    c.name AS category,
    c.lead_fee AS cap,
    g.grade,
    g.rate,
    round((c.lead_fee * g.rate)) AS price,
    g.note
   FROM (public.categories c
     CROSS JOIN public.lead_grade_rates g)
  WHERE (c.lead_fee IS NOT NULL)
  ORDER BY c.name, g.grade;

CREATE VIEW public.v_listing_gwan_mismatch AS
 SELECT l.id,
    l.gwan_code AS listing_gwan,
    c.gwan_code AS category_gwan,
    l.title
   FROM (public.listings l
     JOIN public.categories c ON ((c.id = l.category_id)))
  WHERE (l.gwan_code <> c.gwan_code);

CREATE VIEW public.v_listing_search AS
 SELECT id,
    gwan_code,
    category_id,
    owner_account_id,
    title,
    body,
    grade_code,
    desired_fee,
    fee_bearer,
    status,
    version,
    view_count,
    like_count,
    published_at,
    created_at,
    updated_at,
    is_priority_exposed,
    priority_label,
    badge_urgent_until,
    badge_verified_at,
    item_type,
    review_no,
    review_checked_at,
    lower(((COALESCE(title, ''::text) || ' '::text) || COALESCE(body, ''::text))) AS search_text
   FROM public.listings l;

CREATE VIEW public.v_location_columns AS
 SELECT table_name,
    column_name,
    data_type
   FROM information_schema.columns c
  WHERE (((table_schema)::name = 'public'::name) AND (((column_name)::name ~* '^(lat|lng|lon|latitude|longitude|geohash)$'::text) OR ((column_name)::name ~* '_(lat|lng|lon|latitude|longitude)$'::text) OR ((data_type)::text = ANY (ARRAY[('point'::character varying)::text, ('geography'::character varying)::text, ('geometry'::character varying)::text]))));

CREATE VIEW public.v_location_waiver_broken AS
 SELECT table_name,
    column_name,
    '좌표 컬럼이 생겼습니다 — 위치기반 약관 폐기 판단을 다시 하십시오'::text AS note
   FROM information_schema.columns c
  WHERE (((table_schema)::name = 'public'::name) AND ((column_name)::name ~* '^(lat|lng|lon|longitude|latitude|geo_?(lat|lng|point))$'::text) AND (( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'legal.location_waived'::text)) = 'on'::text));

CREATE VIEW public.v_main_empty AS
 SELECT count(*) FILTER (WHERE is_active) AS active_sections
   FROM public.main_sections
 HAVING (count(*) FILTER (WHERE is_active) = 0);

CREATE VIEW public.v_manual_reasons AS
 SELECT unnest(manual_reasons) AS reason,
    count(*) AS cnt
   FROM public.review_items
  WHERE ((decision_mode = 'MANUAL'::text) AND (manual_reasons IS NOT NULL))
  GROUP BY (unnest(manual_reasons))
  ORDER BY (count(*)) DESC;

CREATE VIEW public.v_marketing_consent_stale AS
 SELECT account_id,
    agreed_at,
    (CURRENT_DATE - (agreed_at)::date) AS days_old
   FROM public.term_agreements a
  WHERE ((term_code = 'MARKETING'::text) AND agreed AND (agreed_at < (now() - '2 years'::interval)));

CREATE VIEW public.v_marketing_night_violation AS
 SELECT id,
    account_id,
    event_code,
    created_at,
    '야간 동의 없이 21시~08시에 광고를 보냈습니다'::text AS note
   FROM public.notifications n
  WHERE ((event_code ~~ 'MARKETING%'::text) AND ((EXTRACT(hour FROM (created_at AT TIME ZONE 'Asia/Seoul'::text)) >= (21)::numeric) OR (EXTRACT(hour FROM (created_at AT TIME ZONE 'Asia/Seoul'::text)) < (8)::numeric)) AND (NOT (EXISTS ( SELECT 1
           FROM public.term_agreements a
          WHERE ((a.account_id = n.account_id) AND (a.term_code = 'MARKETING_NIGHT'::text) AND a.agreed)))));

CREATE VIEW public.v_marketing_no_consent AS
 SELECT id,
    account_id,
    event_code,
    created_at
   FROM public.notifications n
  WHERE ((event_code ~ 'MARKETING|PROMO|EVENT|AD_'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.term_agreements a
          WHERE ((a.account_id = n.account_id) AND (a.term_code = 'MARKETING'::text) AND a.agreed)))));

CREATE VIEW public.v_marketing_reconfirm_due AS
 SELECT account_id,
    agreed_at,
    (CURRENT_DATE - (agreed_at)::date) AS days_since
   FROM public.term_agreements a
  WHERE ((term_code = 'MARKETING'::text) AND agreed AND (agreed_at < (now() - '2 years'::interval)));

CREATE VIEW public.v_notification_copy_conflicts AS
 SELECT code,
    channel,
        CASE
            WHEN ((body ~~ '%{bank}%'::text) OR (body ~~ '%{account}%'::text)) THEN '치환 불가 변수(계좌)'::text
            WHEN ((body ~~ '%수요일%'::text) OR (body ~~ '%배치%'::text)) THEN '없어진 배치 지급 언급'::text
            WHEN (body ~~ '%계좌로 지급%'::text) THEN '플랫폼 지급 주장'::text
            ELSE '기타'::text
        END AS reason
   FROM public.notification_templates
  WHERE ((body ~~ '%{bank}%'::text) OR (body ~~ '%{account}%'::text) OR (body ~~ '%수요일%'::text) OR (body ~~ '%배치%'::text) OR (body ~~ '%계좌로 지급%'::text));

CREATE VIEW public.v_notify_channels AS
 SELECT 'INAPP'::text AS channel,
    true AS ready,
    '항상 가능'::text AS note
UNION ALL
 SELECT 'EMAIL'::text AS channel,
    ( SELECT (lower(site_settings.value) = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key = 'notify.email_verified'::text)) AS ready,
    'SPF·DKIM 확인 후 켭니다. 인증 없이 보내면 스팸함으로 갑니다'::text AS note
UNION ALL
 SELECT 'SMS'::text AS channel,
    ( SELECT (lower(site_settings.value) = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key = 'notify.sms_ready'::text)) AS ready,
    '발송사 계약 후 켭니다'::text AS note
UNION ALL
 SELECT 'ALIMTALK'::text AS channel,
    ( SELECT (lower(site_settings.value) = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key = 'notify.alimtalk_ready'::text)) AS ready,
    '카카오 템플릿 사전 승인 후 켭니다'::text AS note;

CREATE VIEW public.v_notify_queue AS
 SELECT n.id AS notification_id,
    n.account_id,
    n.event_code,
    n.template_code,
    n.title,
    n.body,
    n.created_at,
    a.email,
    a.phone,
    COALESCE(p.optout_allowed, true) AS optout_allowed,
    COALESCE(p.quiet_hours_exempt, false) AS quiet_exempt
   FROM ((public.notifications n
     JOIN public.accounts a ON ((a.id = n.account_id)))
     LEFT JOIN public.notification_event_policies p ON ((p.event_code = n.event_code)))
  WHERE ((a.withdrawn_at IS NULL) AND (n.created_at >= (now() - '3 days'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.notification_deliveries d
          WHERE ((d.notification_id = n.id) AND (d.channel <> 'INAPP'::text))))));

CREATE VIEW public.v_notify_stuck AS
 SELECT id,
    account_id,
    template_code,
    created_at
   FROM public.notifications n
  WHERE ((created_at < (now() - '3 days'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.notification_deliveries d
          WHERE ((d.notification_id = n.id) AND (d.channel <> 'INAPP'::text))))));

CREATE VIEW public.v_nts_check_health AS
 SELECT nts_status,
    count(*) AS cnt,
    max(nts_checked_at) AS last_checked,
    (array_agg(nts_detail ORDER BY nts_checked_at DESC))[1] AS recent_detail
   FROM public.businesses
  WHERE (nts_checked_at > (now() - '7 days'::interval))
  GROUP BY nts_status;

CREATE VIEW public.v_open_blockers AS
 SELECT 'SETTING'::text AS kind,
    s.key AS item,
        CASE
            WHEN ((s.value IS NULL) OR (btrim(s.value) = ''::text)) THEN s.description
            WHEN (EXISTS ( SELECT 1
               FROM public.setting_placeholders p
              WHERE (s.value ~~* (('%'::text || p.token) || '%'::text)))) THEN ('자리표시자가 남아 있습니다 — '::text || s.value)
            WHEN ((s.value_pattern IS NOT NULL) AND (s.value !~ s.value_pattern)) THEN ('형식 오류 — 예: '::text || COALESCE(s.value_example, ''::text))
            ELSE (('길이 부족 — '::text || COALESCE((s.min_length)::text, ''::text)) || '자 이상'::text)
        END AS reason
   FROM public.site_settings s
  WHERE (s.is_required_for_open AND ((s.value IS NULL) OR (btrim(s.value) = ''::text) OR (EXISTS ( SELECT 1
           FROM public.setting_placeholders p
          WHERE (s.value ~~* (('%'::text || p.token) || '%'::text)))) OR ((s.value_pattern IS NOT NULL) AND (s.value !~ s.value_pattern)) OR ((s.min_length IS NOT NULL) AND (length(btrim(s.value)) < s.min_length))))
UNION ALL
 SELECT 'TERM'::text AS kind,
    ((t.code || ' '::text) || max(t.title)) AS item,
    COALESCE(max(t.blocked_by), '내용 미작성'::text) AS reason
   FROM public.terms t
  WHERE t.is_required
  GROUP BY t.code
 HAVING (count(*) FILTER (WHERE (t.status = 'PUBLISHED'::text)) = 0)
UNION ALL
 SELECT 'FOOTER'::text AS kind,
    v_footer_links.label AS item,
    ('목적지 없음 — '::text || COALESCE(v_footer_links.tip, '미정'::text)) AS reason
   FROM public.v_footer_links
  WHERE ((NOT v_footer_links.available) AND (v_footer_links.section = 'LEGAL'::text))
UNION ALL
 SELECT 'INTEGRATION'::text AS kind,
    integrations.name AS item,
    ((('연동 미완료 ('::text || integrations.status) || ') — '::text) || integrations.purpose) AS reason
   FROM public.integrations
  WHERE (integrations.blocks_open AND (integrations.status <> 'LIVE'::text))
  ORDER BY 1, 2;

CREATE VIEW public.v_owner_verified_but_locked AS
 SELECT v.listing_id,
    l.status
   FROM (public.owner_verifications v
     JOIN public.listings l ON ((l.id = v.listing_id)))
  WHERE ((v.state = 'VERIFIED'::text) AND (l.status = 'PUBLISHED'::text) AND (( SELECT site_settings.value
           FROM public.site_settings
          WHERE (site_settings.key = 'mal.owner_direct_ready'::text)) <> 'on'::text));

CREATE VIEW public.v_owner_verify_pending AS
 SELECT v.id,
    v.listing_id AS "listingId",
    l.title,
    a.name AS applicant,
    v.issued_on,
    v.address_match,
    v.has_encumbrance,
    v.state,
    v.created_at
   FROM ((public.owner_verifications v
     JOIN public.listings l ON ((l.id = v.listing_id)))
     JOIN public.accounts a ON ((a.id = v.applicant_id)))
  WHERE (v.state = ANY (ARRAY['SUBMITTED'::text, 'PENDING'::text, 'SUPPLEMENT'::text]))
  ORDER BY v.created_at;

CREATE VIEW public.v_partner_custody_risk AS
 SELECT table_name,
    column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name = ANY (ARRAY['partners'::name, 'lead_fees'::name])) AND ((column_name)::name ~ 'balance|charge|topup|withdraw|wallet|deposit'::text));

CREATE VIEW public.v_payout_locked AS
 SELECT p.id,
    a.email,
    p.bank_name,
    p.verify_tries,
    p.verify_sent_at
   FROM (public.payout_accounts p
     JOIN public.accounts a ON ((a.id = p.account_id)))
  WHERE ((p.verify_tries >= 5) AND (NOT p.verified));

CREATE VIEW public.v_payout_stub AS
 SELECT p.id,
    a.email,
    p.bank_name,
    p.holder_name,
    p.verified_at
   FROM (public.payout_accounts p
     JOIN public.accounts a ON ((a.id = p.account_id)))
  WHERE (p.is_stub AND p.verified);

CREATE VIEW public.v_pending_decisions AS
 SELECT code,
    title,
    depends_on,
    risk,
    note
   FROM public.pending_decisions
  ORDER BY
        CASE risk
            WHEN 'HIGH'::text THEN 1
            WHEN 'MEDIUM'::text THEN 2
            ELSE 3
        END, code;

CREATE VIEW public.v_persona_orphan_history AS
 SELECT account_id,
    count(*) AS decisions,
    max(decided_at) AS last_at
   FROM public.ai_decisions d
  WHERE ((kind = 'PRF'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.member_ad_profiles p
          WHERE (p.account_id = d.account_id)))))
  GROUP BY account_id;

CREATE VIEW public.v_point_redeemable_violation AS
 SELECT l.id,
    l.account_id,
    l.rule_code,
    l.points
   FROM ((public.point_ledger l
     JOIN public.point_rules pr ON ((pr.code = l.rule_code)))
     LEFT JOIN public.introduction_connections c ON ((c.id = l.connection_id)))
  WHERE (l.redeemable AND pr.needs_valid AND (COALESCE(c.is_valid, false) IS NOT TRUE));

CREATE VIEW public.v_post_badges AS
 SELECT 'REQUEST'::text AS kind,
    r.id,
    r.title,
    r.gwan_code,
    r.item_type,
        CASE
            WHEN (r.item_type = ANY (ARRAY['PERSON'::text, 'COMPANY'::text])) THEN 'INTRO_WANT'::text
            ELSE 'WANTED'::text
        END AS badge,
    r.created_at
   FROM public.requests r
  WHERE (r.status = 'PUBLISHED'::text)
UNION ALL
 SELECT 'LISTING'::text AS kind,
    l.id,
    l.title,
    l.gwan_code,
    l.item_type,
    'ON_SALE'::text AS badge,
    l.created_at
   FROM public.listings l
  WHERE (l.status = 'PUBLISHED'::text);

CREATE VIEW public.v_privacy_inventory AS
 SELECT '회원 계정'::text AS category,
    'accounts'::text AS location,
    count(*) FILTER (WHERE (accounts.purged_at IS NULL)) AS active,
    0 AS pending_purge,
    count(*) FILTER (WHERE (accounts.purged_at IS NOT NULL)) AS purged,
    '이메일·성명·전화'::text AS items,
    '탈퇴 후 거래이력 有 5년 / 無 즉시'::text AS retention
   FROM public.accounts
UNION ALL
 SELECT '본인인증'::text AS category,
    'identity_verifications'::text AS location,
    count(*) FILTER (WHERE (identity_verifications.ci_hash IS NOT NULL)) AS active,
    0 AS pending_purge,
    count(*) FILTER (WHERE (identity_verifications.ci_hash IS NULL)) AS purged,
    'CI 해시 (원문 미보관)'::text AS items,
    '계정 파기 시 함께'::text AS retention
   FROM public.identity_verifications
UNION ALL
 SELECT '사업장 주소'::text AS category,
    'businesses'::text AS location,
    count(*) FILTER (WHERE (b.sido IS NOT NULL)) AS active,
    0 AS pending_purge,
    count(*) FILTER (WHERE (b.sido IS NULL)) AS purged,
    '우편번호·도로명·시군구·상세주소 (개인사업자는 자택인 경우 있음)'::text AS items,
    '계정 파기 시 함께'::text AS retention
   FROM public.businesses b
UNION ALL
 SELECT '접속 기록'::text AS category,
    'audit.audit_logs'::text AS location,
    count(*) FILTER (WHERE (audit_logs.ip IS NOT NULL)) AS active,
    0 AS pending_purge,
    count(*) FILTER (WHERE (audit_logs.ip IS NULL)) AS purged,
    'IP·User-Agent'::text AS items,
    '1년 후 마스킹'::text AS retention
   FROM audit.audit_logs
UNION ALL
 SELECT '유입 기록'::text AS category,
    'attribution_events'::text AS location,
    count(*) FILTER (WHERE (attribution_events.ip_hash IS NOT NULL)) AS active,
    0 AS pending_purge,
    count(*) FILTER (WHERE (attribution_events.ip_hash IS NULL)) AS purged,
    'IP 해시·방문자키'::text AS items,
    '만료 90일 후 제거'::text AS retention
   FROM public.attribution_events
UNION ALL
 SELECT '관심 성향'::text AS category,
    'member_ad_profiles'::text AS location,
    count(*) AS active,
    0 AS pending_purge,
    0 AS purged,
    '6문항 답변·세그먼트 (선택 · 동의 필수)'::text AS items,
    '이용자가 해지하면 즉시 삭제 / 계정 파기 시 함께'::text AS retention
   FROM public.member_ad_profiles
UNION ALL
 SELECT '소개자 프로필'::text AS category,
    'introducer_profiles'::text AS location,
    count(*) AS active,
    0 AS pending_purge,
    0 AS purged,
    '활동지역·소개 가능 분야·대상 유형'::text AS items,
    '계정 파기 시 함께'::text AS retention
   FROM public.introducer_profiles
UNION ALL
 SELECT '소개 초대'::text AS category,
    'introduction_invites'::text AS location,
    count(*) FILTER (WHERE (i.state <> ALL (ARRAY['EXPIRED'::text, 'DECLINED'::text]))) AS active,
    0 AS pending_purge,
    count(*) FILTER (WHERE (i.state = ANY (ARRAY['EXPIRED'::text, 'DECLINED'::text]))) AS purged,
    '초대 대상 표기명 (연락처는 발송 후 즉시 파기)'::text AS items,
    '동의 시 연결 기록으로 / 미동의 시 14일 후 만료'::text AS retention
   FROM public.introduction_invites i;

CREATE VIEW public.v_promo_cohort AS
 SELECT (date_trunc('week'::text, promo_ends_at))::date AS ends_week,
    count(*) AS subscriptions,
    count(*) FILTER (WHERE (promo_notified_at IS NULL)) AS not_notified,
    sum(( SELECT count(*) AS count
           FROM public.listings l
          WHERE ((l.owner_account_id = s.account_id) AND (l.status = 'PUBLISHED'::text)))) AS listings_at_risk
   FROM public.subscriptions s
  WHERE (is_promo AND (promo_ends_at IS NOT NULL))
  GROUP BY ((date_trunc('week'::text, promo_ends_at))::date)
  ORDER BY ((date_trunc('week'::text, promo_ends_at))::date);

CREATE VIEW public.v_property_address_leak AS
 SELECT column_name
   FROM information_schema.columns
  WHERE (((table_schema)::name = 'public'::name) AND ((table_name)::name = 'property_listings'::name) AND ((column_name)::name ~ 'detail|dong|ho_|unit'::text));

CREATE VIEW public.v_property_pending AS
 SELECT p.listing_id,
    l.title,
    b.company_name AS company,
    p.broker_reg_no,
    p.address_sido,
    p.address_sigungu,
    p.deal_type,
    p.price,
    p.area_m2,
    (EXISTS ( SELECT 1
           FROM (public.qualification_reviews q
             JOIN public.businesses b2 ON ((b2.id = q.business_id)))
          WHERE ((b2.account_id = l.owner_account_id) AND (q.category_code = 'BROKER'::text) AND (q.state = 'APPROVED'::text)))) AS broker_ok,
    p.created_at
   FROM ((public.property_listings p
     JOIN public.listings l ON ((l.id = p.listing_id)))
     LEFT JOIN public.businesses b ON ((b.account_id = l.owner_account_id)))
  WHERE ((p.verified_at IS NULL) AND (p.reject_reason IS NULL))
  ORDER BY p.created_at;

CREATE VIEW public.v_property_unqualified AS
 SELECT p.listing_id,
    p.broker_reg_no
   FROM (public.property_listings p
     JOIN public.listings l ON ((l.id = p.listing_id)))
  WHERE ((p.verified_at IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM (public.qualification_reviews q
             JOIN public.businesses b2 ON ((b2.id = q.business_id)))
          WHERE ((b2.account_id = l.owner_account_id) AND (q.category_code = 'BROKER'::text) AND (q.state = 'APPROVED'::text))))));

CREATE VIEW public.v_ptn_approval_gap AS
 SELECT 'PARTNER'::text AS kind,
    (p.id)::text AS ref,
    '승인자 없이 활성'::text AS issue
   FROM public.partners p
  WHERE ((p.status = 'ACTIVE'::text) AND ((p.approved_by IS NULL) OR (p.approved_at IS NULL)))
UNION ALL
 SELECT 'SERVICE'::text AS kind,
    (s.id)::text AS ref,
    '사유 없이 반려'::text AS issue
   FROM public.partner_services s
  WHERE ((s.status = 'REJECTED'::text) AND (COALESCE(btrim(s.reject_reason), ''::text) = ''::text))
UNION ALL
 SELECT 'LEAD_FEE'::text AS kind,
    (f.id)::text AS ref,
    '규칙 없이 무효'::text AS issue
   FROM public.lead_fees f
  WHERE ((f.voided_at IS NOT NULL) AND (COALESCE(btrim(f.void_rule), ''::text) = ''::text));

CREATE VIEW public.v_purge_overdue AS
 SELECT id,
    withdrawn_at,
    retention_until,
    (CURRENT_DATE - retention_until) AS days_overdue
   FROM public.accounts
  WHERE ((withdrawn_at IS NOT NULL) AND (purged_at IS NULL) AND (retention_until < CURRENT_DATE))
  ORDER BY retention_until;

CREATE VIEW public.v_qualification_no_lookup AS
 SELECT id,
    business_id,
    category_code
   FROM public.qualification_reviews
  WHERE ((state = 'APPROVED'::text) AND (NOT lookup_done));

CREATE VIEW public.v_qualification_pending AS
 SELECT q.id,
    b.company_name AS company,
    q.category_code,
    r.category_name,
    q.doc_no,
    q.lookup_done,
    q.created_at,
    r.required_doc,
    r.legal_basis
   FROM ((public.qualification_reviews q
     JOIN public.businesses b ON ((b.id = q.business_id)))
     JOIN public.qualification_rules r ON ((r.category_code = q.category_code)))
  WHERE (q.state = 'PENDING'::text)
  ORDER BY q.created_at;

CREATE VIEW public.v_rate_partial AS
 SELECT gwan_code,
    count(*) AS grades
   FROM public.lead_grade_rates
  WHERE (gwan_code IS NOT NULL)
  GROUP BY gwan_code
 HAVING (count(*) <> ( SELECT count(*) AS count
           FROM public.lead_grade_rates lead_grade_rates_1
          WHERE (lead_grade_rates_1.gwan_code IS NULL)));

CREATE VIEW public.v_recommend_weight_sum AS
 SELECT (sum(weight))::integer AS total,
    (sum(weight) = 100) AS is_hundred
   FROM public.recommend_weights;

CREATE VIEW public.v_referral_fee_hard_deps AS
 SELECT proname AS routine
   FROM pg_proc p
  WHERE ((pronamespace = ('public'::regnamespace)::oid) AND (prosrc ~~ '%fee_agreements%'::text) AND (prosrc ~~ '%RAISE EXCEPTION%'::text) AND (prosrc !~~ '%fn_feature_on%'::text) AND (proname <> 'fn_block_fee_agreement_when_off'::name));

CREATE VIEW public.v_referral_fee_leak AS
 SELECT id,
    deal_id,
    status,
    requested_at
   FROM public.settlements s
  WHERE ((NOT public.fn_feature_on('referral_fee'::text)) AND (status = 'REQUESTED'::text));

CREATE VIEW public.v_refund_scope AS
 SELECT '구독료'::text AS item,
    '통신판매업자'::text AS role,
    true AS refundable,
    '우리가 직접 받으므로 청약철회 대상입니다 (전자상거래법 17조)'::text AS note
UNION ALL
 SELECT '리드 이용료'::text AS item,
    '통신판매업자'::text AS role,
    true AS refundable,
    '정보 이용료입니다. 열람 전이면 환불, 열람 후에는 정보가 이미 전달되었습니다'::text AS note
UNION ALL
 SELECT '광고료'::text AS item,
    '통신판매업자'::text AS role,
    true AS refundable,
    '기간 계약이므로 미노출 기간은 환불 대상입니다'::text AS note
UNION ALL
 SELECT '소개비'::text AS item,
    '통신판매중개자'::text AS role,
    false AS refundable,
    '★ 당사자끼리 직접 주고받습니다(INV-9R·INV-11). 우리가 받지 않으므로 환불할 대상도 없습니다 — 분쟁은 당사자 간에 해결합니다'::text AS note;

CREATE VIEW public.v_refund_violation AS
 SELECT id,
    account_id,
    plan_code,
    (current_period_start)::date AS paid_on,
    (refunded_at)::date AS refunded_on,
    (COALESCE(request_views_used, 0) + COALESCE(codes_used_this_period, 0)) AS used
   FROM public.subscriptions
  WHERE ((refunded_at IS NOT NULL) AND (((current_period_start)::date <> (refunded_at)::date) OR ((COALESCE(request_views_used, 0) + COALESCE(codes_used_this_period, 0)) > 0)));

CREATE VIEW public.v_report_not_escalated AS
 SELECT r.target_id,
    r.reason_code,
    count(DISTINCT r.reporter_id) AS reporters,
    rr.auto_queue_at
   FROM (public.reports r
     JOIN public.report_reasons rr ON ((rr.code = r.reason_code)))
  WHERE ((r.state = ANY (ARRAY['OPEN'::text, 'QUEUED'::text])) AND (r.target_type = 'LISTING'::text))
  GROUP BY r.target_id, r.reason_code, rr.auto_queue_at
 HAVING ((count(DISTINCT r.reporter_id) >= rr.auto_queue_at) AND (NOT (EXISTS ( SELECT 1
           FROM public.review_items ri
          WHERE ((ri.target_id = r.target_id) AND (ri.status = 'QUEUED'::text))))));

CREATE VIEW public.v_report_pending AS
 SELECT r.id,
    r.target_type,
    r.target_id,
    r.reason_code,
    rr.label,
    rr.severity,
    r.detail,
    r.state,
    r.created_at,
    ( SELECT count(DISTINCT x.reporter_id) AS count
           FROM public.reports x
          WHERE ((x.target_type = r.target_type) AND (x.target_id = r.target_id))) AS reporters
   FROM (public.reports r
     JOIN public.report_reasons rr ON ((rr.code = r.reason_code)))
  WHERE (r.state = ANY (ARRAY['OPEN'::text, 'QUEUED'::text]))
  ORDER BY
        CASE rr.severity
            WHEN 'HIGH'::text THEN 1
            WHEN 'MEDIUM'::text THEN 2
            ELSE 3
        END, r.created_at;

CREATE VIEW public.v_report_reasons_for_gwan AS
 SELECT g.code AS gwan_code,
    r.code,
    r.label,
    r.severity,
    r.auto_queue_at,
    (r.gwan_code IS NOT NULL) AS is_gwan_specific
   FROM (public.gwans g
     JOIN public.report_reasons r ON (((r.gwan_code IS NULL) OR (r.gwan_code = g.code))))
  WHERE g.is_active
  ORDER BY g.code, r.sort_order;

CREATE VIEW public.v_report_stale AS
 SELECT id,
    target_type,
    target_id,
    reason_code,
    created_at
   FROM public.reports
  WHERE ((state = ANY (ARRAY['OPEN'::text, 'QUEUED'::text])) AND (created_at < (now() - '3 days'::interval)));

CREATE VIEW public.v_restrict_no_vocab AS
 SELECT DISTINCT code,
    name
   FROM public.restricted_industries r
  WHERE (is_active AND (mode = ANY (ARRAY['BLOCK'::text, 'AD_ONLY'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.restrict_vocab v
          WHERE (v.code = r.code)))));

CREATE VIEW public.v_restricted_still_public AS
 SELECT l.id,
    l.title,
    c.name AS category,
    c.restricted_code
   FROM (public.listings l
     JOIN public.categories c ON ((c.id = l.category_id)))
  WHERE ((c.restricted_code IS NOT NULL) AND (l.status = 'PUBLISHED'::text));

CREATE VIEW public.v_restricted_unlinked AS
 SELECT gwan_code,
    code,
    name,
    mode
   FROM public.restricted_industries r
  WHERE (is_active AND (mode = ANY (ARRAY['BLOCK'::text, 'AD_ONLY'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.categories c
          WHERE ((c.gwan_code = r.gwan_code) AND (c.restricted_code = r.code) AND (c.status = ANY (ARRAY['APPROVED'::text, 'PENDING'::text])))))));

CREATE VIEW public.v_restriction_scope AS
 SELECT code,
    name,
    mode,
    COALESCE(gwan_code, '(전 관 공통)'::text) AS scope,
    legal_basis
   FROM public.restricted_industries
  WHERE is_active
  ORDER BY code, gwan_code NULLS FIRST;

CREATE VIEW public.v_revenue_leak AS
 SELECT 'success_fee'::text AS source,
    count(*) AS recent_rows,
    public.fn_feature_on('success_fee'::text) AS switch_on
   FROM public.success_fees
  WHERE (created_at > (now() - '7 days'::interval))
 HAVING ((count(*) > 0) AND (NOT public.fn_feature_on('success_fee'::text)));

CREATE VIEW public.v_revenue_model AS
 SELECT '월 구독료'::text AS source,
    true AS active,
    ( SELECT count(*) AS count
           FROM public.subscriptions
          WHERE (subscriptions.status = 'ACTIVE'::text)) AS rows,
    '회원등급별 월 정액'::text AS note
UNION ALL
 SELECT '성사 수수료'::text AS source,
    public.fn_feature_on('success_fee'::text) AS active,
    ( SELECT count(*) AS count
           FROM public.success_fees) AS rows,
    '거래 확정 시 등급별 정액'::text AS note
UNION ALL
 SELECT '소개비'::text AS source,
    public.fn_feature_on('referral_fee'::text) AS active,
    0 AS rows,
    '당사자 간 직접 지급 — 플랫폼 매출 아님'::text AS note;

CREATE VIEW public.v_revenue_summary AS
 SELECT '월 회비'::text AS source,
    COALESCE(sum(i.amount), (0)::numeric) AS amount,
    count(*) AS cnt
   FROM public.subscription_invoices i
  WHERE (i.status = 'PAID'::text)
UNION ALL
 SELECT '성사 수수료'::text AS source,
    COALESCE(sum(f.amount), (0)::numeric) AS amount,
    count(*) AS cnt
   FROM public.success_fees f
  WHERE (f.status = ANY (ARRAY['BILLED'::text, 'PAID'::text]));

CREATE VIEW public.v_review_automation AS
 SELECT (count(*))::integer AS total,
    (count(*) FILTER (WHERE (decision_mode = 'AUTO'::text)))::integer AS auto_cnt,
    round(((100.0 * (count(*) FILTER (WHERE (decision_mode = 'AUTO'::text)))::numeric) / (NULLIF(count(*), 0))::numeric), 1) AS auto_pct,
    (count(*) FILTER (WHERE (status = 'QUEUED'::text)))::integer AS queued,
    (count(*) FILTER (WHERE ((status = 'QUEUED'::text) AND (sla_due_at < now()))))::integer AS sla_over
   FROM public.review_items
  WHERE (submitted_at > (now() - '30 days'::interval));

CREATE VIEW public.v_review_no_event AS
 SELECT id,
    target_type,
    status,
    decided_at
   FROM public.review_items ri
  WHERE ((status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM public.review_events e
          WHERE ((e.review_item_id = ri.id) AND (e.event = ri.status))))));

CREATE VIEW public.v_review_throughput AS
 SELECT (date_trunc('day'::text, submitted_at))::date AS day,
    count(*) AS submitted,
    count(*) FILTER (WHERE (decided_at IS NOT NULL)) AS decided,
    count(*) FILTER (WHERE (status = ANY (ARRAY['QUEUED'::text, 'IN_PROGRESS'::text]))) AS pending,
    count(*) FILTER (WHERE (decided_at > sla_due_at)) AS sla_breached,
    round(avg((EXTRACT(epoch FROM (decided_at - submitted_at)) / (3600)::numeric)), 1) AS avg_hours
   FROM public.review_items
  GROUP BY ((date_trunc('day'::text, submitted_at))::date);

CREATE VIEW public.v_risk_dormant AS
 SELECT code,
    name,
    severity
   FROM public.risk_rules
  WHERE (is_active AND (NOT auto_detect));

CREATE VIEW public.v_risk_effectiveness AS
 SELECT r.code,
    r.name,
    r.severity,
    r.is_active,
    r.auto_detect,
    count(a.id) AS raised,
    count(a.id) FILTER (WHERE (a.state = 'FALSE_POSITIVE'::text)) AS false_pos,
    count(a.id) FILTER (WHERE (a.state = 'CLOSED'::text)) AS closed,
    count(a.id) FILTER (WHERE (a.state = ANY (ARRAY['OPEN'::text, 'REVIEWING'::text]))) AS pending,
    count(DISTINCT ac.id) AS actions,
    round(((100.0 * (count(a.id) FILTER (WHERE (a.state = 'FALSE_POSITIVE'::text)))::numeric) / (NULLIF(count(a.id), 0))::numeric), 1) AS fp_rate
   FROM ((public.risk_rules r
     LEFT JOIN public.risk_alerts a ON ((a.rule_code = r.code)))
     LEFT JOIN public.risk_actions ac ON ((ac.alert_id = a.id)))
  GROUP BY r.code, r.name, r.severity, r.is_active, r.auto_detect, r.sort_order
  ORDER BY r.sort_order;

CREATE VIEW public.v_risk_rule_broken AS
 SELECT rule_code,
    detail,
    occurred_at
   FROM public.risk_alerts a
  WHERE ((subject ~~ 'rule:%'::text) AND (state = ANY (ARRAY['OPEN'::text, 'REVIEWING'::text])));

CREATE VIEW public.v_risk_unattended AS
 SELECT id,
    rule_code,
    severity,
    subject,
    occurred_at,
    (now() - occurred_at) AS pending_for
   FROM public.risk_alerts a
  WHERE ((state = ANY (ARRAY['OPEN'::text, 'REVIEWING'::text])) AND (occurred_at < (now() - '3 days'::interval)) AND (NOT (EXISTS ( SELECT 1
           FROM public.risk_actions x
          WHERE (x.alert_id = a.id)))))
  ORDER BY severity DESC, occurred_at;

CREATE VIEW public.v_role_holders AS
 SELECT a.id AS account_id,
    a.email,
    a.name,
    string_agg(r.role, ','::text ORDER BY r.role) AS roles,
    ( SELECT max(c.changed_at) AS max
           FROM public.role_changes c
          WHERE (c.account_id = a.id)) AS last_change
   FROM (public.accounts a
     JOIN public.account_roles r ON ((r.account_id = a.id)))
  WHERE (r.role = ANY (ARRAY['ADMIN'::text, 'SUPER'::text, 'REVIEWER'::text]))
  GROUP BY a.id, a.email, a.name;

CREATE VIEW public.v_scope_map AS
 WITH t AS (
         SELECT 'banned_words'::text AS table_name,
            '금칙어'::text AS label
        UNION ALL
         SELECT 'restricted_industries'::text AS text,
            '제한업종'::text AS text
        UNION ALL
         SELECT 'categories'::text AS text,
            '업종'::text AS text
        UNION ALL
         SELECT 'fee_guidelines'::text AS text,
            '소개비 기준'::text AS text
        UNION ALL
         SELECT 'ad_slots'::text AS text,
            '광고 슬롯'::text AS text
        UNION ALL
         SELECT 'gwan_form_copy'::text AS text,
            '등록 폼 문구'::text AS text
        UNION ALL
         SELECT 'faqs'::text AS text,
            '자주 묻는 질문'::text AS text
        UNION ALL
         SELECT 'notices'::text AS text,
            '공지'::text AS text
        )
 SELECT table_name,
    label,
    ((((( SELECT count(*) AS count
           FROM public.banned_words w
          WHERE ((t.table_name = 'banned_words'::text) AND (w.gwan_code IS NULL))) + ( SELECT count(*) AS count
           FROM public.restricted_industries r
          WHERE ((t.table_name = 'restricted_industries'::text) AND (r.gwan_code IS NULL)))) + ( SELECT count(*) AS count
           FROM public.ad_slots s
          WHERE ((t.table_name = 'ad_slots'::text) AND (s.gwan_code IS NULL)))) + ( SELECT count(*) AS count
           FROM public.faqs f
          WHERE ((t.table_name = 'faqs'::text) AND (f.gwan_code IS NULL)))) + ( SELECT count(*) AS count
           FROM public.notices n
          WHERE ((t.table_name = 'notices'::text) AND (n.gwan_code IS NULL)))) AS shared_rows
   FROM t;

CREATE VIEW public.v_search_sanity AS
 SELECT ( SELECT count(*) AS count
           FROM public.listings
          WHERE ((listings.status = 'PUBLISHED'::text) AND (listings.title ~~ '%상가%'::text))) AS like_hits,
    ( SELECT count(*) AS count
           FROM public.listings
          WHERE ((listings.status = 'PUBLISHED'::text) AND public.fn_search_match(listings.title, listings.body, '상가'::text))) AS fn_hits,
    ( SELECT count(*) AS count
           FROM public.listings
          WHERE ((listings.status = 'PUBLISHED'::text) AND (listings.title OPERATOR(public.%) '상가'::text))) AS trgm_hits;

CREATE VIEW public.v_secret_in_db AS
 SELECT 'site_settings'::text AS location,
    site_settings.key AS item
   FROM public.site_settings
  WHERE (site_settings.value ~ '^[0-9a-fA-F]{32,}$'::text)
UNION ALL
 SELECT 'integrations'::text AS location,
    integrations.code AS item
   FROM public.integrations
  WHERE (integrations.memo ~ '[0-9a-fA-F]{32,}'::text);

CREATE VIEW public.v_settlement_label_gap AS
 WITH allowed AS (
         SELECT unnest(ARRAY['REQUESTED'::text, 'PAID'::text, 'HELD'::text, 'REJECTED'::text]) AS code
        )
 SELECT a.code,
    (l.code IS NULL) AS label_missing
   FROM (allowed a
     LEFT JOIN public.code_labels l ON (((l.domain = 'settlement.status'::text) AND (l.code = a.code))))
  WHERE (l.code IS NULL)
UNION ALL
 SELECT l.code,
    false AS label_missing
   FROM public.code_labels l
  WHERE ((l.domain = 'settlement.status'::text) AND (NOT (l.code IN ( SELECT allowed.code
           FROM allowed))));

CREATE VIEW public.v_signup_order AS
 SELECT code,
    label,
    sub,
    needs_biz,
    needs_corp,
    sort_order
   FROM public.signup_types
  ORDER BY sort_order;

CREATE VIEW public.v_sms_over_limit AS
 SELECT code,
    length(body) AS chars,
    octet_length(body) AS bytes
   FROM public.notification_templates
  WHERE ((channel = 'SMS'::text) AND (octet_length(body) > 90));

CREATE VIEW public.v_subscription_cancelling AS
 SELECT id,
    account_id,
    plan_code,
    cancel_at,
    current_period_end,
    (current_period_end - now()) AS remaining
   FROM public.subscriptions s
  WHERE ((cancel_at IS NOT NULL) AND (status = 'ACTIVE'::text) AND (current_period_end > now()));

CREATE VIEW public.v_success_fee_due AS
 SELECT f.id,
    f.deal_id,
    f.payer_account_id,
    a.name AS payer_name,
    f.plan_code,
    f.amount,
    f.status,
    f.created_at
   FROM (public.success_fees f
     JOIN public.accounts a ON ((a.id = f.payer_account_id)))
  WHERE (f.status = 'BILLED'::text)
  ORDER BY f.created_at;

CREATE VIEW public.v_term_not_agreed AS
 SELECT a.id AS account_id,
    a.email,
    t.code,
    t.title
   FROM (public.accounts a
     CROSS JOIN public.terms t)
  WHERE ((t.status = 'PUBLISHED'::text) AND t.is_required AND (a.status = 'ACTIVE'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.term_agreements g
          WHERE ((g.account_id = a.id) AND (g.term_code = t.code) AND (g.term_version = t.version) AND g.agreed)))));

CREATE VIEW public.v_trust_scores AS
 SELECT a.id AS account_id,
    a.name,
    a.account_type,
    t.score,
    t.sample,
    t.detail
   FROM (public.accounts a
     CROSS JOIN LATERAL public.fn_trust_score(a.id) t(score, sample, detail))
  WHERE (a.status = 'ACTIVE'::text);

CREATE VIEW public.v_trust_thin_sample AS
 SELECT account_id,
    name,
    score,
    sample
   FROM public.v_trust_scores
  WHERE ((sample < 3) AND (score > (60)::numeric));

CREATE OR REPLACE VIEW public.v_ad_serving AS
 SELECT c.id,
    c.creative_code,
    c.advertiser,
    c.title,
    c.body,
    c.cta,
    c.landing_route,
    c.slot_code,
    c.category,
    COALESCE(array_agg(s.segment_code) FILTER (WHERE (s.segment_code IS NOT NULL)), '{}'::text[]) AS segments
   FROM (public.ad_placements c
     LEFT JOIN public.ad_creative_segments s ON ((s.creative_id = c.id)))
  WHERE ((c.status = 'ACTIVE'::text) AND ((c.starts_at IS NULL) OR (c.starts_at <= now())) AND ((c.ends_at IS NULL) OR (c.ends_at >= now())))
  GROUP BY c.id;
