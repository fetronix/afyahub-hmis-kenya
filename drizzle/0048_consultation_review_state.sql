-- Old encounters retain their previous behaviour. New explicitly unselected visits require review.
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "consultation_selection_review_required" boolean NOT NULL DEFAULT false;
