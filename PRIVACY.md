# Privacy Policy: Design Inspector

_Last updated: 18 September 2026. Applies to version 0.1.0._

> Page analysis and saved references stay on your device. The extension has no analysis
> server and sends no inspected content or telemetry to us. Asset downloads may contact the
> resource's original host. You control what you export.

There are no accounts, no sign-in, no analytics, and no backend. Nothing you inspect is
uploaded anywhere.

## What leaves your device, and when

Three things reach the network, and only because you asked for them:

| Action | What happens | Who receives it |
| --- | --- | --- |
| **Fetch file details** on the Assets tab | One request per listed asset, to read its size and MIME type. File size and content type are only knowable from a request, so they are blank until you press the button. | The host that already serves that asset to the page you are on. |
| **Identify font file** on a pinned element, or **Identify** on the Fonts section | One request for that one font file, so its own name table can be read. That is where the typeface's real name, designer, foundry, version and licence live; a site's CSS alias for a font is only a nickname. The file is read and discarded, and the result is remembered for the browsing session so a second press costs no request. | The host that already serves that font file to the page you are on. |
| **Download** an asset, a font file, or an asset ZIP | The asset is requested so it can be saved. | The same host. |

All three go to hosts the page you are inspecting already uses. Requests are sent without
credentials. Nothing is prefetched, nothing is sent on hover, and nothing is sent in the
background.

Everything else, including hovering, pinning, reading typography and colour, scanning a
page summary, detecting the stack, and every export, is computed in your browser from the
page that is already loaded. Copying to the clipboard and downloading a Markdown, JSON or
ZIP export are local operations.

## What is stored on your device

| Data | Where | Why |
| --- | --- | --- |
| Settings (theme, hover card, scan cap, outline colouring, semantic parents) | `chrome.storage.local` | So the extension opens the way you left it. |
| Saved references and page summaries, with your titles and notes | IndexedDB | Your research collection. |
| Screenshots attached to a saved reference | IndexedDB | The crop you captured when you saved it. |
| Mockup overlay images, per site origin | IndexedDB | So a comp is still in place when you come back. |

None of this is synchronised. Settings are written to `storage.local`, never
`storage.sync`, so private research does not travel to other devices through your browser
profile.

## How to delete it

- **One reference:** Saved tab, Delete on the card. It asks first.
- **Everything saved:** Saved tab, Clear all. It asks first, and it is not undoable.
- **A mockup overlay:** Tools tab, Remove.
- **All of it, including settings:** remove the extension at `chrome://extensions`.
  Uninstalling deletes the extension's local storage.

Before clearing, you can take your research with you: Copy Markdown, Download JSON, Copy
taste ledger, or Export bundle (ZIP) on the Saved tab.

## Permissions

| Permission | Why it is requested |
| --- | --- |
| `activeTab` | Temporary access to the tab you activated the inspector on, granted by your click or keyboard shortcut and revoked when you leave. |
| `scripting` | Injects the inspector into that tab on activation and removes it when you stop. |
| `sidePanel` | Shows the page summary, assets, stack and saved research beside the page. |
| `downloads` | Saves the files you ask for: assets, fonts and exports. |
| `storage` | Keeps settings and saved research on this device. |

There is no host permission for every site, no `webRequest`, no `debugger`, and no
persistent background access. Without your activation on a specific tab, the extension can
read nothing.

All code ships inside the package. No script is fetched and executed at runtime. Page text,
URLs and SVG markup are treated as untrusted input and are rendered as data, never executed.

## Changes

Any change to what leaves the device will be described here and in `CHANGELOG.md` before it
ships. If browser settings sync is ever offered it will be optional, limited to settings,
disclosed as using Chrome Sync, and the absolute wording above will be corrected.

## Contact

Piyush Gambhir, https://piyushgambhir.com
