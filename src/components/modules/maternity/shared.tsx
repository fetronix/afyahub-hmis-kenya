/**
 * Shared types, clinical option lists, pure input-coercion helpers, and
 * presentation primitives for the Maternity & MCH workflow screens.
 */

import React from 'react';
import type { Patient } from '../../../types/index.ts';
import type { ServiceCharge } from '../../../api/client.ts';

export type MaternityTab = 'anc' | 'labour' | 'deliveries' | 'postnatal' | 'immunisation';

export type RunMaternityAction = (
  action: () => Promise<void>,
  fallbackMessage: string,
) => Promise<void>;

export interface BabyDraft {
  outcome: string;
  sex: string;
  birthWeightGrams: string;
  apgar1: string;
  apgar5: string;
  resuscitation: string;
}

export interface DeliveryDraft {
  pregnancyId: string;
  labourRecordId: string;
  deliveredAt: string;
  deliveryMode: string;
  bloodLossMl: string;
  perineum: string;
  placentaComplete: string;
  oxytocinGiven: boolean;
  complications: string;
  notes: string;
}

export interface LastDeliveryCharge {
  patient: string;
  charge: ServiceCharge;
}

export const fieldClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';

export const labelClass = 'mb-1 block text-xs font-semibold text-slate-700';

/*
 * Presentation lists. The server validates every one of these on the way
 * in, so a stale option here is refused rather than stored.
 */
export const INVOLUTION_OPTIONS = ['Normal', 'Subinvolution', 'Not examined'];
export const LOCHIA_OPTIONS = ['Rubra', 'Serosa', 'Alba', 'Abnormal', 'Not examined'];
export const PERINEUM_OPTIONS = [
  'Intact',
  'Healing',
  'Infected',
  'Dehisced',
  'Episiotomy healing',
  'Not examined',
];
export const BREAST_OPTIONS = ['Normal', 'Engorged', 'Cracked nipples', 'Mastitis'];
export const BREASTFEEDING_OPTIONS = ['Exclusive', 'Mixed', 'Formula', 'Not breastfeeding'];
export const MOOD_OPTIONS = ['Not screened', 'No concern', 'Concern — referred'];

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** '' -> undefined, so an untouched field is absent rather than zero. */
export function num(value: string): number | undefined {
  if (value.trim() === '') return undefined;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function text(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

export function formatGestation(
  gestation: { weeks: number; days: number } | null | undefined,
): string {
  if (!gestation) return '—';

  return `${gestation.weeks}w ${gestation.days}d`;
}

export function patientName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;

  return fallback;
}

/** Children under five, for the immunisation card picker. */
export function isUnderFive(patient: Patient, nowMs = Date.now()): boolean {
  if (!patient.dateOfBirth) return false;

  const born = new Date(`${patient.dateOfBirth}T00:00:00Z`).getTime();

  if (!Number.isFinite(born)) return false;

  return nowMs - born < 5 * 365.25 * 86_400_000;
}

export function doseStatusClass(status: string): string {
  switch (status) {
    case 'Overdue':
      return 'bg-rose-100 text-rose-800';
    case 'Due':
      return 'bg-amber-100 text-amber-900';
    case 'Given':
      return 'bg-emerald-100 text-emerald-800';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function statusClass(status: string): string {
  const base = 'rounded px-2 py-0.5 text-2xs font-semibold';

  if (status === 'Active' || status === 'In Labour') {
    return `${base} bg-teal-50 text-teal-900 border border-teal-200`;
  }

  if (status === 'Delivered') {
    return `${base} bg-emerald-50 text-emerald-800 border border-emerald-200`;
  }

  if (status === 'Referred' || status === 'Transferred') {
    return `${base} bg-amber-50 text-amber-900 border border-amber-200`;
  }

  return `${base} bg-slate-100 text-slate-700`;
}

export function createEmptyBaby(): BabyDraft {
  return {
    outcome: 'Live Birth',
    sex: '',
    birthWeightGrams: '',
    apgar1: '',
    apgar5: '',
    resuscitation: '',
  };
}

export function updateBaby(
  babies: BabyDraft[],
  index: number,
  patch: Partial<BabyDraft>,
): BabyDraft[] {
  return babies.map((baby, position) => (position === index ? { ...baby, ...patch } : baby));
}

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <label className={labelClass}>{label}</label>
    {children}
  </div>
);

export const Reading: React.FC<{ label: string; value: string | number | null }> = ({
  label,
  value,
}) => (
  <span>
    <span className="text-slate-400">{label} </span>
    <span className="font-mono text-slate-700">{value === null || value === '' ? '—' : value}</span>
  </span>
);

export const SummaryChip: React.FC<{
  label: string;
  value?: number;
  tone?: 'brand' | 'ember';
}> = ({ label, value, tone }) => (
  <span
    className={`rounded-lg border px-2.5 py-1.5 text-2xs ${
      tone === 'brand'
        ? 'border-brand-200 bg-brand-50 text-brand-900'
        : tone === 'ember'
          ? 'border-ember-300 bg-ember-50 text-ember-900'
          : 'border-hair bg-surface text-ink'
    }`}
  >
    <span className="block font-semibold uppercase tracking-wider">{label}</span>
    <span className="font-mono text-sm font-bold">{value === undefined ? '—' : value}</span>
  </span>
);
