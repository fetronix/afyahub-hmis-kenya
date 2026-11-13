import React, { useState } from 'react';
import { api } from '../../api/client.ts';
import type { AppointmentCategory } from '../../types/index.ts';
import { FormField, PrimaryButton, SecondaryButton } from '../ui/controls.tsx';

/** Category configuration is separate from tariff pricing and never creates a charge. */
export function AppointmentCategoryManager({
  facilityId,
  categories,
  refresh,
}: {
  facilityId: number;
  categories: AppointmentCategory[];
  refresh: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [service, setService] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.createAppointmentCategory({
        facilityId,
        code,
        name,
        ...(service ? { facilityServiceId: Number(service) } : {}),
      });
      setCode('');
      setName('');
      setService('');
      setNotice('Category saved. No charge or price was created.');
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Category could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(category: AppointmentCategory) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.updateAppointmentCategory(category.id, {
        facilityId,
        isActive: !category.isActive,
      });
      setNotice('Category status saved; existing appointments are retained.');
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Category could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border rounded bg-white p-4 text-xs">
      <summary className="font-semibold cursor-pointer">Manage appointment categories</summary>
      <p className="my-2 text-slate-600">
        Use facility-approved names and optional existing active service IDs. This does not
        configure prices or billing.
      </p>
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <FormField label="Category code *" htmlFor="category-code">
          <input
            id="category-code"
            required
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="border rounded p-2 w-full"
          />
        </FormField>
        <FormField label="Category name *" htmlFor="category-name">
          <input
            id="category-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded p-2 w-full"
          />
        </FormField>
        <FormField label="Existing service ID (optional)" htmlFor="category-service">
          <input
            id="category-service"
            type="number"
            min="1"
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="border rounded p-2 w-full"
          />
        </FormField>
        <PrimaryButton type="submit" disabled={busy}>
          Add category
        </PrimaryButton>
      </form>
      {error && (
        <p role="alert" className="text-rose-700 mt-2">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-800 mt-2">
          {notice}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {categories.map((category) => (
          <li key={category.id} className="flex items-center gap-2">
            <span>
              {category.name} ({category.code}) — {category.isActive ? 'Active' : 'Inactive'}
            </span>
            <SecondaryButton disabled={busy} onClick={() => void toggle(category)}>
              {category.isActive ? 'Deactivate' : 'Reactivate'}
            </SecondaryButton>
          </li>
        ))}
      </ul>
    </details>
  );
}
