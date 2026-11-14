# Phase 5 checkpoint loss and controlled restart

## Recovery status

The previous uncommitted Phase 5 checkpoint and its original `phase5-initial.sha256` manifest were **not recovered**. Five of the ten previously protected paths were absent in the refreshed checkout, and the five present paths did not match the hashes reported in the prior session. The reported hashes were search aids, not a recovered original manifest. No file is claimed as a recovered or verified original.

The earlier search found no exact matches among accessible eligible filesystem files, local Git blobs, or eligible blobs reachable from advertised repository refs. Backend Arena snapshots and unadvertised remote objects were not accessible. The previous private recovery directory, including its own preservation archive, was also absent after the subsequent refresh. Absence from this workspace does not establish what exists in any other snapshot or storage system. The separate [excluded-object incident note](EXCLUDED-OBJECTS-SECURITY-REVIEW.md) is retained for authorized security review.

## Current restart

- Published Phase 4 commit: `3cda9ea8edc01b5f27086abc3c702d14dbd4492c`; parent `8043b47e69070c301532c732c64e7bc660bd66d5`; tree `2305d3994305514e678681184e3e6ea0b27f7a09`. The authorized remote branch and these objects were verified independently.
- The refreshed checkout was initially clean and shallow at `0111b5502e1a8d8a21faf53845360122275727df`. That commit is an ancestor of the published Phase 4 commit. Before alignment, the full checkout, including Git metadata, and the five surviving current file versions were preserved in separate encrypted archives with independently verified SHA-256 stream checks. The five preserved versions are older checkout files, **not** verified originals of the lost checkpoint.
- Four of the five current versions differed from published Phase 4. After the user explicitly permitted replacing those clean working copies while retaining their separately verified preservation archive, the checkout was fast-forwarded to Phase 4. No reset, clean, branch switch, forced push or commit was used.
- During the approval pause, two Git packfile modification times changed. The backup comparison found the Git metadata/object file bytes and inspected safe source bytes unchanged; the protected five file hashes remained unchanged. The cause of the timestamp changes was not established. A second encrypted pre-alignment snapshot of the then-current metadata was independently verified before the fast-forward.
- The new private preservation directory is `/home/user/jalicare-p5-restart-GRmWnUgd`. It contains the workspace/Git archives, a separate five-file archive, checksums and provenance. The directory is private; key material must not be printed, committed or pasted into chat. Local sandbox storage has already proved vulnerable to refresh loss, so durable retention outside this disposable environment is **not established**. Preserve copies through an approved private mechanism where available.

An independently saved pre-refresh snapshot, the original manifest and original source backups may still permit a future recovery. Any such recovery must first be restored to a separate private directory and verified against the original manifest. This controlled restart does not reconstruct, relabel or replace that evidence.
