import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { PortalInviteDialog } from '../portal/PortalInviteDialog.tsx';
import { BirthDatePicker } from './patient-registration/BirthDatePicker.tsx';
import { Patient } from '../../types/index.ts';
import { KENYA_COUNTIES, subCountiesOf } from '../../constants/kenya-locations.ts';
import {
  UserPlus,
  Search,
  User,
  Shield,
  Phone,
  Calendar,
  AlertCircle,
  Clock,
  ArrowRight,
  Eye,
  CheckCircle2,
  QrCode,
} from 'lucide-react';

function calculatePatientAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;

  const parts = dateOfBirth.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = parts;
  const birthDate = new Date(year, month - 1, day);

  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;

  if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) {
    age--;
  }

  if (age < 0) return null;
  return age;
}

export const PatientRegistrationModule: React.FC = () => {
  const {
    currentTenant,
    currentFacility,
    authenticatedUser,
    setSelectedPatient,
    setIsJourneyModalOpen,
    showToast,
    refreshKey,
    triggerRefresh,
  } = useHmis();

  /*
   * Portal invitation.
   *
   * Offered after a registration and from the directory, never applied
   * automatically: an account is created by the patient from a single-use
   * link after the desk confirms who they are. The button is hidden when
   * the signed-in user has no `portal.invite`, but the server checks that
   * again — hiding a button is not a control.
   */
  const [portalPatient, setPortalPatient] = useState<{ id: number; name: string } | null>(null);

  const canInviteToPortal = Boolean(
    authenticatedUser?.permissions?.includes('portal.invite') || authenticatedUser?.isSuperAdmin,
  );
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [loadedDirectoryScope, setLoadedDirectoryScope] = useState<string | null>(null);
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const directoryScope =
    currentTenant?.id && currentFacility?.id
      ? `${currentTenant.id}:${currentFacility.id}:${search}`
      : null;

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    email: '',
    nationalId: '',
    shaNumber: '',
    guardianName: '',
    guardianRelationship: '',
    guardianPhone: '',
    guardianShaNumber: '',
    bloodGroup: '',
    maritalStatus: '',
    occupation: '',
    county: '',
    subCounty: '',
    residentialAddress: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    allergies: '',
    chronicConditions: '',
    payerType: 'Self-Pay',
    insuranceProvider: '',
    policyNumber: '',
  });

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const patientAge = calculatePatientAge(formData.dateOfBirth);
  const isMinor = patientAge !== null && patientAge < 18;

  useEffect(() => {
    let cancelled = false;
    async function loadPatients() {
      setLoading(true);
      setDirectoryError('');
      setLoadedDirectoryScope(null);
      setPatients([]);
      if (!currentTenant?.id || !currentFacility?.id || !directoryScope) {
        setDirectoryError('Select an authorized facility to load the patient directory.');
        setLoading(false);
        return;
      }
      try {
        const list = await api.getPatients(currentTenant.id, currentFacility.id, search);
        if (cancelled) return;
        if (!Array.isArray(list)) throw new Error('Invalid directory response');
        setPatients(list);
        setLoadedDirectoryScope(directoryScope);
      } catch {
        if (!cancelled)
          setDirectoryError(
            'Patient directory could not be loaded. Do not assume no patients exist; duplicate hints are unavailable.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPatients();
    return () => {
      cancelled = true;
    };
  }, [currentTenant?.id, currentFacility?.id, directoryScope, search, refreshKey, directoryRetry]);

  // A sub-county only means something inside its county, so changing the
  // county clears the one already chosen. Without this, "Nyeri" could keep a
  // "Kasarani" sub-county left over from the previous selection.
  const handleCountyChange = (county: string) => {
    setFormData((prev) => ({ ...prev, county, subCounty: '' }));
  };

  // Duplicate Check logic
  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    if (field === 'nationalId' && value.trim().length > 4) {
      const match = patients.find((p) => p.nationalId === value.trim());
      if (match) {
        setDuplicateWarning(
          `Potential Duplicate! Patient "${match.firstName} ${match.lastName}" (MRN: ${match.mrn}) already registered with National ID ${value}`,
        );
      } else {
        setDuplicateWarning(null);
      }
    } else if (field === 'phone' && value.trim().length > 8) {
      const match = patients.find((p) => p.phone === value.trim());
      if (match) {
        setDuplicateWarning(
          `Potential Duplicate! Patient "${match.firstName} ${match.lastName}" (MRN: ${match.mrn}) shares phone number ${value}`,
        );
      } else {
        setDuplicateWarning(null);
      }
    }
  };

  const handleRegisterPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTenant?.id || !currentFacility?.id) {
      showToast('Registration unavailable: select an authorized facility first.');
      return;
    }

    const missingRequiredFields: string[] = [];

    if (!formData.firstName.trim()) missingRequiredFields.push('First Name');
    if (!formData.lastName.trim()) missingRequiredFields.push('Last Name');
    if (!formData.dateOfBirth) missingRequiredFields.push('Date of Birth');
    if (!formData.gender) missingRequiredFields.push('Gender');

    if (missingRequiredFields.length > 0) {
      showToast(`Please complete required fields: ${missingRequiredFields.join(', ')}`);
      return;
    }

    if (saving) return;
    setSaving(true);
    let newPatient: Patient;
    try {
      /*
       * No MRN is sent: the server allocates the next number for this
       * tenant. Four random digits had 9,000 possible values for the
       * whole database, and a collision failed the registration.
       */
      newPatient = await api.createPatient({
        ...formData,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        nationalId: formData.nationalId.trim() || null,
        shaNumber: formData.shaNumber.trim() || null,
        bloodGroup: formData.bloodGroup.trim() || null,
        guardianName: formData.guardianName.trim() || null,
        guardianRelationship: formData.guardianRelationship.trim() || null,
        guardianPhone: formData.guardianPhone.trim() || null,
        guardianShaNumber: formData.guardianShaNumber.trim() || null,
        registrationFacilityId: currentFacility.id,
      });
    } catch {
      // A lost response may follow a successful write; do not tell the user to
      // retry blindly. Patient creation does not yet have an idempotency key.
      setIsRegistering(false);
      triggerRefresh();
      showToast(
        'Registration could not be confirmed. The patient may have been saved; search the directory before trying again.',
      );
      setSaving(false);
      return;
    }

    setIsRegistering(false);
    triggerRefresh();
    try {
      const triageEntry = await api.createQueueItem({
        tenantId: currentTenant.id,
        facilityId: currentFacility.id,
        patientId: newPatient.id,
        queueType: 'Triage',
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });
      showToast(
        `Patient ${newPatient.firstName} ${newPatient.lastName} registered (MRN: ${newPatient.mrn}) and routed to Triage — token ${triageEntry.tokenNumber}.`,
      );
    } catch {
      showToast(
        `Patient registered (MRN: ${newPatient.mrn}), but triage routing could not be confirmed. Check the queue before routing again; do not register the patient again.`,
      );
    } finally {
      setSaving(false);
    }
    if (canInviteToPortal)
      setPortalPatient({
        id: newPatient.id,
        name: `${newPatient.firstName} ${newPatient.lastName}`,
      });
  };

  const sendToQueue = async (patient: Patient, queueType: string) => {
    try {
      const entry = await api.createQueueItem({
        tenantId: patient.tenantId,
        facilityId: patient.facilityId,
        patientId: patient.id,
        queueType,
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });
      showToast(
        `Patient ${patient.firstName} ${patient.lastName} added to ${queueType} queue (Token: ${entry.tokenNumber})`,
      );
      triggerRefresh();
    } catch (err: any) {
      showToast(`Queue failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
            Patient Identification & Registration
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Search central medical records, check duplicates, review SHA eligibility information,
            and register returning/new patients.
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="flex-1 sm:flex-none px-4 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 active:bg-orange-800 rounded-lg transition-colors shadow-xs flex items-center justify-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>{isRegistering ? 'View Patient Directory' : 'New Patient Registration'}</span>
          </button>
        </div>
      </div>

      {isRegistering ? (
        /* REGISTRATION FORM */
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
          <div className="border-b border-slate-200 pb-3 mb-5">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Kenyan Health Facility Patient Registration Form
            </h2>
            <p className="text-2xs text-slate-500">
              Captures national identifier, Social Health Authority (SHA) coverage, biometric link,
              and clinical alerts.
            </p>
          </div>

          <p className="mb-3 text-2xs text-slate-600">
            Duplicate hints use only the currently loaded directory results and do not guarantee
            uniqueness.
          </p>
          {directoryError && (
            <p role="alert" className="mb-3 text-rose-800">
              {directoryError}
            </p>
          )}
          {duplicateWarning && (
            <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{duplicateWarning}</span>
            </div>
          )}

          <form onSubmit={handleRegisterPatient} className="space-y-6 text-xs">
            {/* Section 1: Demographics */}
            <div>
              <div className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                1. Bio-Demographic Information
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => handleInputChange('firstName', e.target.value)}
                    placeholder="e.g. Juma"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Middle Name</label>
                  <input
                    type="text"
                    value={formData.middleName}
                    onChange={(e) => handleInputChange('middleName', e.target.value)}
                    placeholder="e.g. Omondi"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Last / Surname *</label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => handleInputChange('lastName', e.target.value)}
                    placeholder="e.g. Otieno"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>

                <div>
                  <BirthDatePicker
                    value={formData.dateOfBirth}
                    onChange={(value) => handleInputChange('dateOfBirth', value)}
                  />
                  {patientAge !== null && (
                    <p className="mt-1 text-slate-500">
                      Age: {patientAge} years
                      {isMinor ? ' · Guardian details recommended' : ''}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Gender *</label>
                  <select
                    required
                    value={formData.gender}
                    onChange={(e) => handleInputChange('gender', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  >
                    <option value="" disabled>
                      Select gender
                    </option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Blood Group</label>
                  <select
                    value={formData.bloodGroup}
                    onChange={(e) => handleInputChange('bloodGroup', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  >
                    <option value="">Unknown / Not tested</option>
                    <option value="O+">O Positive (O+)</option>
                    <option value="O-">O Negative (O-)</option>
                    <option value="A+">A Positive (A+)</option>
                    <option value="A-">A Negative (A-)</option>
                    <option value="B+">B Positive (B+)</option>
                    <option value="B-">B Negative (B-)</option>
                    <option value="AB+">AB Positive (AB+)</option>
                    <option value="AB-">AB Negative (AB-)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: National Identifiers & Contacts */}
            <div className="pt-4 border-t border-slate-100">
              <div className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                2. National Identification & Contacts
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Kenya National ID / Passport
                  </label>
                  <input
                    type="text"
                    value={formData.nationalId}
                    onChange={(e) => handleInputChange('nationalId', e.target.value)}
                    placeholder="e.g. 28491024"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Social Health Authority (SHA) #
                  </label>
                  <input
                    type="text"
                    value={formData.shaNumber}
                    onChange={(e) => handleInputChange('shaNumber', e.target.value)}
                    placeholder="e.g. SHA-8834921"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Phone Number (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    placeholder="+254 700 000 000"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    County of Residence
                  </label>
                  <select
                    value={formData.county}
                    onChange={(e) => handleCountyChange(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  >
                    <option value="">Select county</option>
                    {KENYA_COUNTIES.map((county) => (
                      <option key={county.code} value={county.name}>
                        {county.code}. {county.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Sub-County</label>
                  <select
                    value={formData.subCounty}
                    onChange={(e) => handleInputChange('subCounty', e.target.value)}
                    disabled={!formData.county}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {formData.county ? 'Select sub-county' : 'Select a county first'}
                    </option>
                    {subCountiesOf(formData.county).map((subCounty) => (
                      <option key={subCounty} value={subCounty}>
                        {subCounty}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Residential Address
                  </label>
                  <input
                    type="text"
                    value={formData.residentialAddress}
                    onChange={(e) => handleInputChange('residentialAddress', e.target.value)}
                    placeholder="e.g. Parklands 4th Ave, Nairobi"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
              </div>
            </div>

            {isMinor && (
              <div className="pt-4 border-t border-slate-100">
                <div className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Parent / Guardian Details
                </div>
                <p className="text-slate-500 mb-3">
                  Patient is under 18. Record the responsible adult separately from the patient's
                  own details.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Guardian Full Name
                    </label>
                    <input
                      type="text"
                      value={formData.guardianName}
                      onChange={(e) => handleInputChange('guardianName', e.target.value)}
                      placeholder="Parent or guardian's full name"
                      className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Relationship to Patient
                    </label>
                    <select
                      value={formData.guardianRelationship}
                      onChange={(e) => handleInputChange('guardianRelationship', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                    >
                      <option value="">Select relationship</option>
                      <option value="Mother">Mother</option>
                      <option value="Father">Father</option>
                      <option value="Guardian">Legal / Other Guardian</option>
                      <option value="Grandparent">Grandparent</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Guardian Phone (optional)
                    </label>
                    <input
                      type="text"
                      value={formData.guardianPhone}
                      onChange={(e) => handleInputChange('guardianPhone', e.target.value)}
                      placeholder="+254 700 000 000"
                      className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Guardian SHA / Member Number (optional)
                    </label>
                    <input
                      type="text"
                      value={formData.guardianShaNumber}
                      onChange={(e) => handleInputChange('guardianShaNumber', e.target.value)}
                      placeholder="Guardian's number, not the child's"
                      className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                    />
                    <p className="mt-1 text-slate-500">
                      Recording a number does not verify SHA membership or coverage.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Section 3: Next of Kin & Payer */}
            <div className="pt-4 border-t border-slate-100">
              <div className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                3. Next of Kin & Payer Information
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Emergency Contact Name
                  </label>
                  <input
                    type="text"
                    value={formData.emergencyContactName}
                    onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                    placeholder="e.g. Beryl Otieno"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Relationship</label>
                  <input
                    type="text"
                    value={formData.emergencyContactRelationship}
                    onChange={(e) =>
                      handleInputChange('emergencyContactRelationship', e.target.value)
                    }
                    placeholder="Spouse / Parent / Sibling"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Emergency Contact Phone
                  </label>
                  <input
                    type="text"
                    value={formData.emergencyContactPhone}
                    onChange={(e) => handleInputChange('emergencyContactPhone', e.target.value)}
                    placeholder="+254 700 000 000"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Payer Scheme *</label>
                  <select
                    value={formData.payerType}
                    onChange={(e) => handleInputChange('payerType', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  >
                    <option value="Self-Pay">Self-Pay (Cash / M-Pesa)</option>
                    <option value="SHA">Social Health Authority (SHA)</option>
                    <option value="Insurance">Private Insurance</option>
                    <option value="Corporate">Corporate Scheme</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Insurance / Payer Name
                  </label>
                  <input
                    type="text"
                    value={formData.insuranceProvider}
                    onChange={(e) => handleInputChange('insuranceProvider', e.target.value)}
                    placeholder="e.g. Jubilee / APA / Britam / SHA"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Policy / Member Number
                  </label>
                  <input
                    type="text"
                    value={formData.policyNumber}
                    onChange={(e) => handleInputChange('policyNumber', e.target.value)}
                    placeholder="e.g. JUB-CORP-99214"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Section 4: Clinical Alerts */}
            <div className="pt-4 border-t border-slate-100">
              <div className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                4. Known Allergies & Chronic Conditions
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Known Drug & Food Allergies
                  </label>
                  <input
                    type="text"
                    value={formData.allergies}
                    onChange={(e) => handleInputChange('allergies', e.target.value)}
                    placeholder="e.g. Penicillin, Sulfa, Aspirin"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    Pre-Existing Chronic Conditions
                  </label>
                  <input
                    type="text"
                    value={formData.chronicConditions}
                    onChange={(e) => handleInputChange('chronicConditions', e.target.value)}
                    placeholder="e.g. Essential Hypertension, Type 2 Diabetes, Asthma"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsRegistering(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-700 text-white rounded-lg font-semibold hover:bg-blue-800 transition-colors shadow-xs"
              >
                {saving ? 'Registering...' : 'Complete Registration & Route to Triage'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* PATIENT DIRECTORY */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          {/* Search Bar */}
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient name, MRN, National ID, Phone, SHA #..."
                className="w-full pl-9 pr-4 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600 bg-white"
              />
            </div>

            <div className="text-xs text-slate-500 font-mono">
              Displayed records:{' '}
              <strong>
                {loadedDirectoryScope === directoryScope && !directoryError
                  ? patients.length
                  : 'Unavailable'}
              </strong>
            </div>
          </div>

          {directoryError && (
            <div role="alert" className="p-4 text-xs text-rose-800">
              {directoryError}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setDirectoryRetry((n) => n + 1)}
              >
                Retry patient directory
              </button>
            </div>
          )}
          {/* Table */}
          {!directoryError && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">MRN #</th>
                    <th className="px-4 py-2.5 font-medium">Patient Full Name</th>
                    <th className="px-4 py-2.5 font-medium">National ID / SHA</th>
                    <th className="px-4 py-2.5 font-medium">Age / Gender</th>
                    <th className="px-4 py-2.5 font-medium">Phone & County</th>
                    <th className="px-4 py-2.5 font-medium">Payer Scheme</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {loading || loadedDirectoryScope !== directoryScope ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-slate-400 font-sans">
                        Loading patient master index...
                      </td>
                    </tr>
                  ) : patients.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-slate-400 font-sans">
                        No patients found matching "{search}". Click "New Patient Registration" to
                        add.
                      </td>
                    </tr>
                  ) : (
                    patients.map((p) => {
                      const birthYear = new Date(p.dateOfBirth).getFullYear();
                      const age = new Date().getFullYear() - birthYear;

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-bold text-slate-900">{p.mrn}</td>
                          <td className="px-4 py-3 font-sans">
                            <button
                              onClick={() => {
                                setSelectedPatient(p);
                                setIsJourneyModalOpen(true);
                              }}
                              className="block font-semibold text-slate-900 hover:text-blue-700 text-left"
                            >
                              {p.firstName} {p.middleName ? `${p.middleName} ` : ''}
                              {p.lastName}
                            </button>
                            {p.allergies && p.allergies !== 'None known' && (
                              <span className="mt-1 block max-w-[18rem] rounded-md border border-rose-100 bg-rose-50 px-2 py-1 text-2xs font-medium leading-snug text-rose-700">
                                Allergy: {p.allergies}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div>ID: {p.nationalId || 'N/A'}</div>
                            <div className="text-orange-700 font-semibold text-2xs">
                              {p.shaNumber || 'No SHA'}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-sans text-slate-700">
                            {age} yrs · {p.gender}
                          </td>
                          <td className="px-4 py-3 text-slate-700 font-sans">
                            <div className="font-mono">{p.phone}</div>
                            <div className="text-2xs text-slate-400">
                              {[p.subCounty, p.county].filter(Boolean).join(', ')}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-sans">
                            <span
                              className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                                p.payerType === 'SHA'
                                  ? 'bg-orange-50 text-orange-900 border border-orange-200'
                                  : p.payerType === 'Insurance'
                                    ? 'bg-blue-50 text-blue-900 border border-blue-200'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {p.payerType}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-sans">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setSelectedPatient(p);
                                  setIsJourneyModalOpen(true);
                                }}
                                className="px-2 py-1 text-2xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                                title="View Patient Record"
                              >
                                Profile
                              </button>
                              <button
                                onClick={() => sendToQueue(p, 'Triage')}
                                className="px-2 py-1 text-2xs font-medium text-blue-800 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                                title="Route to Triage"
                              >
                                + Triage
                              </button>
                              <button
                                onClick={() => sendToQueue(p, 'Doctor')}
                                className="px-2 py-1 text-2xs font-medium text-emerald-800 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors"
                                title="Route to Doctor Consultation"
                              >
                                + Doctor
                              </button>
                              {canInviteToPortal ? (
                                <button
                                  onClick={() =>
                                    setPortalPatient({
                                      id: p.id,
                                      name: `${p.firstName} ${p.lastName}`,
                                    })
                                  }
                                  className="px-2 py-1 text-2xs font-medium text-blue-800 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                                  title="Activate patient portal / send invitation"
                                >
                                  <QrCode className="mr-0.5 inline h-3 w-3" />
                                  Portal
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {portalPatient ? (
        <PortalInviteDialog
          patientId={portalPatient.id}
          patientName={portalPatient.name}
          open
          onClose={() => setPortalPatient(null)}
          onChanged={() => triggerRefresh()}
        />
      ) : null}
    </div>
  );
};
