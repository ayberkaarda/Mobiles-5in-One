# ADR-0007: Map surface and photo pipeline

- Status: Accepted
- Date: 2026-10-25

## Context

The map tab shows feeding stations as the server's grid clusters and single stations (ADR-0003), with filters, a station sheet and a pin-drop screen for new stations. ADR-0004 approves `Microsoft.Maui.Controls.Maps`, which on Android is Google Maps: it needs an API key in the manifest (an owner secret that must never be in the repository), Google Play services on the device, and without a key it shows an empty grid or fails to start. A street layer from OpenStreetMap tiles needs a tile licence decision first: the OSMF tile servers do not allow heavy app traffic, and a commercial tile provider is a cost and a data-sharing choice the owner has not made. Development, CI and the emulator have no key.

Station, feeding, animal and urgent photos come from phone cameras. Camera files carry EXIF with the GPS position, time and device, often XMP, and on some phones a second picture appended after the end of the image. HEIC is the default on many phones; the API accepts only JPEG, PNG and WebP up to 5 MB through a presigned PUT that must carry exactly the presigned `Content-Type` and `Content-Length`.

## Decision

Map:

- Phase 3 draws the map itself: `Drawing/MapSurface` is a `GraphicsView` with pan, pinch and tap, and `Drawing/StationMapDrawable` paints a plain ground with a grid that moves with the map, the pins in the canvas style (cluster disc with count, food, water, "mama bitti", fed-today badge, selection halo), the user's dot after "Konumuma git", and the fixed pin of the pin-drop screen. There is no street layer, no tile request, no key and no new package. The approved canvas is drawn in the same way.
- The geometry lives in Core (`Core/Map`, tested on `net10.0`): Web Mercator with 256-unit tiles, so the screen and the API's 64-unit grid cells agree; the query box is the view plus a margin, capped below the API's 400 km² limit, with the integer zoom; zoom 12..19. Server clusters are drawn as sent and never merged; tapping one zooms two levels into it. Filters map to the API's exact `species`, `kind` and `needsRefill`.
- The map stays usable without gestures: the sheet lists the visible stations and clusters, and every pin has a spoken description.
- Google Maps through `Microsoft.Maui.Controls.Maps` stays the planned street layer. It is added when the owner provides an Android key restricted to the app's package and signing certificate, injected at build time from the build machine (never committed), with this surface kept as the fallback when no key is present. OpenStreetMap tiles are not used until a tile licence decision is recorded.

Photos:

- `Core/Media` holds the pipeline and `IPhotoUploader`, used by every package that uploads a photo. The Android adapter (`Media/AndroidImageTranscoder`) decodes with the platform codecs (`ImageDecoder` on Android 9+, which reads HEIC/HEIF and applies the orientation tag; `BitmapFactory` plus the EXIF orientation by hand before that), subsamples while decoding, scales the longer edge to at most 1600 px and encodes a JPEG from pixels.
- On every result the Core `JpegSanitizer` rewrites the JPEG by whitelist: only quantization and Huffman tables, frame and scan headers, restart intervals and entropy-coded data are kept. EXIF (GPS included), XMP, ICC, JFIF, comments, thumbnails and anything after the end-of-image marker are dropped on the phone, and the result is checked again for metadata and size before it is returned and once more before the upload. A `PreparedPhoto` can only be created by the pipeline, so no caller can upload unprepared bytes. The JPEG quality steps 85, 75, 65, 50 until the file fits 5 MB.
- Upload: `POST /v1/uploads/presign` with the kind, `image/jpeg` and the exact length; the answer must be a PUT for the same kind with the same `Content-Type` and `Content-Length`, otherwise nothing is sent. The PUT goes to storage on a separate `HttpClient` that never carries the API token. The returned key is the request's `photoKey`.
- Picking uses MAUI's `MediaPicker`: the system camera app or the Android photo picker, so the app does not read the gallery itself and does not ask for `ACCESS_MEDIA_LOCATION`.

Test-only dependency: `SkiaSharp` (already pinned for the worker) in `Patika.App.Tests` to encode and decode real JPEGs; it is not shipped in the app.

## Consequences

The map works the same in development, CI and production without any secret, and the clustering contract of ADR-0003 is honoured on screen. Volunteers see stations relative to each other and to their own dot, but no streets, so finding a station relies on its name, district, photo and the "Konumuma git" dot until the street layer is added; this is the main product gap and needs the owner's key decision. Pins are drawn on the UI thread; a few hundred pins per view are fine, and the API caps a page anyway.

Location metadata never leaves the phone in a photo, whatever the camera or the platform encoder writes, and this is tested on bytes (a JPEG with a GPS IFD, XMP, ICC, a comment and an appended second picture comes out with none of them and still decodes). Re-encoding loses some quality and drops colour profiles, which is acceptable for station and animal photos. HEIC needs Android 9 or later; older phones get a Turkish error and can pick a JPEG. Orientation handling on real devices (portrait photos from several camera apps) is verified in the device smoke, not in unit tests.
