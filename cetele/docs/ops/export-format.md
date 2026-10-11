# Encrypted shop export (`.cetele`)

The Android half of security checklist item 20: an optional, owner-only, encrypted local copy of one
shop's data that the owner keeps and can import again later. It is separate from the server backup
(`pg_dump`, ADR-0002); nothing in this file reaches the server unless an import queues it through
sync.

Code: `android/core/data/src/main/kotlin/app/cetele/android/core/data/backup/` (format, snapshot,
validation, merge) and `android/feature/export/src/main/kotlin/app/cetele/android/feature/export/backup/`
(screens and view model). Routes: `ExportRoutes.Backup` and `ExportRoutes.Restore` in the export graph.

## What the file holds

One shop, as a UTF-8 JSON document (schema `1`) inside the encrypted body:

| Field                    | Content                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                 | `1`                                                                                                                                                        |
| `shopId`, `shopName`     | The exported shop. An import goes only into the shop with the same id.                                                                                     |
| `exportedAt`             | ISO-8601 instant of the export.                                                                                                                            |
| `customers[]`            | Every customer row of the shop, deleted ones included: `id`, `name`, `phone`, `note`, `tag`, SMS consent fields, `createdAt`, `updatedAt`, `deletedAt`, `synced`. |
| `entries[]`              | Every ledger entry: `id`, `customerId`, `type`, `amountMinor`, `currency`, `occurredOn`, `dueOn`, `note`, `photoKey`, `reverses`, `reversedBy`, `createdBy`, `createdAt`, `synced`. |

Photo keys travel, photo bytes do not: a restored entry shows its photo again once the media
pipeline can fetch it by key. A photo still waiting for upload at export time has no key and is not
in the file. `synced` records whether the row had reached the server before the export.

## Binary layout, version 1

All integers are unsigned big-endian. Every byte before the ciphertext is the header, and the whole
header is the AES-GCM additional authenticated data, so a changed header byte fails decryption.

| Offset | Size | Field                                                               |
| -----: | ---: | ------------------------------------------------------------------- |
|      0 |    8 | Magic `89 43 45 54 45 4C 45 0A` (0x89, ASCII `CETELE`, line feed)   |
|      8 |    2 | Format version, `1`                                                 |
|     10 |    1 | Key derivation id, `1` = Argon2id version 1.3                       |
|     11 |    4 | Argon2 memory in KiB (default 65536)                                |
|     15 |    4 | Argon2 iterations (default 3)                                       |
|     19 |    1 | Argon2 parallelism (default 1)                                      |
|     20 |    1 | Salt length, `16`                                                   |
|     21 |   16 | Random salt                                                         |
|     37 |    1 | Nonce length, `12`                                                  |
|     38 |   12 | Random nonce                                                        |
|     50 |    4 | Ciphertext length, including the 16-byte GCM tag                    |
|     54 |    n | AES-256-GCM ciphertext followed by the 128-bit tag                  |

- Key: 32 bytes from Bouncy Castle `Argon2BytesGenerator` (Argon2id, version 0x13) over the UTF-8
  bytes of the NFC-normalised passphrase, with the salt and cost from the header. A fresh salt and
  nonce come from `SecureRandom` for every file.
- Accepted cost on import: memory 8192 to 262144 KiB, iterations 1 to 10, parallelism 1 to 4. A
  header outside these bounds is refused before any key derivation, so a crafted file cannot make
  the phone allocate unbounded memory.
- File size limit: 64 MiB, checked while reading the picked file and again in the parser.
- The ciphertext length must match the rest of the file exactly; trailing or missing bytes are
  refused.

## Reading order and failures

1. Magic does not match: `NOT_A_BACKUP` ("Bu dosya bir Çetele yedeği değil.").
2. Version is not `1`: `UNSUPPORTED_VERSION`, checked before the key is derived.
3. Short header, unknown key derivation id, cost out of bounds, wrong salt or nonce length, length
   mismatch: `MALFORMED`.
4. GCM tag check fails: `AUTHENTICATION`. A wrong passphrase and a changed header or ciphertext look
   the same here by design ("Parola yanlış ya da dosya değiştirilmiş.").
5. The JSON does not parse or a row breaks the local write limits (name, phone, note and tag limits,
   amount 1 to 10 000 000 000 kuruş, currency `TRY`, ids as UUIDs, a correction and its original
   pointing at each other with the same customer, type and amount): `MALFORMED`.
6. The shop is not on this device or the signed-in user is not its owner: `NOT_OWNER`.

## Import and merge rules

- Owner only, checked three times: the view model offers only shops with role `OWNER`, and
  `BackupService` reads the role from the local shop row before opening and again before merging.
- The owner sees a preview (shop, export date, counts in the file, counts new to this device) and
  must confirm. Opening writes nothing.
- The merge runs in one immediate SQLite transaction and keeps the file's ids. A customer or entry
  whose id already exists in the shop is left untouched, so importing the same file twice, or into
  the shop it came from, adds nothing and queues nothing.
- If any id in the file already belongs to another shop on the device, or an imported correction
  points at a local original that already has a different correction, the whole import is refused
  (`CONFLICT`) and nothing is written.
- Rows with `synced = true` are stored as synced with no outbox operation; the next pull reconciles
  them. Rows with `synced = false` are stored as pending and get the same outbox operations as a
  local write (`CUSTOMER_UPSERT`, plus `CUSTOMER_DELETE` for a deleted customer, `ENTRY_CREATE`; a
  correction depends on its original's operation). Known limit: if such a row did reach the server
  after the export but before the device lost it, the server answers `conflict` for the new
  `clientId` and the row shows up under sync issues.

## Handling of secrets

- The passphrase lives only in composition state (`remember`, not `rememberSaveable`), is copied into
  a char array per action and wiped after use. The derived key and the plaintext buffers are zeroed
  after use. JVM strings cannot be wiped; that residue is accepted.
- Nothing about the passphrase or the content is logged. The written file goes to
  `cache/exports/<random>/cetele-<shop>-<date>.cetele`, shared through the app's existing
  `FileProvider` (`${applicationId}.files`) and removed by the export cleanup after 24 hours.
- Losing the passphrase loses the file: there is no recovery and Çetele never learns the passphrase.

## Evidence

- `core/data`: `BackupCodecTest` (round trip, default cost in header, NFC, wrong passphrase, every
  header byte changed, cost bounds, ciphertext and tag changes, truncation and extension, unknown
  versions, foreign files) and `BackupServiceTest` (round trip into a fresh device with correction
  links, photo keys and pending work, idempotent re-import, owner-only gating, wrong passphrase,
  invalid authenticated content, cross-shop id conflict, correction of a local original, write
  event).
- `feature/export`: `BackupViewModelTest`, `BackupScreensTest`, `BackupEnglishScreensTest`.
- Not exercised: a real device share sheet and document picker, Argon2id timing on low-end
  hardware, and a restore followed by a live sync against a real server.
