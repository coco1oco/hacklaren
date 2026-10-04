import type { PatientInput } from '@shared/schemas';

export const EMPTY_PATIENT: PatientInput = {
  name: '',
  birthdate: '',
  address: '',
  barangay: '',
  contactNumber: '',
  emergencyContact: { name: '', relationship: '', contactNumber: '' },
  pregnancy: { lmp: '', edd: '', gravida: 1, para: 0 },
  allergies: [],
  bloodType: 'Unknown',
  medicalHistory: [],
  obstetricHistory: [],
  consentGiven: false,
};
