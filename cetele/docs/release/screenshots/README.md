# App screenshots

Two Android captures of the debug build of the Cetele app, taken on 2026-10-11 on the `Pixel_8`
Android emulator (an emulator, not a physical device). They are the raw device frames
(1080x2400, no device frame, no retouching), downscaled to 540x1200 and colour-quantized to keep
each file small.

No server was running during the capture, so sign-in could not complete and no ledger screen is
shown. Only screens that render without a server are included. The app has not yet been run
against a live server.

| # | File | Screen | What it shows |
| --- | --- | --- | --- |
| 1 | `01-sign-in-phone.png` | Sign-in, phone entry | The first screen on a fresh install: phone number field, privacy notice and the send-code button. |
| 2 | `02-sign-in-unreachable.png` | Sign-in, server unreachable | The same screen after tapping send code with no server running: the app shows its "Unable to connect" error. The number typed is a placeholder, not a real one. |
