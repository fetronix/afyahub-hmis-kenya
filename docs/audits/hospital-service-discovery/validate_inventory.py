#!/usr/bin/env python3
"""Read-only consistency checks for this source-only discovery audit.

Does not connect to a database, contact payers, or validate real facility
configuration. Run from any directory: python3 path/to/validate_inventory.py.
"""
from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def read_csv(name: str) -> list[dict[str, str]]:
    with (HERE / name).open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"{name} has no header")
        result = list(reader)
        if any(None in row for row in result):
            raise ValueError(f"{name} contains a row wider than its header")
        return result


def tokens(value: str) -> list[str]:
    return [part.strip() for part in value.split("|") if part.strip()]


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def extract_array(source: str, identifier: str) -> set[str]:
    match = re.search(rf"{re.escape(identifier)}\s*=\s*\[([\s\S]*?)\]\s*as const", source)
    expect(match is not None, f"Cannot find {identifier} source array")
    return set(re.findall(r"'([^']+)'", match.group(1)))


def validate_evidence(rows: list[dict[str, str]], name: str) -> None:
    line_cache: dict[Path, int] = {}
    for row in rows:
        evidence = row.get("source_evidence", "")
        expect(bool(evidence.strip()), f"{name}: source_evidence is missing")
        for reference in evidence.split("; "):
            match = re.fullmatch(r"([^:]+):(\d+)", reference.strip())
            expect(match is not None, f"{name}: invalid evidence reference {reference!r}")
            file = (ROOT / match.group(1)).resolve()
            expect(file.is_relative_to(ROOT), f"{name}: evidence escapes repository: {reference}")
            expect(file.is_file(), f"{name}: missing evidence file: {reference}")
            if file not in line_cache:
                line_cache[file] = len(file.read_text(encoding="utf-8").splitlines())
            expect(1 <= int(match.group(2)) <= line_cache[file], f"{name}: invalid line: {reference}")


def main() -> None:
    inventory = read_csv("MASTER_SERVICE_INVENTORY.csv")
    coverage = read_csv("DEPARTMENT_COVERAGE.csv")
    traces = read_csv("SERVICE_TRACES.csv")
    expect(inventory and coverage and traces, "All three registers must contain rows")

    ids = [r["audit_id"] for r in inventory]
    expect(len(ids) == len(set(ids)), "Duplicate audit IDs")
    expect(all(re.fullmatch(r"A\d{4}", item) for item in ids), "Unexpected audit ID format")
    names = [r["service_name"].strip().casefold() for r in inventory]
    expect(len(names) == len(set(names)), "Duplicate service names across the master inventory")
    trace_ids = [r["trace_id"] for r in traces]
    expect(len(trace_ids) == len(set(trace_ids)), "Duplicate trace IDs")
    expect(all(r["trace_id"] in trace_ids for r in inventory), "A service references an unknown trace")
    expect(len({r["department"].casefold() for r in coverage}) == len(coverage), "Duplicate departments")
    for row in coverage:
        expect(all(item in ids for item in tokens(row["identified_service_ids"])), "Unknown service ID in coverage")
        expect(all(item in trace_ids for item in tokens(row["trace_ids"])), "Unknown trace ID in coverage")
    covered_ids = {item for row in coverage for item in tokens(row["identified_service_ids"])}
    expect(set(ids) <= covered_ids, f"Inventory IDs not linked from coverage: {sorted(set(ids) - covered_ids)}")

    for row in inventory:
        for key in ("service_name", "service_kind", "identity_granularity", "owning_department", "discovery_basis", "clinical_workflow_status", "automatic_billing_status", "source_specimen_type", "required_action"):
            expect(bool(row.get(key, "").strip()), f"{row['audit_id']}: missing {key}")
        expect(row["identity_granularity"] in {"NAMED_SERVICE", "SCHEDULE_VARIANT", "PRODUCT_CLASS_NEEDS_EXPANSION"}, f"{row['audit_id']}: unknown granularity")
        for key in ("facility_tariff_mapping", "payer_mapping", "facility_activation"):
            expect(row[key] == "NOT_INSPECTED", f"{row['audit_id']}: unverified facility assertion in {key}")
        if row["discovery_basis"] == "NAMED_PANEL_COMPONENT":
            expect(not row["existing_source_identity_codes"], f"{row['audit_id']}: panel component has a fabricated catalogue identity")

    validate_evidence(inventory, "inventory")
    validate_evidence(coverage, "coverage")
    validate_evidence(traces, "traces")

    identities = Counter(
        identity
        for row in inventory
        for identity in tokens(row["existing_source_identity_codes"])
    )
    immunisation = (ROOT / "src/immunisation/immunisation-contracts.ts").read_text(encoding="utf-8")
    antigen_block = immunisation.split("export const ANTIGENS:", 1)[1].split("export const ANTIGEN_BY_CODE", 1)[0]
    antigens = set(re.findall(r"\bcode:\s*'([^']+)'", antigen_block))
    expect(antigens, "No source antigen codes extracted")
    inventory_antigens = Counter(
        code
        for row in inventory if row["discovery_basis"] == "CODE_SCHEDULE"
        for code in tokens(row["existing_source_identity_codes"])
    )
    expect(set(inventory_antigens) == antigens and all(v == 1 for v in inventory_antigens.values()), "Immunisation schedule codes missing, duplicated, or extra")

    seed = (ROOT / "src/db/seed.ts").read_text(encoding="utf-8")
    labs_block = seed.split("// 14. Laboratory Catalogue", 1)[1].split("// 15. Lab Orders", 1)[0]
    drugs_block = seed.split("// 17. Pharmacy & Inventory Items", 1)[1].split("// 18. Batches", 1)[0]
    wards_block = seed.split("// 11. Wards and Beds", 1)[1].split("// 12. Admission", 1)[0]
    source_codes = (
        set(re.findall(r"\bcode:\s*'(LAB-[^']+)'", labs_block))
        | set(re.findall(r"\bitemCode:\s*'(DRUG-[^']+)'", drugs_block))
        | set(re.findall(r"\bcode:\s*'(WARD-[^']+)'", wards_block))
    )
    expect(len(source_codes) >= 11, "Could not extract expected source seed identities")
    expect(all(identities[code] == 1 for code in source_codes), "A demo lab, inventory, or ward identity is missing or duplicated")

    ward_source = (ROOT / "src/db/inpatient-contracts.ts").read_text(encoding="utf-8")
    ward_labels = extract_array(ward_source, "SUGGESTED_WARD_TYPES")
    bed_labels = extract_array(ward_source, "SUGGESTED_BED_TYPES")
    expect(all(identities[label] >= 1 for label in ward_labels | bed_labels), "A suggested ward/bed type is missing")

    delivery_source = (ROOT / "src/components/modules/maternity/DeliveryRegisterSection.tsx").read_text(encoding="utf-8")
    part = delivery_source.split("value={delivery.deliveryMode}", 1)[1]
    mode_block = re.search(r"\{\[([\s\S]*?)\]\.map\(\(mode\)", part)
    expect(mode_block is not None, "Cannot extract delivery modes")
    modes = set(re.findall(r"'([^']+)'", mode_block.group(1)))
    registered_modes = {
        row["existing_source_identity_codes"]
        for row in inventory if row["discovery_basis"] == "ENUMERATED_UI_MODE"
    }
    expect(modes == registered_modes, "Delivery modes missing or extra")

    requested = {
        "Blood bank and transfusion medicine", "ICU and HDU", "Endoscopy",
        "Physiotherapy and rehabilitation", "Dental and oral health", "Ophthalmology and optometry",
        "Theatre and surgery", "Anaesthesia", "Neonatal and newborn", "Mental health and psychiatry",
        "Immunisation and preventive health", "Dermatology", "ENT", "Nutrition and dietetics",
        "Oncology", "Respiratory therapy", "Mortuary services", "Ambulance and patient transport",
        "CSSD and sterilization", "Occupational health", "Family planning", "Community health and outreach",
        "Cardiology", "Orthopaedics", "Neurology", "Urology", "Gastroenterology", "Specialist outpatient clinics",
    }
    actual_requested = {row["department"] for row in coverage if row["scope"] == "REQUESTED"}
    expect(actual_requested == requested, f"Requested department coverage differs: {requested ^ actual_requested}")
    crossmatches = [r for r in inventory if "crossmatch" in r["service_name"].casefold()]
    expect(len(crossmatches) == 1 and crossmatches[0]["owning_department"] == "Laboratory", "Crossmatch must have one shared laboratory identity")

    print(f"PASS: {len(inventory)} inventory rows, {len(coverage)} department rows ({len(requested)} requested), {len(traces)} trace definitions")
    print(f"PASS: {len(antigens)} source antigen codes, {len(modes)} delivery modes, {len(source_codes)} demo identities, {len(ward_labels)} ward and {len(bed_labels)} bed suggestions")
    print("PASS: unique names/IDs, coverage links, evidence paths/lines, component boundaries and uninspected facility states")
    print("Scope: source/register consistency only; it does NOT validate real facility offerings, tariffs, clinical completion or payer mappings.")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError, IndexError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
