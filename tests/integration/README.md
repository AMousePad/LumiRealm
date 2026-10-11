# Spindle file validation

Run against a current Lumiverse checkout using `LUMIVERSE_DIR`, or place Lumiverse beside LumiRealm. The harness uses isolated temporary storage and deletes its files afterward.

```powershell
bun tests/integration/spindle-content-live.ts
bun tests/integration/spindle-files-live.ts buffered
bun tests/integration/spindle-files-live.ts staged
bun tests/integration/spindle-files-live.ts large
```

The content test compares a 50 MiB original image through REST and Spindle, then checks live Realm search and detail requests through `spindle.cors`.

The buffered and staged commands compare readers using the same 256 MiB ZIP in separate processes. On the development machine, buffered processing took 242 ms with 795 MiB peak RSS; staged processing took 4,229 ms with 392 MiB peak RSS. Disk extraction trades speed for bounded memory. These measurements include the host and importer in one process and exclude archive creation and download.

The large test downloaded and extracted a 5 GiB ZIP containing 128 assets through the real host APIs, then verified every asset's hash. Extraction and verification took 85 seconds with 460 MiB peak RSS. It tests file transport and reading, not character creation or image conversion. Allow at least 40 GiB free disk space for this test and the host's reservations.
