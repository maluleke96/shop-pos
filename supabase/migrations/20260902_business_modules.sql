-- Business Modules — Investor, Release Centre, AI Meeting Centre (Postgres)

CREATE TABLE IF NOT EXISTS public.biz_module_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  investor_enabled INTEGER DEFAULT 1,
  release_enabled INTEGER DEFAULT 1,
  meeting_enabled INTEGER DEFAULT 1,
  meeting_retention_days INTEGER DEFAULT 365,
  meeting_ai_provider TEXT DEFAULT 'none',
  meeting_ai_api_key_set INTEGER DEFAULT 0,
  release_preview_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.biz_module_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.investors (
  id BIGSERIAL PRIMARY KEY,
  investor_code TEXT UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  investment_amount DOUBLE PRECISION DEFAULT 0,
  equity_percent DOUBLE PRECISION DEFAULT 0,
  profit_share_percent DOUBLE PRECISION DEFAULT 0,
  agreement_date TEXT,
  status TEXT DEFAULT 'active',
  terms_json TEXT DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_portal_users (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.investor_portal_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investment_proposals (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT REFERENCES public.investors(id),
  title TEXT NOT NULL,
  business_info TEXT,
  amount_requested DOUBLE PRECISION DEFAULT 0,
  amount_offered DOUBLE PRECISION DEFAULT 0,
  percent_offered DOUBLE PRECISION DEFAULT 0,
  return_arrangement TEXT,
  duration TEXT,
  investor_responsibilities TEXT,
  business_responsibilities TEXT,
  terms TEXT,
  risks TEXT,
  notes TEXT,
  status TEXT DEFAULT 'draft',
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investment_agreements (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  proposal_id BIGINT REFERENCES public.investment_proposals(id),
  title TEXT NOT NULL,
  file_path TEXT,
  status TEXT DEFAULT 'DRAFT',
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_documents (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  agreement_id BIGINT REFERENCES public.investment_agreements(id),
  doc_type TEXT DEFAULT 'general',
  title TEXT NOT NULL,
  file_path TEXT,
  uploaded_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_payments (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_type TEXT DEFAULT 'contribution',
  reference TEXT,
  notes TEXT,
  paid_at TIMESTAMPTZ,
  recorded_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_distributions (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  distribution_type TEXT DEFAULT 'return',
  reference TEXT,
  notes TEXT,
  paid_at TIMESTAMPTZ,
  recorded_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_announcements (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT,
  title TEXT NOT NULL,
  body TEXT,
  is_global INTEGER DEFAULT 0,
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.investor_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  investor_id BIGINT,
  user_id BIGINT,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT DEFAULT 'investor',
  entity_type TEXT,
  entity_id BIGINT,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_centre_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  permissions_json TEXT DEFAULT '{}',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.release_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_versions (
  id BIGSERIAL PRIMARY KEY,
  version_number TEXT NOT NULL,
  release_name TEXT,
  description TEXT,
  changes_json TEXT DEFAULT '[]',
  developer_id BIGINT,
  developer_name TEXT,
  test_run_id BIGINT,
  approval_status TEXT DEFAULT 'pending',
  published_status TEXT DEFAULT 'draft',
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  deployment_result TEXT,
  rollback_of BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_test_runs (
  id BIGSERIAL PRIMARY KEY,
  version_id BIGINT REFERENCES public.release_versions(id),
  run_by BIGINT,
  run_by_name TEXT,
  total_tests INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  warnings INTEGER DEFAULT 0,
  critical INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  environment TEXT DEFAULT 'preview',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_test_results (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES public.release_test_runs(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL,
  test_label TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  duration_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_deployments (
  id BIGSERIAL PRIMARY KEY,
  version_id BIGINT NOT NULL REFERENCES public.release_versions(id),
  deployed_by BIGINT,
  deployed_by_name TEXT,
  environment TEXT DEFAULT 'production',
  result TEXT DEFAULT 'pending',
  log_text TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.release_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT DEFAULT 'release',
  entity_type TEXT,
  entity_id BIGINT,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_centre_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'meeting_user',
  is_active INTEGER DEFAULT 1,
  permissions_json TEXT DEFAULT '{}',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.meeting_centre_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meetings (
  id BIGSERIAL PRIMARY KEY,
  meeting_code TEXT UNIQUE,
  title TEXT NOT NULL,
  meeting_date TEXT,
  meeting_time TEXT,
  location TEXT,
  category TEXT,
  agenda TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled',
  organizer_id BIGINT,
  organizer_name TEXT,
  join_token TEXT,
  recording_consent INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id BIGINT,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'participant',
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.meeting_recordings (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  file_path TEXT,
  mime_type TEXT DEFAULT 'audio/webm',
  size_bytes BIGINT DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  storage_status TEXT DEFAULT 'stored',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_transcripts (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  recording_id BIGINT REFERENCES public.meeting_recordings(id),
  content_json TEXT DEFAULT '[]',
  raw_text TEXT,
  ai_processed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_minutes (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  content_html TEXT,
  content_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  finalized_by BIGINT,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_extracted_points (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  point_type TEXT NOT NULL,
  speaker_name TEXT,
  content TEXT NOT NULL,
  amount DOUBLE PRECISION,
  deadline TEXT,
  responsible_person TEXT,
  timestamp_ms BIGINT,
  confidence TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_action_items (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  person TEXT,
  task TEXT NOT NULL,
  deadline TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  sender_name TEXT,
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT,
  user_id BIGINT,
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT DEFAULT 'meeting',
  entity_type TEXT,
  entity_id BIGINT,
  details_json TEXT DEFAULT '{}',
  result TEXT DEFAULT 'ok',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investors_status ON public.investors(status);
CREATE INDEX IF NOT EXISTS idx_investment_agreements_status ON public.investment_agreements(status);
CREATE INDEX IF NOT EXISTS idx_release_versions_number ON public.release_versions(version_number);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON public.meetings(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meeting_extracted_type ON public.meeting_extracted_points(point_type);
