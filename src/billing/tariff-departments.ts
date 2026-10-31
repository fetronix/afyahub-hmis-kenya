/** Normalize facility department names without depending on HTTP or database modules. */
export const tariffModuleForDepartment = (department: string): string | null => {
  const value = department
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    opd: 'opd',
    outpatient: 'opd',
    inpatient: 'inpatient',
    maternity: 'maternity',
    ward: 'inpatient',
    theatre: 'theatre',
    operating_theatre: 'theatre',
    specialty: 'specialty',
    specialist: 'specialty',
    laboratory: 'laboratory',
    lab: 'laboratory',
    radiology: 'radiology',
    imaging: 'radiology',
    pharmacy: 'pharmacy',
    registration: 'registration',
    reception: 'reception',
    insurance: 'insurance',
    sha: 'insurance',
    finance: 'finance',
    general: 'finance',
  };
  return aliases[value] ?? null;
};
