ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS clinical_indication text,
  ADD COLUMN IF NOT EXISTS specimen_type text,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'Routine',
  ADD COLUMN IF NOT EXISTS clinical_notes text;