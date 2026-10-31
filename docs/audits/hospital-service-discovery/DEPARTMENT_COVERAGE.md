# Department coverage and billing trace

**Scope:** repository source snapshot at `b198db105442f24f84663a02bf53df9145803eb2`; no facility catalogue, price list, payer contract, patient record or production system was inspected. The named services below combine source evidence and explicit **facility-validation candidates**; they are not a declaration that any facility offers them. [Read the main audit](HOSPITAL_SERVICE_AND_BILLING_AUDIT.md) before using this report.

This report covers the requested areas in 28 rows by separating theatre and anaesthesia, plus 18 additional discovered clinical and support areas. No department is declared fully production-complete on source inspection alone. Each named service and its evidence/identity status is in the [master inventory](MASTER_SERVICE_INVENTORY.csv); each trace ID is resolved in [SERVICE_TRACES.csv](SERVICE_TRACES.csv). Shared services appear by reference in several departments but have only one owner row in the master. Facility tariff/activation and payer mappings are **not inspected** in every entry.

**Statuses:** `PARTIAL` = a real scoped part of a workflow exists, not a completed end-to-end service; `PARTIAL_SHARED_ONLY` = shared records/flows only; `SCREEN_ONLY` = navigation or examples, not a completed specialty workflow; `SCHEDULE_ONLY` = scheduling, not performed care; `REQUIREMENT_ONLY` = a stated requirement, not implementation; `LABEL_ONLY` = a label/seed, not implementation; `NOT_DEDICATED` = no dedicated service workflow found within the inspected repository (generic APIs may exist); `PLATFORM_PARTIAL` = supporting platform capability, not automatically a patient service. None means a facility does or does not offer the service.

## Requested departments

### Blood bank and transfusion medicine — PARTIAL_SHARED_ONLY

- **Identities for review:** ABO blood grouping; Rhesus blood typing; Blood compatibility crossmatch; Packed red-cell unit; Blood product storage and issue; Transfusion administration; Transfusion reaction assessment.
- **Clinical/operational evidence:** Patient/maternity blood group fields; lab ordering can accept a crossmatch; checklist mentions packed red cells. No blood-bank issue or transfusion workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** One shared lab test for crossmatch; group field, test, blood product and administration are different identities.
- **Trace(s):** `LAB_ORDER`, `NONE`. **Mapping and activation:** not inspected.
- **Next:** Confirm blood-bank catalogue, chain of custody, clinical workflow and lawful product/test/administration tariffs.
- **Evidence:** [src/db/schema/maternity.ts:72](../../../src/db/schema/maternity.ts#L72); [src/db/seed.ts:615](../../../src/db/seed.ts#L615); [src/routes/laboratory.routes.ts:87](../../../src/routes/laboratory.routes.ts#L87).

### ICU and HDU — PARTIAL_SHARED_ONLY

- **Identities for review:** ICU bed-day; HDU bed-day; Ventilated-bed equipment component; Critical-care clinician assessment; Critical-care monitoring; Nursing / clinical vital-sign observation.
- **Clinical/operational evidence:** Ward and bed labels can be configured; nursing/ward observations persist. No dedicated ICU/HDU clinical module established.
- **Billing:** BED_DAY attempt via shared ward accrual; no distinct ventilation/monitoring trigger.
- **Codes and overlaps:** ICU/HDU suggested as one ward type; special-bed generic fallback and bed-type omission are risks.
- **Trace(s):** `BED_DAY`, `OBSERVATION`. **Mapping and activation:** not inspected.
- **Next:** Configure ward-specific ICU/HDU services and review genuine equipment, monitoring and package rules.
- **Evidence:** [src/db/inpatient-contracts.ts:113](../../../src/db/inpatient-contracts.ts#L113); [src/db/queries/inpatient.ts:758](../../../src/db/queries/inpatient.ts#L758).

### Endoscopy — NOT_DEDICATED

- **Identities for review:** Histopathology examination of biopsy specimen; Diagnostic upper gastrointestinal endoscopy; Diagnostic colonoscopy; Endoscopic biopsy collection.
- **Clinical/operational evidence:** No dedicated endoscopy UI, event, catalogue or report path established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Reuse laboratory histopathology and avoid gastroenterology procedure duplicates.
- **Trace(s):** `NONE`, `PROCEDURE_API`, `LAB_ORDER`. **Mapping and activation:** not inspected.
- **Next:** Facility validates performed procedures and develops scoped clinical and billing workflow.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27); [src/routes/diagnoses.routes.ts:124](../../../src/routes/diagnoses.routes.ts#L124).

### Physiotherapy and rehabilitation — REQUIREMENT_ONLY

- **Identities for review:** Physiotherapy initial assessment; Physiotherapy follow-up session; Occupational therapy session; Speech and language therapy session.
- **Clinical/operational evidence:** Allied-health requirement is a requirement, not a clinical or billing workflow.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Facility validates allied-health services, sessions, workforce and applicable tariffs.
- **Evidence:** [src/compliance/dha-requirements.ts:211](../../../src/compliance/dha-requirements.ts#L211).

### Dental and oral health — SCREEN_ONLY

- **Identities for review:** Dental consultation; Tooth extraction; Dental restoration / filling; Dental scaling and cleaning.
- **Clinical/operational evidence:** Specialty navigation and patient record access only; screen explicitly says specialty notes and charges cannot be saved.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Build permitted dental documentation, procedure identities and billing only after facility validation.
- **Evidence:** [src/components/modules/SpecialtyModule.tsx:10](../../../src/components/modules/SpecialtyModule.tsx#L10).

### Ophthalmology and optometry — SCREEN_ONLY

- **Identities for review:** Eye consultation; Visual acuity assessment; Refraction / optometry assessment; Cataract surgery.
- **Clinical/operational evidence:** Optical specialty navigation is present; dedicated notes, tests and charges are unavailable.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Reuse inventory for lenses/frames.
- **Trace(s):** `NONE`, `INVENTORY`. **Mapping and activation:** not inspected.
- **Next:** Validate ophthalmic and optometry services, product identities and facility tariff.
- **Evidence:** [src/components/modules/SpecialtyModule.tsx:10](../../../src/components/modules/SpecialtyModule.tsx#L10); [src/db/schema/inventory.ts:35](../../../src/db/schema/inventory.ts#L35).

### Theatre and surgery — SCHEDULE_ONLY

- **Identities for review:** Laparoscopic cholecystectomy; Theatre room / operating suite use; Surgeon professional service; Anaesthesia professional service; General anaesthesia; Regional or spinal anaesthesia; Post-anaesthesia recovery care.
- **Clinical/operational evidence:** Scoped theatre booking, room, practitioner, reschedule and cancellation exist; seed case is a booking only.
- **Billing:** No theatre clinical completion/consumable/room charge; generic procedure API is not connected to booking and attempts charging at creation regardless of status.
- **Codes and overlaps:** No authoritative surgery code or bundle identity; avoid duplicated generic procedure, surgery, delivery and stock components.
- **Trace(s):** `THEATRE`, `PROCEDURE_API`. **Mapping and activation:** not inspected.
- **Next:** Complete approved perioperative event, surgical documentation and billing linkage without assuming checklists or automatic discharge.
- **Evidence:** [src/components/modules/TheatreModule.tsx:224](../../../src/components/modules/TheatreModule.tsx#L224); [src/routes/theatre-scheduling.routes.ts:151](../../../src/routes/theatre-scheduling.routes.ts#L151).

### Anaesthesia — NOT_DEDICATED

- **Identities for review:** Anaesthesia professional service; General anaesthesia; Regional or spinal anaesthesia; Post-anaesthesia recovery care.
- **Clinical/operational evidence:** Theatre practitioner / scheduled case is not an anaesthetic assessment, administration or completed procedure.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Surgeon, anaesthesia, room and package inclusion require separate governance.
- **Trace(s):** `THEATRE`, `NONE`. **Mapping and activation:** not inspected.
- **Next:** Validate professional and modality-specific clinical workflow, documented completion and tariff.
- **Evidence:** [src/theatre/scheduling.service.ts:1](../../../src/theatre/scheduling.service.ts#L1); [src/db/schema/theatre-scheduling.ts:1](../../../src/db/schema/theatre-scheduling.ts#L1).

### Neonatal and newborn — PARTIAL_SHARED_ONLY

- **Identities for review:** Neonatal cot / ward bed-day; Newborn assessment at delivery; Newborn resuscitation; Neonatal clinician consultation; Newborn phototherapy.
- **Clinical/operational evidence:** Birth and resuscitation fields under maternal delivery; no separate baby patient ID in delivery_babies.
- **Billing:** One DELIVERY charge per delivery to mother; no independent neonatal charge.
- **Codes and overlaps:** Neonatal cot is a suggested bed type; bed-day pricing uses ward, not individual cot subtype.
- **Trace(s):** `NEWBORN`, `DELIVERY`, `BED_DAY`. **Mapping and activation:** not inspected.
- **Next:** Establish newborn identity, independent clinical encounter, approved cot and package linkage.
- **Evidence:** [src/db/schema/maternity.ts:362](../../../src/db/schema/maternity.ts#L362); [src/routes/maternal-health.routes.ts:392](../../../src/routes/maternal-health.routes.ts#L392); [src/db/inpatient-contracts.ts:113](../../../src/db/inpatient-contracts.ts#L113).

### Mental health and psychiatry — NOT_DEDICATED

- **Identities for review:** Psychiatric consultation; Psychological assessment; Mental-health counselling session.
- **Clinical/operational evidence:** Postnatal mood field does not establish a psychiatry, counselling or inpatient mental-health workflow.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`, `POSTNATAL`. **Mapping and activation:** not inspected.
- **Next:** Validate mental-health workflows, confidentiality, consent and approved fees.
- **Evidence:** [src/components/modules/maternity/PostnatalContactForm.tsx:45](../../../src/components/modules/maternity/PostnatalContactForm.tsx#L45).

### Immunisation and preventive health — PARTIAL

- **Identities for review:** BCG immunisation; Oral polio immunisation, dose 0; Oral polio immunisation, dose 1; Oral polio immunisation, dose 2; Oral polio immunisation, dose 3; Pentavalent immunisation, dose 1; Pentavalent immunisation, dose 2; Pentavalent immunisation, dose 3; Pneumococcal conjugate immunisation, dose 1; Pneumococcal conjugate immunisation, dose 2; Pneumococcal conjugate immunisation, dose 3; Rotavirus immunisation, dose 1; Rotavirus immunisation, dose 2; Inactivated polio immunisation; Measles-rubella immunisation, dose 1; Measles-rubella immunisation, dose 2; Yellow fever immunisation; HPV immunisation, dose 1; HPV immunisation, dose 2.
- **Clinical/operational evidence:** Dose records and 19 schedule codes exist; immunisation screen patient picker selects children under five.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** Clinical schedule codes are not billing/payer codes; actual products, programme funding and KEPI schedule are unverified.
- **Trace(s):** `IMMUNISATION`. **Mapping and activation:** not inspected.
- **Next:** Verify current clinical schedule, age eligibility, product stock, public funding, and lawful billing before adding any trigger.
- **Evidence:** [src/immunisation/immunisation-contracts.ts:32](../../../src/immunisation/immunisation-contracts.ts#L32); [src/components/modules/maternity/ImmunisationSection.tsx:61](../../../src/components/modules/maternity/ImmunisationSection.tsx#L61); [src/routes/maternal-health.routes.ts:659](../../../src/routes/maternal-health.routes.ts#L659).

### Dermatology — NOT_DEDICATED

- **Identities for review:** Histopathology examination of biopsy specimen; Dermatology consultation; Skin biopsy collection.
- **Clinical/operational evidence:** No dermatology-specific workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Biopsy procedure and pathology test are distinct.
- **Trace(s):** `NONE`, `LAB_ORDER`. **Mapping and activation:** not inspected.
- **Next:** Validate service set and use shared procedure and lab identities.
- **Evidence:** [src/components/modules/SpecialtyModule.tsx:10](../../../src/components/modules/SpecialtyModule.tsx#L10); [src/routes/diagnoses.routes.ts:124](../../../src/routes/diagnoses.routes.ts#L124).

### ENT — SCREEN_ONLY

- **Identities for review:** ENT consultation; Audiometry; Ear wax removal.
- **Clinical/operational evidence:** ENT specialty navigation exists; no specialty-specific saved note, procedure or charge from this screen.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Validate ENT services and develop real persisted workflow.
- **Evidence:** [src/components/modules/SpecialtyModule.tsx:10](../../../src/components/modules/SpecialtyModule.tsx#L10); [src/routes/diagnoses.routes.ts:124](../../../src/routes/diagnoses.routes.ts#L124).

### Nutrition and dietetics — REQUIREMENT_ONLY

- **Identities for review:** Dietetic initial assessment; Dietetic follow-up consultation.
- **Clinical/operational evidence:** Allied-health requirement mentioned; no dietetics clinical/event workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Validate staffing, nutrition services and lawful fee policy.
- **Evidence:** [src/compliance/dha-requirements.ts:211](../../../src/compliance/dha-requirements.ts#L211).

### Oncology — NOT_DEDICATED

- **Identities for review:** Oncology consultation; Chemotherapy administration session; Radiotherapy treatment session.
- **Clinical/operational evidence:** A payer preauthorization UI category is not an oncology treatment workflow.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Drug identities remain in shared inventory/pharmacy.
- **Trace(s):** `NONE`, `PHARMACY`. **Mapping and activation:** not inspected.
- **Next:** Validate oncology services, documented administrations, inventory and separate payer mapping.
- **Evidence:** [src/components/modules/eclaims/PreauthorizationWorkspace.tsx:1](../../../src/components/modules/eclaims/PreauthorizationWorkspace.tsx#L1); [src/db/schema/inventory.ts:35](../../../src/db/schema/inventory.ts#L35).

### Respiratory therapy — NOT_DEDICATED

- **Identities for review:** Oxygen therapy; Mechanical ventilation; Respiratory therapy assessment.
- **Clinical/operational evidence:** Ward observations and ventilated bed label exist; no separate oxygen/ventilation treatment workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Do not assume ventilated-bed subtype or oxygen is independently billed.
- **Trace(s):** `NONE`, `BED_DAY`. **Mapping and activation:** not inspected.
- **Next:** Validate respiratory activities, product/equipment and ICU package boundaries.
- **Evidence:** [src/db/seed.ts:565](../../../src/db/seed.ts#L565); [src/db/queries/inpatient.ts:758](../../../src/db/queries/inpatient.ts#L758).

### Mortuary services — NOT_DEDICATED

- **Identities for review:** Mortuary body storage; Mortuary release preparation.
- **Clinical/operational evidence:** No mortuary-specific patient service, storage or release workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Validate legal, privacy, identity and fee requirements at facilities that provide this service.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27).

### Ambulance and patient transport — NOT_DEDICATED

- **Identities for review:** Ambulance patient transport; Non-emergency patient transport.
- **Clinical/operational evidence:** Mock or payer package references do not establish dispatch or transport service delivery.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Validate transport delivery, units, dispatch and approved price/payer policies.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27).

### CSSD and sterilization — NOT_DEDICATED

- **Identities for review:** Instrument sterilization / processing.
- **Clinical/operational evidence:** No CSSD service-specific processing or billing workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Internal sterilization is not automatically a patient fee.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Validate whether any externally chargeable sterilization service exists and prevent inclusion double billing.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27).

### Occupational health — NOT_DEDICATED

- **Identities for review:** Occupational health assessment; Work-fitness certificate.
- **Clinical/operational evidence:** No occupational-health assessment, employer contract or certificate workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Confirm authorized service, employer billing and certificate rules.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27).

### Family planning — NOT_DEDICATED

- **Identities for review:** Family-planning consultation; Contraceptive implant insertion; Contraceptive implant removal; Intrauterine device insertion; Intrauterine device removal.
- **Clinical/operational evidence:** No dedicated family-planning care, device administration or product service workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Reuse one procedure and one inventory item identity.
- **Trace(s):** `NONE`, `INVENTORY`. **Mapping and activation:** not inspected.
- **Next:** Review consent, program funding and product/procedure tariff rules with the facility.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27); [src/db/schema/inventory.ts:35](../../../src/db/schema/inventory.ts#L35).

### Community health and outreach — NOT_DEDICATED

- **Identities for review:** Community outreach clinical visit; Home clinical visit.
- **Clinical/operational evidence:** Public-health reporting is not a community home-visit or outreach delivery workflow.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Outreach uses existing lab and immunisation services, not duplicate catalogues.
- **Trace(s):** `NONE`, `IMMUNISATION`. **Mapping and activation:** not inspected.
- **Next:** Validate facilities, field access and programme funding.
- **Evidence:** [src/components/modules/PublicHealthModule.tsx:1](../../../src/components/modules/PublicHealthModule.tsx#L1); [src/routes/maternal-health.routes.ts:659](../../../src/routes/maternal-health.routes.ts#L659).

### Cardiology — NOT_DEDICATED

- **Identities for review:** Cardiology consultation; Electrocardiogram; Cardiac stress test; Cardiac catheterization; Echocardiography.
- **Clinical/operational evidence:** No cardiology-specific consultation, ECG, stress-test or catheterization workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Echocardiography is one shared imaging study.
- **Trace(s):** `NONE`, `IMAGING`. **Mapping and activation:** not inspected.
- **Next:** Validate services and choose shared diagnostic ownership.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27); [src/routes/radiology.routes.ts:49](../../../src/routes/radiology.routes.ts#L49).

### Orthopaedics — NOT_DEDICATED

- **Identities for review:** Orthopaedic consultation; Fracture reduction; Cast application; Arthroscopy; Orthopaedic implant, individually identified.
- **Clinical/operational evidence:** A payer/mock benefit category is not an orthopaedic clinical service.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Do not duplicate implants already represented in inventory.
- **Trace(s):** `NONE`, `INVENTORY`. **Mapping and activation:** not inspected.
- **Next:** Validate orthopaedic procedure, implant, stock and package identities.
- **Evidence:** [src/integrations/sha/sha.benefits.ts:1](../../../src/integrations/sha/sha.benefits.ts#L1); [src/db/schema/inventory.ts:35](../../../src/db/schema/inventory.ts#L35).

### Neurology — NOT_DEDICATED

- **Identities for review:** CT brain with contrast; MRI brain with contrast; Neurology consultation; Electroencephalogram.
- **Clinical/operational evidence:** No neurology-specific consultation or EEG workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Existing MRI/CT names are UI examples, not confirmed clinical services.
- **Trace(s):** `NONE`, `IMAGING`. **Mapping and activation:** not inspected.
- **Next:** Validate neurological care and shared imaging identities.
- **Evidence:** [src/components/modules/eclaims/PreauthorizationWorkspace.tsx:282](../../../src/components/modules/eclaims/PreauthorizationWorkspace.tsx#L282); [src/routes/radiology.routes.ts:49](../../../src/routes/radiology.routes.ts#L49).

### Urology — NOT_DEDICATED

- **Identities for review:** Renal function panel; Abdominal ultrasound; Urology consultation; Cystoscopy.
- **Clinical/operational evidence:** No urology-specific consultation or cystoscopy workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Shared renal tests and imaging remain in their canonical catalogues.
- **Trace(s):** `NONE`, `LAB_ORDER`, `IMAGING`. **Mapping and activation:** not inspected.
- **Next:** Validate urological services and shared test/procedure boundaries.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27); [src/routes/laboratory.routes.ts:87](../../../src/routes/laboratory.routes.ts#L87).

### Gastroenterology — NOT_DEDICATED

- **Identities for review:** Abdominal ultrasound; Diagnostic upper gastrointestinal endoscopy; Diagnostic colonoscopy; Gastroenterology consultation.
- **Clinical/operational evidence:** No dedicated gastroenterology consultation workflow established.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Upper GI and colonoscopy candidates are owned once by endoscopy.
- **Trace(s):** `NONE`, `IMAGING`. **Mapping and activation:** not inspected.
- **Next:** Validate GI workflow; keep one identity for shared endoscopy and imaging.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27); [src/routes/radiology.routes.ts:49](../../../src/routes/radiology.routes.ts#L49).

### Specialist outpatient clinics — SCREEN_ONLY

- **Identities for review:** Specialist outpatient consultation; Specialist follow-up consultation.
- **Clinical/operational evidence:** Specialty screen navigates and opens records but cannot save specialty notes, prescriptions or charges; generic outpatient exists.
- **Billing:** Generic CONSULTATION attempt only when a generic encounter is created; no specialty subtype guaranteed.
- **Codes and overlaps:** No service-specific identity or tariff established; actual facility codes unknown. Do not duplicate generic encounter and specialist consultation without policy.
- **Trace(s):** `CONSULT`, `NONE`. **Mapping and activation:** not inspected.
- **Next:** Define specialty and first/follow-up service identities and facility-approved tariffs.
- **Evidence:** [src/components/modules/SpecialtyModule.tsx:10](../../../src/components/modules/SpecialtyModule.tsx#L10); [src/routes/domains/encounters.routes.ts:86](../../../src/routes/domains/encounters.routes.ts#L86).

## Additional discovered departments and platform functions

### Outpatient and emergency — PARTIAL

- **Identities for review:** Outpatient clinical consultation / encounter; New outpatient consultation; Follow-up outpatient consultation; Emergency / casualty consultation; Wound dressing; Triage assessment.
- **Clinical/operational evidence:** Outpatient encounter, vitals, prescriptions, lab batch entry and general imaging paths exist.
- **Billing:** CONSULTATION, LABORATORY, RADIOLOGY and PHARMACY attempts at their respective events.
- **Codes and overlaps:** Generic OPD code cannot distinguish a first visit, review, specialist or emergency rate.
- **Trace(s):** `CONSULT`, `LAB_ORDER`, `IMAGING`, `OBSERVATION`. **Mapping and activation:** not inspected.
- **Next:** Validate timing, tariffs, completion/cancellation and generic code selection.
- **Evidence:** [src/components/modules/OutpatientModule.tsx:299](../../../src/components/modules/OutpatientModule.tsx#L299); [src/routes/domains/encounters.routes.ts:86](../../../src/routes/domains/encounters.routes.ts#L86).

### Inpatient accommodation — PARTIAL

- **Identities for review:** General ward bed-day; Medical ward bed-day; Surgical ward bed-day; Maternity ward bed-day; Paediatric ward bed-day; ICU bed-day; HDU bed-day; Isolation ward bed-day; Recovery ward bed-day; Neonatal cot / ward bed-day; Inpatient admission administration; Fowler electric-bed equipment component.
- **Clinical/operational evidence:** Admission, bed allocation, discharge and nursing UI; transfer and explicit accrual APIs exist but no UI callers were found; ward-day accrual is segmented.
- **Billing:** ADMISSION and BED_DAY attempts; unpriced nights are reported.
- **Codes and overlaps:** Ward suggestions and demo ward codes are not approved tariffs. Generic special-bed fallback, queued retry losing ward identity, historical-date and bed subtype risks.
- **Trace(s):** `ADMISSION`, `BED_DAY`. **Mapping and activation:** not inspected.
- **Next:** Validate stay-day rules and per-ward approved tariffs and unit boundaries.
- **Evidence:** [src/routes/inpatient.routes.ts:439](../../../src/routes/inpatient.routes.ts#L439); [src/db/queries/inpatient.ts:758](../../../src/db/queries/inpatient.ts#L758).

### Maternity and maternal health — PARTIAL

- **Identities for review:** Antenatal booking / initial assessment; Antenatal follow-up visit; Labour monitoring / partograph; Postnatal contact; Spontaneous Vertex delivery; Assisted Vaginal delivery; Breech delivery; Vacuum delivery; Forceps delivery; Caesarean Section delivery.
- **Clinical/operational evidence:** Pregnancy, ANC, labour/partograph, delivery and postnatal records.
- **Billing:** DELIVERY attempt once per delivery; no ANC, labour or postnatal-specific billing trigger found.
- **Codes and overlaps:** Six UI delivery-mode values produce name-derived candidates; no distinct actual facility codes verified.
- **Trace(s):** `ANC`, `LABOUR`, `DELIVERY`, `POSTNATAL`. **Mapping and activation:** not inspected.
- **Next:** Validate lawful programme coverage, delivery package, mother/newborn identity and component boundaries.
- **Evidence:** [src/routes/maternal-health.routes.ts:101](../../../src/routes/maternal-health.routes.ts#L101); [src/routes/maternal-health.routes.ts:392](../../../src/routes/maternal-health.routes.ts#L392).

### Laboratory — PARTIAL

- **Identities for review:** Full blood count (CBC/FBC 5-part differential); Malaria rapid test and blood slide (combined demo entry); Renal function panel; Lipid profile panel; Haemoglobin; White blood cell count; Platelet count; Malaria rapid diagnostic test; Malaria blood slide / microscopy; Urea; Blood urea nitrogen (BUN); Creatinine; Estimated glomerular filtration rate (eGFR); Sodium; Potassium; Chloride; Total cholesterol; Triglycerides; HDL cholesterol; LDL cholesterol; Urinalysis; Random blood glucose; Pregnancy test; Stool microscopy; Blood glucose measurement; ABO blood grouping; Rhesus blood typing; Blood compatibility crossmatch; Specimen collection; Specimen processing / preparation; Histopathology examination of biopsy specimen.
- **Clinical/operational evidence:** Dynamic test catalogue read, free-text batch orders, specimen/status, results and verification.
- **Billing:** LABORATORY attempt per order; no separate specimen collection/processing event.
- **Codes and overlaps:** Four demo lab test codes; exact normalized catalogue matching; panel components and free text may lack IDs or be duplicated.
- **Trace(s):** `LAB_ORDER`, `SPECIMEN`. **Mapping and activation:** not inspected.
- **Next:** Export actual catalogue, build safe aliases, confirm panel/specimen inclusions and test-specific tariffs.
- **Evidence:** [src/db/seed.ts:622](../../../src/db/seed.ts#L622); [src/routes/laboratory.routes.ts:47](../../../src/routes/laboratory.routes.ts#L47); [src/db/queries/shared.ts:402](../../../src/db/queries/shared.ts#L402).

### Radiology and imaging — PARTIAL

- **Identities for review:** Chest X-ray, PA view; Obstetric ultrasound; Abdominal ultrasound; CT brain with contrast; CT chest with contrast; MRI brain with contrast; Echocardiography.
- **Clinical/operational evidence:** Imaging orders and reports with free-text study name and modality; order UI ignores the returned billing outcome.
- **Billing:** RADIOLOGY attempt per order; order is not performance.
- **Codes and overlaps:** One demo chest X-ray order plus examples; no controlled study master established.
- **Trace(s):** `IMAGING`. **Mapping and activation:** not inspected.
- **Next:** Obtain facility study list and map site, laterality, modality, contrast and valid tariffs.
- **Evidence:** [src/components/modules/RadiologyModule.tsx:125](../../../src/components/modules/RadiologyModule.tsx#L125); [src/routes/radiology.routes.ts:49](../../../src/routes/radiology.routes.ts#L49).

### Pharmacy and inventory — PARTIAL

- **Identities for review:** Contrast medium product, individually identified; Amlodipine 10 mg tablet; Amoxicillin / clavulanic acid 625 mg tablet; Artemether / lumefantrine 20/120 mg tablet; Paracetamol 500 mg tablet; Medication dispensing professional fee; Separately chargeable consumable, facility item not enumerated; Dialysis consumable usage, inventory item not enumerated; Corrective lens or frame, individually identified; Orthopaedic implant, individually identified.
- **Clinical/operational evidence:** Prescriptions, FEFO dispensing, inventory items/batches and stock allocations.
- **Billing:** PHARMACY attempt per dispensation; general stock issue does not create patient charge.
- **Codes and overlaps:** Four demo stock codes are not tariff identities; billing uses drug name/quantity. First dispensing has no observed prescription-to-item/strength match; subsequent product changes are restricted.
- **Trace(s):** `PHARMACY`, `INVENTORY`. **Mapping and activation:** not inspected.
- **Next:** Reconcile product strength/form, units, stock and approved prices; preserve separate stock and charge ledgers.
- **Evidence:** [src/db/seed.ts:751](../../../src/db/seed.ts#L751); [src/routes/pharmacy.routes.ts:215](../../../src/routes/pharmacy.routes.ts#L215).

### Dialysis and renal care — PARTIAL

- **Identities for review:** Dialysis treatment session; Renal patient assessment.
- **Clinical/operational evidence:** Assessment, authorized plan, machine, scheduling, session observations, completion and consumable stock use.
- **Billing:** Session completion returns UNBILLED; consumable use is stock/cost, not an invoice.
- **Codes and overlaps:** No dialysis-specific billing family; lab tests, medicine and inventory must reuse canonical definitions.
- **Trace(s):** `DIALYSIS`, `DIALYSIS_CONSUMABLE`. **Mapping and activation:** not inspected.
- **Next:** Define approved session event and package, reconcile usage and implement idempotent billing through existing system.
- **Evidence:** [src/routes/dialysis.routes.ts:124](../../../src/routes/dialysis.routes.ts#L124); [src/dialysis/dialysis.service.ts:743](../../../src/dialysis/dialysis.service.ts#L743).

### Nursing and clinical observations — PARTIAL

- **Identities for review:** Nursing / clinical vital-sign observation.
- **Clinical/operational evidence:** OPD and ward vitals, nursing notes and shift handover.
- **Billing:** No standalone observation, monitoring or triage charge trigger found.
- **Codes and overlaps:** Observations are not automatically separate billable tests or equipment.
- **Trace(s):** `OBSERVATION`. **Mapping and activation:** not inspected.
- **Next:** Clarify bundled vs distinct nursing care with the facility.
- **Evidence:** [src/components/modules/NursingPanel.tsx:234](../../../src/components/modules/NursingPanel.tsx#L234); [src/routes/vitals.routes.ts:57](../../../src/routes/vitals.routes.ts#L57).

### Paediatrics — LABEL_ONLY

- **Identities for review:** Paediatric ward bed-day; Paediatric consultation.
- **Clinical/operational evidence:** A seed practitioner specialty and paediatric ward suggestion do not establish a dedicated paediatric clinic.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** Shared OPD, ward, immunisation and lab identities remain canonical.
- **Trace(s):** `CONSULT`, `BED_DAY`, `IMMUNISATION`. **Mapping and activation:** not inspected.
- **Next:** Confirm a facility-specific paediatrics offering and workflow.
- **Evidence:** [src/db/seed.ts:211](../../../src/db/seed.ts#L211); [src/db/inpatient-contracts.ts:113](../../../src/db/inpatient-contracts.ts#L113).

### General surgery — SCHEDULE_ONLY

- **Identities for review:** Laparoscopic cholecystectomy; General surgery consultation.
- **Clinical/operational evidence:** Seed department and example theatre case; no full operative service verified.
- **Billing:** No service-specific automatic event; generic manual invoice API is not a specialty workflow.
- **Codes and overlaps:** Use theatre/procedure identity once; avoid double billing a booking.
- **Trace(s):** `THEATRE`, `PROCEDURE_API`. **Mapping and activation:** not inspected.
- **Next:** Validate complete clinical surgery lifecycle.
- **Evidence:** [src/db/seed.ts:138](../../../src/db/seed.ts#L138); [src/routes/theatre-scheduling.routes.ts:151](../../../src/routes/theatre-scheduling.routes.ts#L151).

### Registration and reception — PARTIAL

- **Identities for review:** Patient registration; Medical report or certificate preparation.
- **Clinical/operational evidence:** Scoped patient registration and reception queue; administrative clinical report/certificate fee not established.
- **Billing:** No registration charge trigger found.
- **Codes and overlaps:** Administrative records are not evidence of an approved administrative fee.
- **Trace(s):** `REGISTRATION`. **Mapping and activation:** not inspected.
- **Next:** Review lawful fee and informed facility policy; avoid inventing charge.
- **Evidence:** [src/routes/domains/patients.routes.ts:160](../../../src/routes/domains/patients.routes.ts#L160); [src/components/modules/ReceptionQueueModule.tsx:1](../../../src/components/modules/ReceptionQueueModule.tsx#L1).

### Billing and revenue — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Tariff configuration, charge attempts, invoice and cashier workflows; generic manual invoice API exists.
- **Billing:** Eight automatic event families; generic manual API is billing.create/finance scoped.
- **Codes and overlaps:** Manual item may omit tariffId and use caller price; no UI caller for createInvoice was found.
- **Trace(s):** `CONSULT`, `LAB_ORDER`, `PROCEDURE_API`. **Mapping and activation:** not inspected.
- **Next:** Review mappings, unpriced queue, legacy manual lines, duplicates and controlled reversals.
- **Evidence:** [src/routes/domains/invoices.routes.ts:53](../../../src/routes/domains/invoices.routes.ts#L53); [src/billing/charge-attempts.ts:318](../../../src/billing/charge-attempts.ts#L318).

### Insurance and payer claims — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Facility mappings, SHA and private-claim preparation exist. Provider/contract access is unverified.
- **Billing:** Claims preparation is downstream of invoice; it is not a service charge or settlement.
- **Codes and overlaps:** All actual facility payer mappings unknown; SHA mapping effective-date and amount fallback behavior need review.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Obtain authorized contracts and independently validate coverage, mappings, reimbursement and provider responses.
- **Evidence:** [src/db/schema/insurance-payers.ts:223](../../../src/db/schema/insurance-payers.ts#L223); [src/insurance/eclaims/claims-workflow.service.ts:700](../../../src/insurance/eclaims/claims-workflow.service.ts#L700).

### Public health surveillance — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Local sentinel reports; UI explicitly states no KHIS/DHIS2 transmission and MOH 705 unavailable.
- **Billing:** No clinical-service fee identified.
- **Codes and overlaps:** Disease classification and reporting codes are not charge identities.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Keep surveillance separate from patient charges and validate any authorized integration.
- **Evidence:** [src/components/modules/PublicHealthModule.tsx:1](../../../src/components/modules/PublicHealthModule.tsx#L1).

### Procurement and supplier management — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Suppliers and purchasing manage facility inputs, not evidence of patient services.
- **Billing:** Purchase/receipt and stock cost are not patient charges.
- **Codes and overlaps:** Product catalogue is shared with inventory, not a second patient-service catalogue.
- **Trace(s):** `INVENTORY`. **Mapping and activation:** not inspected.
- **Next:** Separate procurement cost from approved patient prices and avoid patient double billing.
- **Evidence:** [src/components/modules/ProcurementModule.tsx:1](../../../src/components/modules/ProcurementModule.tsx#L1); [src/db/schema/inventory.ts:35](../../../src/db/schema/inventory.ts#L35).

### Website booking and reception — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Appointment/queue facilities exist; booking is not an encounter or proof of service.
- **Billing:** No booking-specific charge trigger established.
- **Codes and overlaps:** Booking reference or queue token is not a clinical service code.
- **Trace(s):** `REGISTRATION`. **Mapping and activation:** not inspected.
- **Next:** Validate appointment and check-in lifecycle separately from consultation billing.
- **Evidence:** [src/config/facility-modules.ts:45](../../../src/config/facility-modules.ts#L45); [src/components/modules/ReceptionQueueModule.tsx:1](../../../src/components/modules/ReceptionQueueModule.tsx#L1).

### Accounting and general ledger — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Journal, posting and accounting modules are downstream financial infrastructure.
- **Billing:** A posted journal is not a new clinical charge; payment is not recognized revenue or claim settlement.
- **Codes and overlaps:** No separate medical-service code should be inferred from GL accounts.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Require balanced, idempotent posting, closed-period controls and authorized reversal.
- **Evidence:** [src/components/modules/AccountingModule.tsx:1](../../../src/components/modules/AccountingModule.tsx#L1); [src/components/modules/BillingJournalPostingPanel.tsx:1](../../../src/components/modules/BillingJournalPostingPanel.tsx#L1).

### Configuration, administration and audit — PLATFORM_PARTIAL

- **Identities for review:** No separate patient-service identity is asserted for this support function..
- **Clinical/operational evidence:** Facility modules, tariffs, staff, permissions and audit logs configure a single platform.
- **Billing:** Configuration or audit operation is not itself a patient charge.
- **Codes and overlaps:** Module enabled, generic key, user access or audit screen is not proof of clinical workflow or facility price.
- **Trace(s):** `NONE`. **Mapping and activation:** not inspected.
- **Next:** Apply tenant/facility scope and versioned service activation; keep provider secrets server-side.
- **Evidence:** [src/config/facility-modules.ts:27](../../../src/config/facility-modules.ts#L27); [src/components/modules/ConfigurationModule.tsx:1](../../../src/components/modules/ConfigurationModule.tsx#L1).
