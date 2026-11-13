-- 0085 — dialysis is a facility service category.
--
-- 0053 closed the category list before the renal unit existed. A dialysis
-- session could be priced only by mislabelling it a PROCEDURE or OTHER, which
-- would misreport where the facility's revenue comes from.
--
-- The list stays closed: this adds exactly one value, and the DIALYSIS billing
-- family is the only thing that resolves it.

ALTER TABLE facility_services DROP CONSTRAINT IF EXISTS facility_services_category_check;

ALTER TABLE facility_services
  ADD CONSTRAINT facility_services_category_check
  CHECK ("category" IN (
    'CONSULTATION','LABORATORY','RADIOLOGY','PHARMACY','PROCEDURE',
    'ADMISSION','BED_DAY','DELIVERY','DIALYSIS','OTHER'
  ));
