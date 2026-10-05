import { db } from './index.ts';
import * as schema from './schema.ts';

export async function seedInitialData() {
  try {
    const existingTenants = await db.select().from(schema.tenants).limit(1);
    if (existingTenants.length > 0) {
      console.log('Database already seeded. Skipping initial seeding.');
      return;
    }

    console.log('Seeding initial Kenya HMIS multi-tenant dataset...');

    // 1. Tenants
    const [tenant1] = await db.insert(schema.tenants).values({
      name: 'Nairobi Metropolitan Healthcare Group',
      slug: 'nairobi-metro',
      domain: 'nairobihospital.ke',
      brandColor: '#0f766e',
      contactEmail: 'admin@nairobihospital.ke',
      contactPhone: '+254 20 284 5000',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
      settings: {
        theme: 'emerald-dark',
        mflReportingEnabled: true,
        shaIntegrationMode: 'production-ready',
      },
    }).returning();

    const [tenant2] = await db.insert(schema.tenants).values({
      name: 'Kilifi County Health Services',
      slug: 'kilifi-county',
      domain: 'health.kilifi.go.ke',
      brandColor: '#0369a1',
      contactEmail: 'countyhealth@kilifi.go.ke',
      contactPhone: '+254 41 752 2030',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
      settings: {
        theme: 'ocean',
        mflReportingEnabled: true,
      },
    }).returning();

    // 2. Facilities
    const [facility1] = await db.insert(schema.facilities).values({
      tenantId: tenant1.id,
      code: 'NRB-CENTRAL',
      name: 'Nairobi Central Referral Hospital',
      level: 'Level 5 Hospital',
      county: 'Nairobi',
      subCounty: 'Westlands',
      mflCode: 'MFL-12845',
      address: 'Argwings Kodhek Rd, Hurlingham, Nairobi',
      phone: '+254 703 082 000',
      email: 'info@nairobihospital.ke',
      enabledModules: [
        'registration', 'reception', 'opd', 'inpatient', 'theatre', 'specialty',
        'laboratory', 'radiology', 'pharmacy', 'inventory', 'procurement',
        'finance', 'insurance', 'public_health', 'analytics', 'configuration'
      ],
    }).returning();

    const [facility2] = await db.insert(schema.facilities).values({
      tenantId: tenant1.id,
      code: 'NRB-SOUTH',
      name: 'Nairobi South Family Medical Center',
      level: 'Level 3 Center',
      county: 'Nairobi',
      subCounty: 'Langata',
      mflCode: 'MFL-14902',
      address: 'Muhoho Ave, South C, Nairobi',
      phone: '+254 722 990 011',
      email: 'southc@nairobihospital.ke',
      enabledModules: [
        'registration', 'reception', 'opd', 'laboratory', 'pharmacy', 'finance'
      ],
    }).returning();

    // 3. Departments
    const [deptOPD] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Outpatient & Casualty (OPD)',
      code: 'OPD-01',
      type: 'clinical',
    }).returning();

    const [deptInpatient] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Inpatient Medical & Surgical Units',
      code: 'IPD-01',
      type: 'inpatient',
    }).returning();

    const [deptTheatre] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Operating Theatres & Day Surgery',
      code: 'OT-01',
      type: 'theatre',
    }).returning();

    const [deptLab] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Main Diagnostic Clinical Laboratory',
      code: 'LAB-01',
      type: 'diagnostic',
    }).returning();

    const [deptPharm] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Central Hospital Pharmacy & Outpatient Dispensing',
      code: 'PHARM-01',
      type: 'pharmacy',
    }).returning();

    const [deptRad] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Radiology & Medical Imaging',
      code: 'RAD-01',
      type: 'diagnostic',
    }).returning();

    const [deptSpecialty] = await db.insert(schema.departments).values({
      facilityId: facility1.id,
      name: 'Specialist Clinics (Dental, Eye, ENT, MCH, Renal)',
      code: 'SPEC-01',
      type: 'clinical',
    }).returning();

    // 4. Practitioners
    await db.insert(schema.practitioners).values([
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        fullName: 'Dr. Angela Omwamba',
        licenseNumber: 'KMPDC A.45821',
        specialty: 'Medical Director / Consultant Surgeon',
        qualification: 'MBChB, MMed (Surg), FCS (ECSA)',
        departmentId: deptTheatre.id,
        phone: '+254 722 100 200',
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        fullName: 'Dr. Dennis Mutua',
        licenseNumber: 'KMPDC A.51290',
        specialty: 'Consultant Physician / Internist',
        qualification: 'MBChB, MMed (Int Med)',
        departmentId: deptOPD.id,
        phone: '+254 733 456 789',
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        fullName: 'Dr. Fatuma Hassan',
        licenseNumber: 'KMPDC B.18432',
        specialty: 'Consultant Paediatrician / MCH Head',
        qualification: 'MBChB, MMed (Paed)',
        departmentId: deptSpecialty.id,
        phone: '+254 721 889 900',
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        fullName: 'CO Peter Kiprop',
        licenseNumber: 'COC C.11029',
        specialty: 'Senior Clinical Officer (OPD)',
        qualification: 'BSc Clinical Medicine',
        departmentId: deptOPD.id,
        phone: '+254 710 223 344',
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        fullName: 'Nurse Grace Achieng',
        licenseNumber: 'NCK R.38201',
        specialty: 'Nurse-in-Charge / Triage Specialist',
        qualification: 'BSc Nursing (KRCHN)',
        departmentId: deptOPD.id,
        phone: '+254 724 667 788',
      },
    ]);

    // 5. Patients
    const [patient1] = await db.insert(schema.patients).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      mrn: 'MRN-2026-0041',
      firstName: 'Juma',
      lastName: 'Otieno',
      middleName: 'Omondi',
      dateOfBirth: '1988-04-12',
      gender: 'Male',
      phone: '+254 722 849 201',
      email: 'juma.otieno@gmail.com',
      nationalId: '28491024',
      shaNumber: 'SHA-8834921',
      bloodGroup: 'O+',
      maritalStatus: 'Married',
      occupation: 'Electrical Engineer',
      county: 'Nairobi',
      subCounty: 'Westlands',
      residentialAddress: 'Apartment 4B, Parklands 4th Ave',
      emergencyContactName: 'Beryl Otieno',
      emergencyContactPhone: '+254 721 334 455',
      emergencyContactRelationship: 'Spouse',
      allergies: 'Penicillin (Severe anaphylactoid rash)',
      chronicConditions: 'Essential Hypertension (Stage 1)',
      payerType: 'SHA',
      insuranceProvider: 'Social Health Authority (SHA)',
      policyNumber: 'SHA-KEN-2026-88349',
    }).returning();

    const [patient2] = await db.insert(schema.patients).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      mrn: 'MRN-2026-0042',
      firstName: 'Mary',
      lastName: 'Mwangi',
      middleName: 'Njeri',
      dateOfBirth: '1997-09-23',
      gender: 'Female',
      phone: '+254 715 390 128',
      email: 'mary.njeri@yahoo.com',
      nationalId: '34190822',
      shaNumber: 'SHA-1290485',
      bloodGroup: 'A+',
      maritalStatus: 'Married',
      occupation: 'Secondary School Teacher',
      county: 'Nairobi',
      subCounty: 'Kasarani',
      residentialAddress: 'House 12, Clay City, Kasarani',
      emergencyContactName: 'David Mwangi',
      emergencyContactPhone: '+254 720 112 233',
      emergencyContactRelationship: 'Spouse',
      allergies: 'Sulphonamides (Bactrim)',
      chronicConditions: 'Asthma (Mild intermittent)',
      payerType: 'Insurance',
      insuranceProvider: 'Jubilee Health Insurance',
      policyNumber: 'JUB-CORP-99214',
    }).returning();

    const [patient3] = await db.insert(schema.patients).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      mrn: 'MRN-2026-0043',
      firstName: 'Brian',
      lastName: 'Chepkwony',
      middleName: 'Kiprono',
      dateOfBirth: '2015-06-18',
      gender: 'Male',
      phone: '+254 701 445 566',
      nationalId: 'BC-992148',
      shaNumber: 'SHA-4491028',
      bloodGroup: 'B+',
      maritalStatus: 'Single',
      occupation: 'Student / Minor',
      county: 'Nairobi',
      subCounty: 'Langata',
      residentialAddress: 'Kibera Drive, Langata',
      emergencyContactName: 'Naomi Chepkwony',
      emergencyContactPhone: '+254 701 445 566',
      emergencyContactRelationship: 'Mother',
      allergies: 'None known',
      chronicConditions: 'None known',
      payerType: 'Self-Pay',
    }).returning();

    const [patient4] = await db.insert(schema.patients).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      mrn: 'MRN-2026-0044',
      firstName: 'Hassan',
      lastName: 'Mohamed',
      middleName: 'Ali',
      dateOfBirth: '1978-11-04',
      gender: 'Male',
      phone: '+254 726 890 321',
      nationalId: '21948301',
      shaNumber: 'SHA-7729103',
      bloodGroup: 'O-',
      maritalStatus: 'Married',
      occupation: 'Businessman',
      county: 'Nairobi',
      subCounty: 'Kamukunji',
      residentialAddress: 'Eastleigh Section 2, 8th Street',
      emergencyContactName: 'Amina Hassan',
      emergencyContactPhone: '+254 722 998 877',
      emergencyContactRelationship: 'Daughter',
      allergies: 'Ibuprofen / NSAIDs',
      chronicConditions: 'Type 2 Diabetes Mellitus, Diabetic Nephropathy',
      payerType: 'SHA',
      insuranceProvider: 'Social Health Authority (SHA)',
      policyNumber: 'SHA-KEN-2026-77291',
    }).returning();

    // 6. Encounters
    const [encounter1] = await db.insert(schema.encounters).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient1.id,
      encounterType: 'Outpatient',
      departmentId: deptOPD.id,
      status: 'In-Consultation',
      triageCategory: 'Category 3 - Urgent',
      chiefComplaint: 'Severe frontal throbbing headache, dizziness and high blood pressure for 3 days',
      historyOfPresentIllness: '38-year-old male with known history of Stage 1 hypertension on Amlodipine 5mg OD. Reports poor drug compliance for 2 weeks due to travel. BP elevated at triage to 164/102 mmHg. No visual blurring, chest pain or shortness of breath.',
      physicalExamination: 'Alert, oriented, not in acute respiratory distress. CVS: S1+S2 heard, no murmurs. Chest: clear vesicular breath sounds bilaterally. Abdomen: soft, non-tender. CNS: Cranial nerves intact, no focal neurological deficits.',
      clinicalNotes: 'Uncontrolled hypertension secondary to medication non-adherence. Advised on compliance, dietary salt restriction, and daily BP logging.',
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
    }).returning();

    // 7. Observations (Vitals)
    await db.insert(schema.observations).values({
      encounterId: encounter1.id,
      patientId: patient1.id,
      systolicBp: 164,
      diastolicBp: 102,
      pulseRate: 84,
      temperatureC: '36.8',
      respiratoryRate: 18,
      spo2Percent: 98,
      weightKg: '82.5',
      heightCm: '178.0',
      bmi: '26.0',
      bloodGlucoseMmol: '5.8',
      recordedBy: 'Nurse Grace Achieng',
    });

    // 8. Diagnoses
    await db.insert(schema.diagnoses).values({
      encounterId: encounter1.id,
      patientId: patient1.id,
      icd10Code: 'I10',
      icd10Description: 'Essential (primary) hypertension',
      diagnosisType: 'Primary',
      status: 'Confirmed',
      notes: 'Uncontrolled BP related to missed doses',
      diagnosedBy: 'Dr. Dennis Mutua',
    });

    // 9. Medications prescribed
    const [med1] = await db.insert(schema.medications).values({
      encounterId: encounter1.id,
      patientId: patient1.id,
      drugName: 'Amlodipine Besylate',
      dosage: '10mg',
      frequency: 'Once Daily (mane)',
      duration: '30 days',
      route: 'Oral',
      instructions: 'Take in the morning with or after breakfast',
      quantity: 30,
      unitPrice: '15.00',
      status: 'Prescribed',
      prescribedBy: 'Dr. Dennis Mutua',
    }).returning();

    // 10. Queues
    await db.insert(schema.queues).values([
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        patientId: patient1.id,
        encounterId: encounter1.id,
        queueType: 'Doctor',
        tokenNumber: 'OPD-101',
        priority: 'Priority',
        status: 'In-Progress',
        waitingTimeMinutes: 12,
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        patientId: patient2.id,
        queueType: 'Laboratory',
        tokenNumber: 'LAB-042',
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 8,
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        patientId: patient3.id,
        queueType: 'Triage',
        tokenNumber: 'TRG-089',
        priority: 'Emergency',
        status: 'Waiting',
        waitingTimeMinutes: 4,
      },
      {
        tenantId: tenant1.id,
        facilityId: facility1.id,
        patientId: patient4.id,
        queueType: 'Pharmacy',
        tokenNumber: 'PHARM-056',
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 15,
      },
    ]);

    // 11. Wards and Beds
    const [wardMale] = await db.insert(schema.wards).values({
      facilityId: facility1.id,
      name: 'St. Luke Male Medical Ward',
      code: 'WARD-MM',
      wardType: 'General Medical',
      genderAllocation: 'Male',
      totalBeds: 20,
      dailyRate: '1500.00',
    }).returning();

    const [wardSurg] = await db.insert(schema.wards).values({
      facilityId: facility1.id,
      name: 'St. Teresa Female Surgical Ward',
      code: 'WARD-FS',
      wardType: 'General Surgical',
      genderAllocation: 'Female',
      totalBeds: 18,
      dailyRate: '1800.00',
    }).returning();

    const [wardICU] = await db.insert(schema.wards).values({
      facilityId: facility1.id,
      name: 'Intensive Care Unit (ICU/HDU)',
      code: 'WARD-ICU',
      wardType: 'ICU/HDU',
      genderAllocation: 'Mixed',
      totalBeds: 6,
      dailyRate: '12000.00',
    }).returning();

    const [bed1] = await db.insert(schema.beds).values({
      wardId: wardMale.id,
      bedNumber: 'MM-BED-01',
      bedType: 'Fowler Electric Bed',
      status: 'Occupied',
      dailyCharge: '1500.00',
      currentPatientId: patient4.id,
    }).returning();

    await db.insert(schema.beds).values([
      { wardId: wardMale.id, bedNumber: 'MM-BED-02', bedType: 'Standard Bed', status: 'Available', dailyCharge: '1500.00' },
      { wardId: wardMale.id, bedNumber: 'MM-BED-03', bedType: 'Standard Bed', status: 'Available', dailyCharge: '1500.00' },
      { wardId: wardMale.id, bedNumber: 'MM-BED-04', bedType: 'Standard Bed', status: 'Cleaning', dailyCharge: '1500.00' },
      { wardId: wardSurg.id, bedNumber: 'FS-BED-01', bedType: 'Fowler Electric Bed', status: 'Available', dailyCharge: '1800.00' },
      { wardId: wardSurg.id, bedNumber: 'FS-BED-02', bedType: 'Standard Bed', status: 'Available', dailyCharge: '1800.00' },
      { wardId: wardICU.id, bedNumber: 'ICU-BED-01', bedType: 'ICU Ventilated Unit', status: 'Available', dailyCharge: '12000.00' },
      { wardId: wardICU.id, bedNumber: 'ICU-BED-02', bedType: 'ICU Ventilated Unit', status: 'Available', dailyCharge: '12000.00' },
    ]);

    // 12. Admission
    await db.insert(schema.admissions).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient4.id,
      wardId: wardMale.id,
      bedId: bed1.id,
      admissionDate: '2026-10-02 14:30',
      admissionType: 'Emergency',
      admittingDoctor: 'Dr. Angela Omwamba',
      provisionalDiagnosis: 'Diabetic Nephropathy Stage 3 with Fluid Overload',
      nursingNotes: 'Patient admitted via A&E. Strict intake/output fluid chart commenced. 24hr urine protein ordered.',
      status: 'Admitted',
    });

    // 13. Operating Theatre Cases
    await db.insert(schema.theatreCases).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient1.id,
      procedureName: 'Laparoscopic Cholecystectomy',
      theatreRoom: 'Main Theatre 1',
      theatreType: 'Major',
      leadSurgeon: 'Dr. Angela Omwamba',
      anaesthetist: 'Dr. Kamau Njoroge',
      scrubNurse: 'Nurse Janet Chebet',
      scheduledStart: '2026-10-05 09:00',
      scheduledEnd: '2026-10-05 11:30',
      preOpChecklist: {
        consentSigned: true,
        fastingVerified: true,
        bloodCrossmatched: '2 Units Packed Red Cells',
        antibioticProphylaxis: 'Ceftriaxone 1g IV ordered',
        surgicalSiteMarked: true,
      },
      status: 'Scheduled',
    });

    // 14. Laboratory Catalogue
    const [labCBC] = await db.insert(schema.labTests).values({
      facilityId: facility1.id,
      code: 'LAB-CBC',
      name: 'Full Blood Count (CBC/FBC 5-Part Diff)',
      category: 'Haematology',
      specimenType: 'Whole Blood (EDTA)',
      referenceRanges: 'Hb: 13.0-17.5 g/dL (M), 12.0-15.5 g/dL (F); WBC: 4.0-10.0 x10^9/L; Platelets: 150-450 x10^9/L',
      turnaroundHours: 1,
      price: '1200.00',
    }).returning();

    const [labMalaria] = await db.insert(schema.labTests).values({
      facilityId: facility1.id,
      code: 'LAB-MAL',
      name: 'Malaria Rapid Diagnostic Test (RDT) & Blood Slide',
      category: 'Parasitology',
      specimenType: 'Capillary Blood',
      referenceRanges: 'Negative / No Plasmodium falciparum trophozoites seen',
      turnaroundHours: 1,
      price: '500.00',
    }).returning();

    const [labRFT] = await db.insert(schema.labTests).values({
      facilityId: facility1.id,
      code: 'LAB-RFT',
      name: 'Renal Function Tests (Urea, Creatinine, Electrolytes Na+, K+, Cl-)',
      category: 'Biochemistry',
      specimenType: 'Serum (SST)',
      referenceRanges: 'Urea: 2.5-7.1 mmol/L; Creatinine: 62-106 umol/L; eGFR: >90 mL/min/1.73m²',
      turnaroundHours: 2,
      price: '2200.00',
    }).returning();

    const [labLipid] = await db.insert(schema.labTests).values({
      facilityId: facility1.id,
      code: 'LAB-LIPID',
      name: 'Lipid Profile (Total Cholesterol, Triglycerides, HDL, LDL)',
      category: 'Biochemistry',
      specimenType: 'Serum (Fasting 12h)',
      referenceRanges: 'Total Chol: <5.2 mmol/L; Triglycerides: <1.7 mmol/L; LDL: <2.6 mmol/L',
      turnaroundHours: 3,
      price: '1800.00',
    }).returning();

    // 15. Lab Orders & Results
    const [labOrder1] = await db.insert(schema.labOrders).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient1.id,
      encounterId: encounter1.id,
      testId: labRFT.id,
      testName: 'Renal Function Tests (RFT)',
      status: 'Published',
      sampleCollectedAt: new Date(Date.now() - 30 * 60 * 1000),
      sampleAccessionNumber: 'ACC-849102',
      orderedBy: 'Dr. Dennis Mutua',
    }).returning();

    await db.insert(schema.labResults).values([
      {
        orderId: labOrder1.id,
        patientId: patient1.id,
        parameterName: 'Serum Creatinine',
        measuredValue: '94',
        unit: 'umol/L',
        referenceRange: '62 - 106',
        flag: 'Normal',
        notes: 'Normal kidney filtration',
        verifiedBy: 'David Omondi (KMLTTB T.9412)',
      },
      {
        orderId: labOrder1.id,
        patientId: patient1.id,
        parameterName: 'Blood Urea Nitrogen',
        measuredValue: '5.2',
        unit: 'mmol/L',
        referenceRange: '2.5 - 7.1',
        flag: 'Normal',
        notes: '',
        verifiedBy: 'David Omondi (KMLTTB T.9412)',
      },
      {
        orderId: labOrder1.id,
        patientId: patient1.id,
        parameterName: 'Serum Potassium (K+)',
        measuredValue: '4.2',
        unit: 'mmol/L',
        referenceRange: '3.5 - 5.1',
        flag: 'Normal',
        notes: '',
        verifiedBy: 'David Omondi (KMLTTB T.9412)',
      },
    ]);

    // 16. Radiology
    await db.insert(schema.radiologyOrders).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient1.id,
      encounterId: encounter1.id,
      modality: 'X-Ray',
      procedureName: 'Chest X-Ray PA View',
      clinicalIndication: 'Baseline cardiac evaluation in hypertension',
      status: 'Reported',
      radiologistFindings: 'Normal cardiothoracic ratio (<0.50). Lung parenchyma clear bilaterally without consolidation or effusion. Costophrenic angles sharp.',
      impression: 'Normal cardiac silhouette and clear chest radiographic study.',
      orderedBy: 'Dr. Dennis Mutua',
      reportedBy: 'Dr. Sarah Wanjiku (Consultant Radiologist)',
      reportedAt: new Date(),
    });

    // 17. Pharmacy & Inventory Items
    const [invAmlodipine] = await db.insert(schema.inventoryItems).values({
      facilityId: facility1.id,
      itemCode: 'DRUG-AML-10',
      name: 'Amlodipine Besylate 10mg Tablets',
      genericName: 'Amlodipine',
      category: 'Pharmaceuticals',
      unit: 'Tablets',
      strength: '10mg',
      dosageForm: 'Tablet',
      currentStock: 480,
      reorderLevel: 100,
      unitCost: '8.50',
      sellingPrice: '15.00',
      storeLocation: 'Pharmacy Shelf A-03',
    }).returning();

    const [invAugmentin] = await db.insert(schema.inventoryItems).values({
      facilityId: facility1.id,
      itemCode: 'DRUG-AUG-625',
      name: 'Amoxicillin + Clavulanic Acid 625mg (Augmentin)',
      genericName: 'Amoxicillin / Clavulanate',
      category: 'Pharmaceuticals',
      unit: 'Tablets',
      strength: '625mg',
      dosageForm: 'Tablet',
      currentStock: 320,
      reorderLevel: 80,
      unitCost: '45.00',
      sellingPrice: '75.00',
      storeLocation: 'Pharmacy Shelf B-01',
    }).returning();

    const [invCoartem] = await db.insert(schema.inventoryItems).values({
      facilityId: facility1.id,
      itemCode: 'DRUG-COA-20',
      name: 'Artemether + Lumefantrine 20/120mg (Coartem)',
      genericName: 'Artemether / Lumefantrine',
      category: 'Pharmaceuticals',
      unit: 'Tablets',
      strength: '20/120mg',
      dosageForm: 'Tablet',
      currentStock: 850,
      reorderLevel: 200,
      unitCost: '18.00',
      sellingPrice: '35.00',
      storeLocation: 'Pharmacy Shelf A-01',
    }).returning();

    const [invParacetamol] = await db.insert(schema.inventoryItems).values({
      facilityId: facility1.id,
      itemCode: 'DRUG-PCM-500',
      name: 'Paracetamol 500mg Tablets (Kenya Essential List)',
      genericName: 'Paracetamol',
      category: 'Pharmaceuticals',
      unit: 'Tablets',
      strength: '500mg',
      dosageForm: 'Tablet',
      currentStock: 2400,
      reorderLevel: 500,
      unitCost: '1.50',
      sellingPrice: '5.00',
      storeLocation: 'Pharmacy Shelf C-02',
    }).returning();

    // 18. Batches
    await db.insert(schema.inventoryBatches).values([
      {
        itemId: invAmlodipine.id,
        batchNumber: 'B-AML-2026-08',
        expiryDate: '2028-06-30',
        quantityRemaining: 480,
        costPerUnit: '8.50',
      },
      {
        itemId: invAugmentin.id,
        batchNumber: 'B-AUG-2025-11',
        expiryDate: '2027-10-31',
        quantityRemaining: 320,
        costPerUnit: '45.00',
      },
    ]);

    // 19. Suppliers & Procurement
    const [supplier1] = await db.insert(schema.suppliers).values({
      tenantId: tenant1.id,
      name: 'Kenya Medical Supplies Authority (KEMSA)',
      contactPerson: 'Dennis Kiptoo',
      phone: '+254 20 392 2000',
      email: 'orders@kemsa.co.ke',
      kraPin: 'P051184910A',
      address: 'Commercial Street, Industrial Area, Nairobi',
    }).returning();

    await db.insert(schema.purchaseOrders).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      supplierId: supplier1.id,
      poNumber: 'PO-2026-0184',
      totalAmount: '145000.00',
      status: 'Approved',
      orderedBy: 'James Kimani (Chief Pharmacist)',
      approvedBy: 'Dr. Angela Omwamba (Medical Director)',
    });

    // 20. Billing Invoices & Payments
    const [invoice1] = await db.insert(schema.billingInvoices).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient1.id,
      encounterId: encounter1.id,
      invoiceNumber: 'INV-2026-0842',
      totalAmount: '4450.00',
      paidAmount: '4450.00',
      balanceAmount: '0.00',
      status: 'Paid',
      payerType: 'SHA',
      payerName: 'Social Health Authority (SHA)',
      memberNumber: 'SHA-8834921',
    }).returning();

    await db.insert(schema.billingItems).values([
      { invoiceId: invoice1.id, itemType: 'Consultation', description: 'Outpatient Medical Doctor Consultation', quantity: 1, unitPrice: '800.00', totalAmount: '800.00' },
      { invoiceId: invoice1.id, itemType: 'Laboratory', description: 'Renal Function Tests (RFT)', quantity: 1, unitPrice: '2200.00', totalAmount: '2200.00' },
      { invoiceId: invoice1.id, itemType: 'Radiology', description: 'Chest X-Ray PA View', quantity: 1, unitPrice: '1000.00', totalAmount: '1000.00' },
      { invoiceId: invoice1.id, itemType: 'Pharmacy', description: 'Amlodipine 10mg Tablets (30 tabs)', quantity: 30, unitPrice: '15.00', totalAmount: '450.00' },
    ]);

    await db.insert(schema.billingPayments).values({
      invoiceId: invoice1.id,
      receiptNumber: 'REC-2026-0422',
      paymentMethod: 'M-Pesa',
      amount: '4450.00',
      referenceCode: 'QHD827491X',
      cashierName: 'Brian Koech (Revenue Desk)',
    });

    // 21. Insurance / SHA Claims
    await db.insert(schema.insuranceClaims).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      patientId: patient1.id,
      invoiceId: invoice1.id,
      claimNumber: 'CLM-SHA-2026-0041',
      payerName: 'Social Health Authority (SHA)',
      policyNumber: 'SHA-KEN-2026-88349',
      preAuthCode: 'AUTH-SHA-984210',
      claimAmount: '4450.00',
      approvedAmount: '4450.00',
      status: 'Approved',
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      adjudicationNotes: 'E-claim validated against SHA tariff schedule. OPD benefit verified.',
    });

    // 22. Public Health Disease Surveillance (MOH 705 / DHIS2)
    await db.insert(schema.publicHealthReports).values([
      {
        facilityId: facility1.id,
        diseaseCode: 'B50',
        diseaseName: 'Malaria (Confirmed by Microscopy/RDT)',
        casesCount: 14,
        mortalityCount: 0,
        ageGroup: 'Over 5 Years',
        epiWeek: '2026-W40',
      },
      {
        facilityId: facility1.id,
        diseaseCode: 'B50',
        diseaseName: 'Malaria (Confirmed in Children)',
        casesCount: 8,
        mortalityCount: 0,
        ageGroup: 'Under 5 Years',
        epiWeek: '2026-W40',
      },
      {
        facilityId: facility1.id,
        diseaseCode: 'A00',
        diseaseName: 'Cholera (Suspected/Alert)',
        casesCount: 1,
        mortalityCount: 0,
        ageGroup: 'Over 5 Years',
        epiWeek: '2026-W40',
      },
      {
        facilityId: facility1.id,
        diseaseCode: 'J09',
        diseaseName: 'Severe Acute Respiratory Infection (SARI)',
        casesCount: 5,
        mortalityCount: 0,
        ageGroup: 'Under 5 Years',
        epiWeek: '2026-W40',
      },
    ]);

    // 23. Audit Log
    await db.insert(schema.auditLogs).values({
      tenantId: tenant1.id,
      facilityId: facility1.id,
      userId: 'staff-admin-01',
      action: 'SYSTEM_INIT',
      resource: 'Database',
      resourceId: 'ALL',
      details: 'AfyaHub Kenya HMIS initial multi-tenant database migration and bootstrap completed successfully.',
    });

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Error during database seeding:', error);
  }
}
