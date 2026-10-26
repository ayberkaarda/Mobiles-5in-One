# Logging and masking

Security checklist item 14 (Logları temizle). This describes what the code does today, then a log sample captured from a real local run.

## API pipeline

Configured in [`src/Patika.Api/PatikaApiServices.cs`](../../src/Patika.Api/PatikaApiServices.cs) (`AddSerilog`, lines 43-56, and `UseSerilogRequestLogging`, lines 186-193):

- Output: one compact JSON object per line on stdout (`RenderedCompactJsonFormatter`). Levels: Information; `Microsoft.*` and `System.*` at Warning, except `Microsoft.Hosting.Lifetime`.
- Every line carries `@tr`/`@sp` (trace and span ids), `RequestId`, `RequestPath` and `ConnectionId` from the log context. Problem responses carry the same trace id (`traceId`), so a user-reported error maps to its log lines.
- Request log: `HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed} ms`. Path only: no query string, headers or bodies for any route, so `/v1/auth/*` and `/v1/uploads/*` bodies are never logged.
- [`MaskingEnricher`](../../src/Patika.Api/Logging/MaskingEnricher.cs) runs last on every event, recursively through structured values, sequences and dictionaries:
  - any property whose name contains `password`, `token`, `authorization`, `cookie`, `secret`, `credential`, `apikey` or `signingkey` becomes `[redacted]`;
  - email addresses in any string become `a***@d***` (first character of the local part and of the domain);
  - JWT-shaped strings (`eyJ...`) become `[redacted]`;
  - coordinate pairs with 4 or more decimals in any string are rounded to 3 decimals (about 110 m), and numeric properties named `lat`, `lng`, `lon`, `latitude` or `longitude` are rounded to 3 decimals.
- [`ExceptionScrubbingSink`](../../src/Patika.Api/Logging/ExceptionScrubbingSink.cs) sits in front of every sink: each exception, including inner and aggregate exceptions, is replaced by its type name, a masked message and the stack trace, because database errors can quote user data.
- Handlers log identifiers, not content: user ids, masked emails, kinds and counts. `EmailMessage.Body` (which holds one-time codes) is never logged (`src/Patika.Api/Email/EmailSender.cs`).
- The Play Developer API HttpClient has its default request logging removed (`RemoveAllLoggers()`), because the request path carries the purchase token ([`PlayDeveloperApi.cs`](../../src/Patika.Infrastructure/Billing/PlayDeveloperApi.cs) lines 176-177).

## Worker and Web

- The Worker and the Web app use the default .NET console logger. They do **not** run `MaskingEnricher` or `ExceptionScrubbingSink`.
- Worker log statements carry only ids, counts and exception type names (for example `Hard delete purged {Purged} of {Due} due accounts`, `urgent.fanout capped by cost.guard: {Granted} of {Recipients} devices`, `Quarantined upload {PhotoKey}: {FailureCode}`). Unhandled job exceptions are written by Quartz with their full message; the sample below shows one (an S3 connection error naming the storage host). A database exception there could quote a value, so moving the Worker onto the API's Serilog pipeline is an open item.
- Web logs only framework events and errors; the admin area talks to the API, which does the logging of admin actions (plus the `audit_logs` table).

## Mobile app

The Android app has no logging calls at all (a search of `app/` for `Console.Write`, `Debug.Write`, `Trace.Write`, `Android.Util.Log`, `ILogger<` and `Log*(` finds none), and there is no crash reporter or analytics SDK (ADR-0004; `Xamarin.Firebase.Messaging` is the only third-party runtime package, ADR-0008). Release builds keep `android:allowBackup="false"`.

## Retention

- 30 days for API, Worker and Web logs, set on the log collector (container host or log service). The containers keep nothing on disk; stdout is the only sink.
- Logs are operational data: they are not copied into the database backups, and the 30-day window is stated in the KVKK notice (`src/Patika.Web/Content/yasal/kvkk.md`, "Güvenlik kayıtları").
- Audit rows (`audit_logs`) are database records, not logs, and follow the database retention.

## Sample from register, feeding and urgent flows

Captured on 2026-10-26 by running the API locally (`dotnet run --project src/Patika.Api`, `ASPNETCORE_ENVIRONMENT=Development`, PostGIS 17-3.5 in Docker on a random port, migrated with the EF migrations) and calling it with curl:

1. `POST /v1/auth/register` with `mahalle.gonullusu@example.org`;
2. `POST /v1/auth/verify-email` with the 6-digit code from the development outbox (the response carries the access and refresh tokens);
3. `POST /v1/uploads/presign` (station), `POST /v1/stations` at `40.987654, 29.026512`;
4. `POST /v1/stations/{id}/feedings` with a note;
5. `POST /v1/uploads/presign` (urgent), `POST /v1/urgent` at `40.988123, 29.027456` with a description;
6. `GET /v1/urgent?near=40.987911,29.026999&radius=2000`;
7. `POST /v1/auth/login` with a wrong password.

Checks on the complete log file (20 lines, including start-up and `/health`):

```text
$ grep -c "mahalle.gonullusu@example.org" api2.log      # plain email
0
$ grep -c "m\*\*\*@e\*\*\*" api2.log                      # masked email
2
$ grep -cE "eyJ[A-Za-z0-9_-]{10,}" api2.log               # JWT access tokens
0
$ grep -cE "40\.98[0-9]{3,}|29\.02[0-9]{3,}" api2.log     # coordinates with 4+ decimals
0
$ grep -c "Kedi-Mama" api2.log                            # the password
0
$ grep -c "<the 6-digit verification code>" api2.log
0
```

The request bodies (coordinates, note, urgent description) and the response bodies (tokens) are not logged at all; the masking is the second line of defence for values that reach a message template. Lines from that run, unedited except for dropping the start-up, `/health` and one `PUT /v1/me/urgent-settings` 400 caused by a wrong request shape in the test script:

```json
{"@t":"2026-10-26T02:52:35.4637092Z","@m":"User 01a1761f-c250-7446-94c7-5b965b4a96ff registered with \"m***@e***\"; verification pending","@i":"5334ec30","@tr":"72f93a67e9b8db94ab99a8e32572d7f0","@sp":"fecee2d65a1fda90","UserId":"01a1761f-c250-7446-94c7-5b965b4a96ff","Email":"m***@e***","SourceContext":"Patika.Api.Features.Auth.AuthHandlers","RequestId":"0HNPJ1GNKUCHT:00000001","RequestPath":"/v1/auth/register","ConnectionId":"0HNPJ1GNKUCHT"}
{"@t":"2026-10-26T02:52:35.4668422Z","@m":"Development email of kind VerifyEmail written to the local outbox","@i":"872bada5","@tr":"72f93a67e9b8db94ab99a8e32572d7f0","@sp":"fecee2d65a1fda90","Kind":"VerifyEmail","SourceContext":"Patika.Api.Email.DevelopmentFolderEmailSender","RequestId":"0HNPJ1GNKUCHT:00000001","RequestPath":"/v1/auth/register","ConnectionId":"0HNPJ1GNKUCHT"}
{"@t":"2026-10-26T02:52:35.4702268Z","@m":"HTTP \"POST\" \"/v1/auth/register\" responded 202 in 1632.2 ms","@i":"2bf6b665","@tr":"72f93a67e9b8db94ab99a8e32572d7f0","@sp":"fecee2d65a1fda90","RequestId":"0HNPJ1GNKUCHT:00000001","RequestMethod":"POST","RequestPath":"/v1/auth/register","StatusCode":202,"Elapsed":1632.2112,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCHT"}
{"@t":"2026-10-26T02:52:35.7817787Z","@m":"User 01a1761f-c250-7446-94c7-5b965b4a96ff verified their email address","@i":"a745a92d","@tr":"888577fa63fc24996615b93c719d86f1","@sp":"48e9df09d3aeedd7","UserId":"01a1761f-c250-7446-94c7-5b965b4a96ff","SourceContext":"Patika.Api.Features.Auth.AuthHandlers","RequestId":"0HNPJ1GNKUCHU:00000001","RequestPath":"/v1/auth/verify-email","ConnectionId":"0HNPJ1GNKUCHU"}
{"@t":"2026-10-26T02:52:35.8300928Z","@m":"HTTP \"POST\" \"/v1/auth/verify-email\" responded 200 in 157.8 ms","@i":"2bf6b665","@tr":"888577fa63fc24996615b93c719d86f1","@sp":"48e9df09d3aeedd7","RequestId":"0HNPJ1GNKUCHU:00000001","RequestMethod":"POST","RequestPath":"/v1/auth/verify-email","StatusCode":200,"Elapsed":157.7581,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCHU"}
{"@t":"2026-10-26T02:52:36.1366901Z","@m":"HTTP \"POST\" \"/v1/uploads/presign\" responded 200 in 170.7 ms","@i":"2bf6b665","@tr":"ba64b7eadb19fd5e65b8fcfa50a8dd37","@sp":"9dc7acc2a32fb40b","RequestId":"0HNPJ1GNKUCHV:00000001","RequestMethod":"POST","RequestPath":"/v1/uploads/presign","StatusCode":200,"Elapsed":170.7306,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCHV"}
{"@t":"2026-10-26T02:52:36.4903690Z","@m":"HTTP \"POST\" \"/v1/stations\" responded 201 in 87.1 ms","@i":"2bf6b665","@tr":"a81b3d44bff53da472a386b9c536d6b6","@sp":"3f14b860ff350fed","RequestId":"0HNPJ1GNKUCI0:00000001","RequestMethod":"POST","RequestPath":"/v1/stations","StatusCode":201,"Elapsed":87.0981,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCI0"}
{"@t":"2026-10-26T02:52:36.8866199Z","@m":"HTTP \"POST\" \"/v1/stations/01a1761f-c6ce-77e7-ad8e-0e7641af483b/feedings\" responded 201 in 92.4 ms","@i":"2bf6b665","@tr":"9a14e042c95f4192abce7e5b5abb52ed","@sp":"2a1fe09f0e7717f7","RequestId":"0HNPJ1GNKUCI1:00000001","RequestMethod":"POST","RequestPath":"/v1/stations/01a1761f-c6ce-77e7-ad8e-0e7641af483b/feedings","StatusCode":201,"Elapsed":92.3849,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCI1"}
{"@t":"2026-10-26T02:52:37.0695769Z","@m":"HTTP \"POST\" \"/v1/uploads/presign\" responded 200 in 9.0 ms","@i":"2bf6b665","@tr":"9adfba391c860c84fddd288074e4dd5d","@sp":"6bda98bb1785d19e","RequestId":"0HNPJ1GNKUCI3:00000001","RequestMethod":"POST","RequestPath":"/v1/uploads/presign","StatusCode":200,"Elapsed":9.0016,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCI3"}
{"@t":"2026-10-26T02:52:37.4005731Z","@m":"HTTP \"POST\" \"/v1/urgent\" responded 201 in 50.2 ms","@i":"2bf6b665","@tr":"b0be448e18ba59e3bdbcfeacca85f440","@sp":"51aa96a574ab953c","RequestId":"0HNPJ1GNKUCI4:00000001","RequestMethod":"POST","RequestPath":"/v1/urgent","StatusCode":201,"Elapsed":50.1909,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCI4"}
{"@t":"2026-10-26T02:52:37.5640717Z","@m":"HTTP \"GET\" \"/v1/urgent\" responded 200 in 84.3 ms","@i":"2bf6b665","@tr":"97b661564a2fd0f4101bd4bb0cf082dc","@sp":"3d75859db5a6945e","RequestId":"0HNPJ1GNKUCI5:00000001","RequestMethod":"GET","RequestPath":"/v1/urgent","StatusCode":200,"Elapsed":84.2576,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCI5"}
{"@t":"2026-10-26T02:52:37.8078173Z","@m":"Login failed for \"m***@e***\"","@i":"4c843aa1","@tr":"10d3324bbfddaa238f872fca7178b6ed","@sp":"2dff881d9d11d60e","Email":"m***@e***","SourceContext":"Patika.Api.Features.Auth.AuthHandlers","RequestId":"0HNPJ1GNKUCI6:00000001","RequestPath":"/v1/auth/login","ConnectionId":"0HNPJ1GNKUCI6"}
{"@t":"2026-10-26T02:52:37.8089760Z","@m":"HTTP \"POST\" \"/v1/auth/login\" responded 401 in 184.3 ms","@i":"2bf6b665","@tr":"10d3324bbfddaa238f872fca7178b6ed","@sp":"2dff881d9d11d60e","RequestId":"0HNPJ1GNKUCI6:00000001","RequestMethod":"POST","RequestPath":"/v1/auth/login","StatusCode":401,"Elapsed":184.2963,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","ConnectionId":"0HNPJ1GNKUCI6"}
```

Worker, same database, 45-second run (`dotnet run --project src/Patika.Worker`, `DOTNET_ENVIRONMENT=Development`, storage endpoint deliberately unreachable). `urgent.fanout` processed both open urgent posts (`fanout_at` set, `notified_count` 0, no registered devices) without logging; the only application-level output was the Quartz failure of `media.process`, first lines shown:

```text
fail: Quartz.Core.JobRunShell[0]
      Job DEFAULT.media.process threw an unhandled Exception: 
      System.Net.Http.HttpRequestException: Hedef makine etkin olarak reddettiğinden bağlantı kurulamadı. (127.0.0.1:9)
       ---> System.Net.Sockets.SocketException (10061): Hedef makine etkin olarak reddettiğinden bağlantı kurulamadı.
```

In the Worker log, `grep -cE "40\.98[0-9]{3,}|29\.02[0-9]{3,}|@example.org"` returned 0.
