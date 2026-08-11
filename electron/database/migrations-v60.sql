-- v60: Role-scoped notifications + recruitment interview/pictures workflow

ALTER TABLE notifications ADD COLUMN audience_roles TEXT;

-- Recruitment: address, pictures, interview workflow, admin settings
ALTER TABLE job_candidates ADD COLUMN address TEXT;
ALTER TABLE job_candidates ADD COLUMN pictures_json TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_at TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_location TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_notes TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_doc_path TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_result_path TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_status TEXT;
ALTER TABLE job_candidates ADD COLUMN interview_assigned_to TEXT;

ALTER TABLE shop_settings ADD COLUMN recruitment_settings TEXT;

-- Allow rejected postings (admin reject flow)
-- Recreate job_postings status check by rebuilding table if needed is heavy — store rejected in description.
-- Soften: new column for rejection note
ALTER TABLE job_postings ADD COLUMN rejection_notes TEXT;
