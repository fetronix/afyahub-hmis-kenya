# Security policy

JaliCare HMIS holds patient records for Kenyan health facilities. A defect in
it can disclose clinical data, mix one facility's records into another's, or
bill a patient the wrong amount. Reports are taken seriously and handled
privately until they are fixed.

---

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security
problem.** A public report is a disclosure: it tells everyone the defect
exists before a fix does.

Use GitHub's private vulnerability reporting on this repository:

1. Open the **Security** tab.
2. Choose **Report a vulnerability**.

If that form is not available, the repository owner has not enabled it —
contact the owner through the same channel you use for other repository
matters and ask for a private route. **This project does not publish a
security email address**, and this document will not invent one: a contact
that does not work is worse than no contact at all.

Please include, where you can:

- what the defect allows an attacker to do;
- the endpoint, screen or file involved, and the version or commit;
- the smallest request or sequence that demonstrates it;
- whether patient data, credentials or billing amounts are affected.

### What never goes in a report

- **Real patient data.** Use synthetic records, or redact names, phone
  numbers, national ID numbers and dates of birth.
- **Working credentials.** Describe the exposure, not the secret. If you find
  a live key or password, say where it is and rotate nothing yourself; the
  owner must rotate it because the old value stays compromised either way.
- **Third-party personal data.**

If a credential or patient dataset has already been published, say so
immediately and stop escalating publicly — see
[`docs/security/DATA-EXPOSURE.md`](docs/security/DATA-EXPOSURE.md) for how
this repository has handled exactly that situation before.

---

## What to expect

This is a single-owner project without a staffed security team, so no
response-time guarantee is offered here — publishing one that cannot be met
would be worse than being honest about it. What is committed to:

- an acknowledgement that the report was received;
- an assessment of severity and impact, including whether patient data is
  affected;
- a fix, or an explanation of why a fix is not yet possible;
- credit in the changelog if you want it.

Please allow time for a fix to reach a deployment before publishing details.

---

## Supported versions

There are **no tagged releases** as of this writing, and therefore no older
version line receiving backported fixes. Only the current `main` branch is
supported. When the project begins tagging releases, this section will state
which lines are maintained.

---

## Known, unresolved exposure

The repository's Git history contains four database dumps that were verified
on 2026-10-25 to hold real patient personal data and user password hashes.
They have been removed from the current tree but **remain in history**. This
is documented, with the purge procedure and the outstanding owner actions, in
[`docs/security/DATA-EXPOSURE.md`](docs/security/DATA-EXPOSURE.md).

Anyone cloning this repository should be aware of it. It is not a reason to
report a *new* vulnerability — it is a known issue awaiting an action only
the owner can authorise.

---

## Scope

In scope:

- authentication, session handling and password storage;
- tenant and facility isolation — one facility reading another's records;
- patient, clinical, laboratory, pharmacy, billing and insurance data
  handling;
- input validation on endpoints that accept externally supplied content;
- logging that discloses identifiers, secrets or clinical payloads;
- the migration and schema layer.

Generally out of scope:

- findings that require a compromised host, database account or browser;
- reports produced solely by an automated scanner with no demonstrated
  impact;
- missing hardening headers with no described exploit;
- the known dump exposure described above.

---

## Handling this document

Reporters and maintainers should keep vulnerability details out of commits,
pull-request descriptions and CI logs as carefully as out of issues. A fix
that quotes the payload it defends against protects nobody.
