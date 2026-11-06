import React, { useState } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { FacilityPaymentIntegrations } from './payment-hub/FacilityPaymentIntegrations.tsx';
import { FacilityPayerIntegrations } from './payer-hub/FacilityPayerIntegrations.tsx';
import { IntegrationConfigurationAudit } from './IntegrationConfigurationAudit.tsx';

type Category = 'all' | 'mobile' | 'banking' | 'insurance' | 'public';

/** A single marketplace over the existing, independently authorized domain hubs. */
export function FacilityIntegrationHub() {
  const { currentFacility, authenticatedUser } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuper = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const payments = !isSuper && permissions.has('payment_hub.catalogue.read');
  const payers = !isSuper && permissions.has('payer_hub.catalogue.read');
  const [category, setCategory] = useState<Category>('all');
  if (isSuper) return <p>Facility integrations require an authorized facility-scoped user.</p>;
  if (!currentFacility) return <p>Select an authorized facility to view integrations.</p>;
  if (!payments && !payers) return <p>You do not have permission to view integrations.</p>;

  const categories: Array<{ id: Category; label: string }> = [
    { id: 'all', label: 'All providers' },
    ...(payments
      ? ([
          { id: 'mobile', label: 'Mobile money' },
          { id: 'banking', label: 'Banking' },
        ] as const)
      : []),
    ...(payers
      ? ([
          { id: 'insurance', label: 'Private insurance' },
          { id: 'public', label: 'Public schemes' },
        ] as const)
      : []),
  ];
  // Avoid rendering another domain if permissions change while the screen is open.
  const selected = categories.some((item) => item.id === category) ? category : 'all';
  return (
    <section aria-label="Facility Integration Hub" className="space-y-5">
      <div className="rounded-xl border border-teal-100 bg-teal-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
          Facility marketplace
        </p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">Integration Hub</h2>
        <p className="mt-1 text-sm text-slate-700">
          {currentFacility.name} · Discover providers, request access and manage authorized
          facility-specific configurations. A listing is not an API contract or approval.
        </p>
      </div>
      <nav aria-label="Integration categories" className="flex flex-wrap gap-2">
        {categories.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === item.id}
            onClick={() => setCategory(item.id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              selected === item.id
                ? 'bg-teal-700 text-white'
                : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {payments && (selected === 'all' || selected === 'mobile' || selected === 'banking') && (
        <FacilityPaymentIntegrations category={selected === 'all' ? 'all' : selected} />
      )}
      {payers && (selected === 'all' || selected === 'insurance' || selected === 'public') && (
        <>
          <FacilityPayerIntegrations category={selected === 'all' ? 'all' : selected} />
          {(selected === 'all' || selected === 'public') && (
            <div className="grid gap-4 md:grid-cols-2" aria-label="Separate public interfaces">
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-bold text-slate-900">AfyaLink</h3>
                <p className="mt-1 text-sm text-amber-800">
                  Live transport unavailable · facility API access and interface review required
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  A distinct interface; SHA registration does not establish AfyaLink connectivity.
                </p>
                <a
                  className="mt-2 inline-block text-xs font-semibold text-teal-700 underline"
                  href="https://afyalink.dha.go.ke/sha-portal-api-integration"
                  target="_blank"
                  rel="noreferrer"
                >
                  Official integration information ↗
                </a>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-bold text-slate-900">DHA eClaims / HIE</h3>
                <p className="mt-1 text-sm text-amber-800">
                  Live transport unavailable · facility API access and interface review required
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  DHA's draft guidance is not proof of a facility contract, submission or payment.
                </p>
                <a
                  className="mt-2 inline-block text-xs font-semibold text-teal-700 underline"
                  href="https://fhir.dha.go.ke/ig/eclaims/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Official draft implementation guide ↗
                </a>
              </article>
            </div>
          )}
        </>
      )}
      <IntegrationConfigurationAudit
        key={`${currentFacility.id}-${payments && permissions.has('payment_hub.facility.manage')}-${payers && permissions.has('payer_hub.facility.manage')}`}
        facilityId={currentFacility.id}
        canViewPayments={payments && permissions.has('payment_hub.facility.manage')}
        canViewPayers={payers && permissions.has('payer_hub.facility.manage')}
      />
    </section>
  );
}
