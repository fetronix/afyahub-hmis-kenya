import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Patient } from '../../types/index.ts';
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
  CheckCircle2
} from 'lucide-react';

export const PatientRegistrationModule: React.FC = () => {
  const { currentTenant, currentFacility, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '1995-01-01',
    gender: 'Male',
    phone: '+254 ',
    email: '',
    nationalId: '',
    shaNumber: '',
    bloodGroup: 'O+',
    maritalStatus: 'Single',
    occupation: '',
    county: 'Nairobi',
    subCounty: 'Westlands',
    residentialAddress: '',
    emergencyContactName: '',
    emergencyContactPhone: '+254 ',
    emergencyContactRelationship: 'Spouse',
    allergies: 'None known',
    chronicConditions: 'None known',
    payerType: 'Self-Pay',
    insuranceProvider: '',
    policyNumber: '',
  });

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    async function loadPatients() {
      setLoading(true);
      try {
        const list = await api.getPatients(currentTenant?.id, currentFacility?.id, search);
        setPatients(list);
      } catch (err) {
        console.error('Failed to load patients:', err);
      } finally {
        setLoading(false);
      }
    }
    loadPatients();
  }, [currentTenant, currentFacility, search, refreshKey]);

  // Duplicate Check logic
  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    if (field === 'nationalId' && value.trim().length > 4) {
      const match = patients.find(p => p.nationalId === value.trim());
      if (match) {
        setDuplicateWarning(`Potential Duplicate! Patient "${match.firstName} ${match.lastName}" (MRN: ${match.mrn}) already registered with National ID ${value}`);
      } else {
        setDuplicateWarning(null);
      }
    } else if (field === 'phone' && value.trim().length > 8) {
      const match = patients.find(p => p.phone === value.trim());
      if (match) {
        setDuplicateWarning(`Potential Duplicate! Patient "${match.firstName} ${match.lastName}" (MRN: ${match.mrn}) shares phone number ${value}`);
      } else {
        setDuplicateWarning(null);
      }
    }
  };

  const handleRegisterPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName || !formData.lastName || !formData.phone) {
      showToast('Please fill in required fields: First Name, Last Name, Phone');
      return;
    }

    try {
      const randomMrn = `MRN-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      const newPatient = await api.createPatient({
        ...formData,
        mrn: randomMrn,
        tenantId: currentTenant?.id || 1,
        facilityId: currentFacility?.id || 1,
      });

      // Automatically add to Triage Queue
      await api.createQueueItem({
        tenantId: currentTenant?.id || 1,
        facilityId: currentFacility?.id || 1,
        patientId: newPatient.id,
        queueType: 'Triage',
        tokenNumber: `TRG-${Math.floor(100 + Math.random() * 900)}`,
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });

      showToast(`Patient ${newPatient.firstName} ${newPatient.lastName} registered successfully (MRN: ${newPatient.mrn}) and routed to Triage queue!`);
      setIsRegistering(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Registration failed: ${err.message}`);
    }
  };

  const sendToQueue = async (patient: Patient, queueType: string) => {
    try {
      const tokenPrefix = queueType.slice(0, 3).toUpperCase();
      const token = `${tokenPrefix}-${Math.floor(100 + Math.random() * 900)}`;
      await api.createQueueItem({
        tenantId: patient.tenantId,
        facilityId: patient.facilityId,
        patientId: patient.id,
        queueType,
        tokenNumber: token,
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });
      showToast(`Patient ${patient.firstName} ${patient.lastName} added to ${queueType} queue (Token: ${token})`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Queue failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Patient Identification & Registration</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Search central medical records, check duplicates, verify SHA eligibility, and register returning/new patients.
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
              Captures national identifier, Social Health Authority (SHA) coverage, biometric link, and clinical alerts.
            </p>
          </div>

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
                  <label className="block text-slate-700 font-medium mb-1">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={formData.dateOfBirth}
                    onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Gender *</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => handleInputChange('gender', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  >
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
                  <label className="block text-slate-700 font-medium mb-1">Kenya National ID / Passport</label>
                  <input
                    type="text"
                    value={formData.nationalId}
                    onChange={(e) => handleInputChange('nationalId', e.target.value)}
                    placeholder="e.g. 28491024"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Social Health Authority (SHA) #</label>
                  <input
                    type="text"
                    value={formData.shaNumber}
                    onChange={(e) => handleInputChange('shaNumber', e.target.value)}
                    placeholder="e.g. SHA-8834921"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    placeholder="+254 700 000 000"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">County of Residence</label>
                  <select
                    value={formData.county}
                    onChange={(e) => handleInputChange('county', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  >
                    <option value="Nairobi">Nairobi</option>
                    <option value="Mombasa">Mombasa</option>
                    <option value="Kisumu">Kisumu</option>
                    <option value="Nakuru">Nakuru</option>
                    <option value="Kiambu">Kiambu</option>
                    <option value="Machakos">Machakos</option>
                    <option value="Kilifi">Kilifi</option>
                    <option value="Uasin Gishu">Uasin Gishu</option>
                    <option value="Nyeri">Nyeri</option>
                    <option value="Meru">Meru</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Sub-County</label>
                  <input
                    type="text"
                    value={formData.subCounty}
                    onChange={(e) => handleInputChange('subCounty', e.target.value)}
                    placeholder="e.g. Westlands / Langata"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Residential Address</label>
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

            {/* Section 3: Next of Kin & Payer */}
            <div className="pt-4 border-t border-slate-100">
              <div className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                3. Next of Kin & Payer Information
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Emergency Contact Name</label>
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
                    onChange={(e) => handleInputChange('emergencyContactRelationship', e.target.value)}
                    placeholder="Spouse / Parent / Sibling"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Emergency Contact Phone</label>
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
                  <label className="block text-slate-700 font-medium mb-1">Insurance / Payer Name</label>
                  <input
                    type="text"
                    value={formData.insuranceProvider}
                    onChange={(e) => handleInputChange('insuranceProvider', e.target.value)}
                    placeholder="e.g. Jubilee / APA / Britam / SHA"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Policy / Member Number</label>
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
                  <label className="block text-slate-700 font-medium mb-1">Known Drug & Food Allergies</label>
                  <input
                    type="text"
                    value={formData.allergies}
                    onChange={(e) => handleInputChange('allergies', e.target.value)}
                    placeholder="e.g. Penicillin, Sulfa, Aspirin"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Pre-Existing Chronic Conditions</label>
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
                className="px-5 py-2 bg-blue-700 text-white rounded-lg font-semibold hover:bg-blue-800 transition-colors shadow-xs"
              >
                Complete Registration & Route to Triage
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
              Total Records: <strong>{patients.length}</strong>
            </div>
          </div>

          {/* Table */}
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
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-slate-400 font-sans">
                      Loading patient master index...
                    </td>
                  </tr>
                ) : patients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-slate-400 font-sans">
                      No patients found matching "{search}". Click "New Patient Registration" to add.
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
                            className="font-semibold text-slate-900 hover:text-blue-700 text-left"
                          >
                            {p.firstName} {p.middleName ? `${p.middleName} ` : ''}{p.lastName}
                          </button>
                          {p.allergies && p.allergies !== 'None known' && (
                            <span className="block text-2xs text-rose-600 font-medium">
                              Allergy: {p.allergies}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>ID: {p.nationalId || 'N/A'}</div>
                          <div className="text-orange-700 font-semibold text-2xs">{p.shaNumber || 'No SHA'}</div>
                        </td>
                        <td className="px-4 py-3 font-sans text-slate-700">
                          {age} yrs · {p.gender}
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-sans">
                          <div className="font-mono">{p.phone}</div>
                          <div className="text-2xs text-slate-400">{p.county}</div>
                        </td>
                        <td className="px-4 py-3 font-sans">
                          <span className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                            p.payerType === 'SHA'
                              ? 'bg-orange-50 text-orange-900 border border-orange-200'
                              : p.payerType === 'Insurance'
                              ? 'bg-blue-50 text-blue-900 border border-blue-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
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
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
