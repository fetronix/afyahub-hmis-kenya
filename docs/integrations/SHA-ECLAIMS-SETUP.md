# SHA / DHA eClaims: implementation and onboarding status

**Operational status (28 October 2026):** No SHA/DHA/AfyaLink sandbox or production connection has been verified. Application transport, external submission/status/eligibility calls, callback registration and the SHA webhook are blocked. Mocks in unit and database tests are synthetic and do not establish connectivity, eligibility, authorization, acceptance or payment. See [the payer integration hub guide](payer-integration-hub.md) for the current workflow, permissions, migration and blockers.

The draft FHIR builder has not been externally validated or certified against the DHA implementation guide. The repository retains protocol and FHIR boundaries in `src/integrations/sha/` and local SHA workflows in `src/insurance/eclaims/`. Local claim preparation reuses patients, encounters, facility tariffs and invoice lines. Authorization, adjudication, receipt and payment are distinct; local benefit calculations are estimates. Eligibility records produced by a simulated adapter cannot verify a patient for claim validation or coverage.

The three public sources below describe distinct interfaces; their existence does not prove that this application is conformant or that a facility is onboarded:

- [DHA HIE introduction](https://hie-docs.dha.go.ke/introduction), [billing](https://hie-docs.dha.go.ke/eclaims/billing) and [callback documentation](https://hie-docs.dha.go.ke/eclaims/status-callbacks).
- [AfyaLink SHA portal integration](https://afyalink.dha.go.ke/sha-portal-api-integration).
- [DHA eClaims FHIR R4 draft and downloads](https://fhir.dha.go.ke/ig/eclaims/downloads.html).

Do not interchange their endpoints, payloads, facility IDs or credentials. Before implementing live transport, obtain the current official contract and facility authorization, isolate secrets and credentials by facility and environment, verify the implementation in an explicitly authorized sandbox, and implement verified, idempotent facility-scoped callbacks. The historic process-global SHA/DHA credential mechanism is not sufficient for multi-facility live use.

A manually recorded remittance advice does not create a payment. A matching, independently recorded billing receipt can be linked under the constraints in the hub guide. Some local SHA preauthorization/status actions still require unavailable transport; they are not a completed manual substitute. Global disablement preserves scoped history but stops new operations. Existing scripts and transport code are not evidence of an executed live integration.
