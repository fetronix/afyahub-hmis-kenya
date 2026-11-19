# Appendix A — Evidence appendix

This appendix holds the captures that the test register refers to. Every figure is a browser capture of the running application against synthetic data, recorded in this repository as acceptance evidence; `docs/documentation/SCREENSHOT_PROVENANCE.md` names the run each file came from.

Where a test was **BLOCKED** or **NOT TESTED**, no picture is offered in its place. The register in Chapter 27 says so in words, and this appendix repeats the list at the end.

## A.1 Authentication and access control

![Figure A.1 — Sign-in screen as served by the running application. The account is synthetic; the password field is masked.](docs/documentation/assets/screenshots/01-platform/01-login-screen.png)

![Figure A.2 — The accounting workspace for an account holding read permission only. No posting control is offered.](docs/documentation/assets/screenshots/18-accounting/10-read-only-permission.png)

![Figure A.3 — The refusal shown to an account without the partners' equity permission. The module declines to render a statement rather than showing a zero.](docs/documentation/assets/screenshots/19-partners-equity/09-access-required.png)

## A.2 Accounting integrity

![Figure A.4 — Journal entries with their source and status.](docs/documentation/assets/screenshots/18-accounting/04-journal-entries.png)

![Figure A.5 — Partner contribution register: the movements the independent verification was computed from.](docs/documentation/assets/screenshots/19-partners-equity/03-contribution-register.png)

![Figure A.6 — Per-partner reconciliation of the register against the ledger. The difference column reads 0.00; nothing on the screen is adjustable.](docs/documentation/assets/screenshots/19-partners-equity/08-reconciliation.png)

![Figure A.7 — Statement of changes in partners' equity, the statement the closing capital in Chapter 17 must agree with.](docs/documentation/assets/screenshots/19-partners-equity/07-changes-in-equity.png)

## A.3 Audit and configuration

![Figure A.8 — Audit trail with actor, action, entity and time. The table is append-only: a delete attempted by the test suite was refused by the database trigger.](docs/documentation/assets/screenshots/27-audit/01-audit-trail.png)

![Figure A.9 — Audit events for a configuration change, with before and after values.](docs/documentation/assets/screenshots/27-audit/02-audit-events.png)

## A.4 Reporting

![Figure A.10 — Reporting centre with the catalogue's status labels visible.](docs/documentation/assets/screenshots/25-reporting/01-catalogue.png)

![Figure A.11 — Report results with the applied filters restated above the rows.](docs/documentation/assets/screenshots/25-reporting/02-report-results.png)

![Figure A.12 — A report exported as a PDF document on the facility letterhead.](docs/documentation/assets/screenshots/25-reporting/06-exported-pdf.png)

## A.5 What is deliberately absent

| Not shown | Why |
| --- | --- |
| Live M-Pesa STK push or callback | No merchant credentials, no provider connectivity (Chapter 27, §27.10) |
| SHA eClaim transmitted and acknowledged | No SHA sandbox credentials |
| A PACS study | Not implemented |
| Inpatient ward board and discharge | No ward configured in the synthetic dataset; not staged |
| Trial balance, balance sheet and cash-flow screens | No capture exists in the repository evidence; documented from the engine and the verified figures |
| A restored production backup | Production data was not permitted in this environment |
| A performance chart | No load test was run; such a chart would be invented |
