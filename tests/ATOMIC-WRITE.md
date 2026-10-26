# Atomic store write regression

Run `node --test tests/atomic-file.test.mjs tests/atomic-write.test.mjs` on Node 22+.
No install, real host, model, credential, or network is needed. All stores use newly
created synthetic temporary directories.

The route tests reproduce the former success acknowledgement after a partial
write, flush failure, or failed replacement, including the raw purge path. The
helper tests cover publication, exclusive-create collisions, cleanup, process exit
before rename, and POSIX mode preservation under a restrictive umask.
Caller regressions preserve valid recall when only its optional trace write fails,
and make the policy API report a partial failure and committed-store count. Existing
frontends are unchanged; this PR tests the API responses, not their UI rendering.

The guarantee is a complete old or new live JSON file on filesystems that support
atomic same-directory rename. A process exit can leave an unpublished `.tmp` file.
This is not multi-writer compare-and-swap, a multi-file/backup transaction, or proof
of durability across power loss (the parent directory is not fsynced). Configuration,
backup failures, and previously corrupt input stores retain their existing handling.
Soft-delete merge rules and purge generations are handled by separate PRs.

The production-route portion initially had 1 passing and 6 failing cases against
the unchanged upstream baseline. POSIX access-bit coverage is skipped on Windows;
the CI matrix exercises it on Linux and macOS. The local Windows execution sandbox
may deny rename independently of file correctness; such a failed run is not a pass.
