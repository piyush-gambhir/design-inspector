# Competitive feature research: frontend and designer browser extensions

**Date:** 18 September 2026
**Scope:** Chrome extensions (and a few non-extension tools) that overlap with Design Inspector.
**Method:** Store metadata, permissions, ratings and review summaries were read from Chrome-Stats
detail pages, which mirror the Chrome Web Store listing and record the ingest date. Prices came
from each product's own site. Mechanism details came from the project's GitHub repository where one
exists. The Chrome Web Store itself renders only in a full browser, so its listing pages could not
be opened directly; every store-derived number below is from the Chrome-Stats mirror of that
listing, and the source URL is recorded per row.

Most listings were ingested 2026-09-17, one day before this document. Install counts on the store
are bucketed (200,000 means 200,000+), so treat them as order of magnitude, not exact.

A note on counts: Chrome-Stats returns several listings per product name because it also indexes
Edge, Firefox and abandoned duplicates. The primary Chrome listing was selected each time, and
withdrawn listings are labelled.

---

## 1. Summary table

### 1.1 Layout and CSS debugging

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| Pesticide (London App Brewery) | Layout debugging | Outline every element via injected CSS; one-click toggle; per-tag outline colors; hover annotation bar (broken in 2.0.0 per reviews) | 200,000 / 4.01 (146) | Free | `activeTab`, `scripting`, content script on `<all_urls>` | [chrome-stats.com/d/bakpbgckdnepkmkeaiomhmfcnejndkbi](https://chrome-stats.com/d/bakpbgckdnepkmkeaiomhmfcnejndkbi) |
| Pesticide for Chrome (OAM LLC) | Layout debugging | The original store listing. Removed from the store 2020-09-09. Reviews accuse it of opening affiliate pages in the background | 119,297 / 4.23 (180) at removal | Was free | No sensitive permissions recorded | [chrome-stats.com/d/bblbgcheenepgnnajgfpiicnbbdmmooh](https://chrome-stats.com/d/bblbgcheenepgnnajgfpiicnbbdmmooh) |
| VisBug | Layout debugging and page editing | Hover metatip with styles, accessibility and alignment; move, resize and nudge elements; edit text and swap images; guides and distance measurements; screenshot; DOM traversal like layers | 200,000 / 4.78 (280) | Free, Apache-2.0 | `activeTab`, `contextMenus`, `scripting`, `storage`. No host permissions | [chrome-stats.com/d/cdockenadnadldjbbgcallicgledbeoc](https://chrome-stats.com/d/cdockenadnadldjbbgcallicgledbeoc) |
| CSS Peeper | Design property extraction | Point-and-click CSS inspector; color palette export; typography inventory; asset export; contrast checker; semantic color grouping and "locate typography instances" on the top tier | 400,000 / 4.11 (473) | Free tier with 3 smart inspections a day; Professional $2.49/mo billed yearly; Ultra $4.99/mo billed yearly | `storage`, `sidePanel`, `activeTab`, `tabs`, `alarms`, `scripting`, `unlimitedStorage`, `webRequest`, hosts `http://*/*` and `https://*/*`, content script `<all_urls>` | [chrome-stats.com/d/mbnbehikldjhnfehhnaidhjhoofhpehk](https://chrome-stats.com/d/mbnbehikldjhnfehhnaidhjhoofhpehk) |
| CSS Scan | CSS copying | Hover to see an element's active CSS; one click copies the whole rule; deduplicates overridden declarations; pseudo-classes, pseudo-elements and media queries; spacebar live edit; export to CodePen; Tailwind conversion | 10,000 / 3.54 (101) | One-time licence, listed at $69 (from $120) | `storage`, `activeTab`, `contextMenus`, `clipboardWrite`, `scripting`, hosts `<all_urls>` | [chrome-stats.com/d/gieabiemggnpnminflinemaickipbebg](https://chrome-stats.com/d/gieabiemggnpnminflinemaickipbebg) |
| Hoverify | All-in-one toolkit | Inspector with live edit; color eyedropper in HEX, RGB and OKLCH; responsive viewer; asset extraction including images, SVG, video, PDF and animations; site stack; capture and annotate; SEO and accessibility checks | 40,000 / 4.12 (208) | Paid only: $30/year or $89 one-time, 3 activations | `tabs`, `scripting`, `storage`, `unlimitedStorage`, `browsingData`, `contextMenus`, `downloads`, `webNavigation`, `declarativeNetRequest`, hosts `<all_urls>` | [chrome-stats.com/d/bbpokcagpggnekcmamgdieebhpkjmljm](https://chrome-stats.com/d/bbpokcagpggnekcmamgdieebhpkjmljm) |
| Stylebot | Page restyling | Element picker with live preview; font, color, margin and visibility controls; custom CSS editor; per-site persistence; Google Drive sync of styles | 200,000 / 4.30 (1,638) | Free | `tabs`, `storage`, `identity`, `contextMenus`, `unlimitedStorage`, hosts limited to Google Drive, Google APIs and Google Fonts, content script `<all_urls>` | [chrome-stats.com/d/oiaejidbmkiecgbjeifoejpgmdaleoha](https://chrome-stats.com/d/oiaejidbmkiecgbjeifoejpgmdaleoha) |
| Stylus | Page restyling | Userstyle manager rather than an inspector. Install, write and manage CSS per site | 1,000,000 / 4.52 (1,241) | Free, open source | `alarms`, `contextMenus`, `storage`, `tabs`, `unlimitedStorage`, `webNavigation`, `webRequest`, `webRequestBlocking`, `identity`, hosts `<all_urls>` | [chrome-stats.com/d/clngdbkpkpeebahjckkjfobafhncgmne](https://chrome-stats.com/d/clngdbkpkpeebahjckkjfobafhncgmne) |
| Dimensions | Measurement | Measures from the cursor outward until it hits a border, vertically and horizontally; works on images and on mockups opened in the browser; `Alt+D` shortcut; open source | 100,000 / 4.17 (461) | Free | `activeTab`, `scripting` only | [chrome-stats.com/d/baocaagndhipibgklemoalmkljaimfdj](https://chrome-stats.com/d/baocaagndhipibgklemoalmkljaimfdj) |
| PerfectPixel | Pixel-perfect overlay | Overlays a semi-transparent comparison image on the page; opacity, position and scale controls; multiple layers; side panel UI | 300,000 / 4.26 (639) | Freemium. Reviews report scaling and a 10-layer cap behind a paywall | `activeTab`, `scripting`, `sidePanel`, `storage`, `unlimitedStorage`, hosts `<all_urls>` | [chrome-stats.com/d/dkaagdgjmgdmbnecmcefdhjekcoceebi](https://chrome-stats.com/d/dkaagdgjmgdmbnecmcefdhjekcoceebi) |
| Page Ruler Redux | Measurement | Pixel measurement and element positioning. Removed from the store; last version 1.2.0 from 2019, delisted 2022-04-04 | 500,000 / 4.52 (463) at removal | Was free | `activeTab`, `tabs`, `storage` | [chrome-stats.com/d/giejhjebcalaheckengmchjekofhhmal](https://chrome-stats.com/d/giejhjebcalaheckengmchjekofhhmal) |
| Designer Tools | Rulers, guides, grids | Browser rulers like a design tool; draggable guidelines; grid overlays; element comparison and distance measurement; design mockup overlay; accessibility inspector on the top tier; 16 languages | 100,000 / 4.63 (231) | Starter free; Plus $2.40/mo; Pro $4.80/mo | `scripting`, `activeTab`, `storage`, `webNavigation`, host limited to `https://designer.tools/` | [chrome-stats.com/d/jiiidpmjdakhbgkbdchmhmnfbdebfnhp](https://chrome-stats.com/d/jiiidpmjdakhbgkbdchmhmnfbdebfnhp) |
| Grid Ruler | Grid overlay | Draggable vertical and horizontal rulers with pixel readouts for alignment checks | 100,000 / 3.76 (342) | Free | `activeTab`, `scripting` only | [chrome-stats.com/d/joadogiaiabhmggdifljlpkclnpfncmj](https://chrome-stats.com/d/joadogiaiabhmggdifljlpkclnpfncmj) |
| Visual Inspector | Inspect and comment | Inspect and edit a live page without code, plus website feedback. Removed from the store 2022-09-03, last version 2019 | 80,000 / 4.30 (106) at removal | Was freemium | `tabs`, `activeTab`, `contextMenus`, `storage`, `unlimitedStorage`, plus `http`, `https` and `file` hosts | [chrome-stats.com/d/efaejpgmekdkcngpbghnpcmbpbngoclc](https://chrome-stats.com/d/efaejpgmekdkcngpbghnpcmbpbngoclc) |

### 1.2 Typography

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| WhatFont | Font identification | Hover to name the font under the cursor; click for a detail card with family, size, line height, weight and color; works on any page | 3,000,000 / 4.01 (2,051) | Free | `activeTab`, `scripting` only | [chrome-stats.com/d/jabopobgcpjmedljpbcaablpmlmfcogm](https://chrome-stats.com/d/jabopobgcpjmedljpbcaablpmlmfcogm) |
| Fonts Ninja | Font identification and commerce | Identifies fonts and lists every font used on the page; shows foundry, licence and price; try-before-buy preview with custom text; bookmark fonts into collections; similar-font suggestions | 900,000 / 4.44 (903) | Free to identify; revenue from font sales, with paid features for continued full use | `activeTab`, `tabs`, `storage`, `scripting`, hosts `http://*/*` and `https://*/*` | [chrome-stats.com/d/eljapbgkmlngdpckoiiibecpemleclhh](https://chrome-stats.com/d/eljapbgkmlngdpckoiiibecpemleclhh) |
| Fontanello | Font identification | Right-click any text to get its typographic styles and contrast information. No popup and no hover mode | 60,000 / 4.60 (47) | Free | `activeTab`, `contextMenus` only. The narrowest permission set in this whole survey | [chrome-stats.com/d/jdlhfjlpaijjhklfadlhbbmpjfddkglc](https://chrome-stats.com/d/jdlhfjlpaijjhklfadlhbbmpjfddkglc) |
| Type Sample | Font identification and sampling | Identify a webfont by hovering, then type your own sample text in that font; links out to Fonts In Use. Now a bookmarklet hosted on Typewolf, not a Chrome extension. No store listing found | Not applicable | Free | None. A bookmarklet has no extension permissions | [typewolf.com/type-sample](https://www.typewolf.com/type-sample) |

### 1.3 Color

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| ColorZilla | Eyedropper and palette | Eyedropper over the rendered page; color history; palette viewer; CSS gradient generator; page color analyzer | 4,000,000 / 4.59 (3,939). The largest installed base in this survey | Free | `tabs`, `scripting`, `storage`, `offscreen`, hosts `<all_urls>` | [chrome-stats.com/d/bhlhnicpbhignbdhedgjhgdocnmhomnp](https://chrome-stats.com/d/bhlhnicpbhignbdhedgjhgdocnmhomnp) |
| Site Palette | Palette extraction | Extracts a palette from the page's visible styles and CSS, ranked by on-screen dominance; saved palettes dashboard; shareable links; exports to Sketch, Adobe swatches and SVG | 90,000 / 3.77 (264) | Paid, from $2.50/mo, with a 24-hour trial. Login is mandatory | `storage`, `tabs`, `scripting`, hosts `<all_urls>` | [chrome-stats.com/d/pekhihjiehdafocefoimckjpbkegknoh](https://chrome-stats.com/d/pekhihjiehdafocefoimckjpbkegknoh) |
| ColorPick Eyedropper | Eyedropper | Draggable magnifier for precise picking; HEX and RGB output; optional clipboard copy; stays open after a pick; open source | 1,000,000 / 4.24 (1,236) | Free with ads and a premium tier, per reviews | `activeTab`, `tabs`, `scripting`, `storage`, `clipboardWrite` | [chrome-stats.com/d/ohcpnigalekghcmgcdcenkpelffpdolg](https://chrome-stats.com/d/ohcpnigalekghcmgcdcenkpelffpdolg) |
| Chroma | Color | No significant Chrome extension exists under this name. A store search returned only listings under 400 users, the largest being "Chroma Eye Ease" at 339 users, which is a color-filter tool, not a design tool | Not applicable | Not applicable | Not applicable | [chrome-stats.com/search?q=Chroma%20palette](https://chrome-stats.com/search?q=Chroma%20palette) |

### 1.4 Assets

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| svg-grabber (Juan Esteban Rios fork) | SVG extraction | Grabs every SVG on the page; grid preview; download or copy markup for use in Sketch, Figma or Framer | 20,000 / 4.31 (13) | Free | `activeTab`, `scripting`, `clipboardWrite` only | [chrome-stats.com/d/eafjmnaiohflfhelegodfedimibnjpgp](https://chrome-stats.com/d/eafjmnaiohflfhelegodfedimibnjpgp) |
| svg-grabber (original) | SVG extraction | The original listing. Removed from the store 2024-06-18, last version 2018. Reviews report downloaded SVGs coming out empty | 100,000 / 4.07 (94) at removal | Was free | `activeTab` only | [chrome-stats.com/d/ndakggdliegnegeclmfgodmgemdokdmg](https://chrome-stats.com/d/ndakggdliegnegeclmfgodmgemdokdmg) |
| Image downloader (Imageye) | Bulk image download | Finds every image on the page; filters by size and URL; bulk select and download; format conversion; saves into ordered folders | 2,000,000 / 4.87 (16,679) | Free | `activeTab`, `downloads`, `storage`, `webRequest`, `scripting`, `declarativeNetRequest`, `sidePanel`, hosts `<all_urls>` | [chrome-stats.com/d/agionbommeaifngbhincahgmoflcikhm](https://chrome-stats.com/d/agionbommeaifngbhincahgmoflcikhm) |
| Fatkun (current listing) | Bulk image download | Batch download across tabs; smart filters and AI rules; automatic file organisation for product images | 200,000 / 4.45 (341) | Free with ads. Reviews report unclosable ads and a forced new-tab change | `webRequest`, `declarativeNetRequest`, `downloads`, `scripting`, `tabs`, `storage`, `unlimitedStorage`, `contextMenus`, `sidePanel`, hosts `<all_urls>` | [chrome-stats.com/d/mojcdcedhidldcgaokbelcmffoaengkj](https://chrome-stats.com/d/mojcdcedhidldcgaokbelcmffoaengkj) |
| GoFullPage | Screenshot | Full-page capture by auto-scrolling; PNG, JPEG and PDF export; explicitly markets asking for no extra permissions | 10,000,000 / 4.89 (83,986). The highest rating at scale in this survey | Freemium | `activeTab`, `scripting`, `storage`, `unlimitedStorage`. No host permissions | [chrome-stats.com/d/fdpohaocaechififmbbbbbknoalclacl](https://chrome-stats.com/d/fdpohaocaechififmbbbbbknoalclacl) |
| Video DownloadHelper | Video download | Not researched. PRD 3.2 excludes streamed, protected and dynamically assembled video, and PRD 11 limits us to directly addressable video files in Phase 2, so this category is out of scope | Not applicable | Not applicable | Not applicable | Not applicable |

### 1.5 Stack and technology detection

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| Wappalyzer | Stack detection | One-click technology profile covering CMS, frameworks, libraries, analytics and ecommerce; CSV export; lead-gen upsell | 3,000,000 / 4.55 (1,973) | Freemium. Reviews single out a restrictive free tier and expensive paid plans | `cookies`, `storage`, `tabs`, `webRequest`, hosts `http://*/*` and `https://*/*` | [chrome-stats.com/d/gppongmhjkpfnbhagpmjfkannfbllamg](https://chrome-stats.com/d/gppongmhjkpfnbhagpmjfkannfbllamg) |
| BuiltWith | Stack detection | Sends the current URL to builtwith.com and shows its profile. Last updated 2022 | 300,000 / 4.31 (414) | Freemium, with a paywall on the full profile | `tabs` plus one host, `https://builtwith.com/`. Detection happens server side, not in the page | [chrome-stats.com/d/dapjbgnjinbpoindlpdmhochffioedbn](https://chrome-stats.com/d/dapjbgnjinbpoindlpdmhochffioedbn) |
| WhatRuns | Stack detection | One-click detection of frameworks, plugins, fonts, analytics and server settings; follow a site for change alerts | 400,000 / 4.21 (842) | Free | `tabs`, `activeTab`, `webRequest`, `storage`, hosts `<all_urls>` | [chrome-stats.com/d/cmkdbmfndkfgebldhnkbfhlneefdaaip](https://chrome-stats.com/d/cmkdbmfndkfgebldhnkbfhlneefdaaip) |
| React Developer Tools | Framework devtools | Adds Components and Profiler panels to DevTools; inspect the component tree; edit props and state; record render profiles; runs locally | 5,000,000 / 3.95 (1,641) | Free, open source | `scripting`, `storage`, `tabs`, hosts `<all_urls>` | [chrome-stats.com/d/fmkadmapgofadopljbjfkapdkoienihi](https://chrome-stats.com/d/fmkadmapgofadopljbjfkapdkoienihi) |
| Vue.js devtools | Framework devtools | Component and state inspection for Vue 3. Vue 2 support was dropped | 1,000,000 / 4.13 (2,163) | Free, open source | `scripting`, hosts `<all_urls>` | [chrome-stats.com/d/nhdogjmejiglipccpnnnanhbledajbpd](https://chrome-stats.com/d/nhdogjmejiglipccpnnnanhbledajbpd) |
| LocatorJS | Source navigation | Option-click a React, Preact or Solid component to jump to its source in your IDE. Only works on your own dev build | 40,000 / 4.32 (85) | Free, open source | `storage` only | [chrome-stats.com/d/npbfdllefekhdplbkdigpncggmojpefi](https://chrome-stats.com/d/npbfdllefekhdplbkdigpncggmojpefi) |

### 1.6 Responsive and QA

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| Responsive Viewer | Responsive preview | Shows many device frames side by side in one view; synchronised scroll and click; custom device list; screenshots; open source | 400,000 / 4.23 (350) | Free | `storage`, `activeTab`, `webNavigation`, `webRequest`, `declarativeNetRequest`, `scripting` | [chrome-stats.com/d/inmopeiepgfljkpkidclfgbgbmfcennb](https://chrome-stats.com/d/inmopeiepgfljkpkidclfgbgbmfcennb) |
| Mobile simulator | Responsive preview | 70+ device presets; custom viewports; side-by-side testing; screenshots and video capture | 1,000,000 / 4.90 (5,162) | Freemium | `webRequest`, `scripting`, `tabs`, `activeTab`, `declarativeNetRequest`, `webNavigation`, `storage`, `contextMenus`, `tabCapture`, `offscreen`, hosts `<all_urls>` | [chrome-stats.com/d/ckejmhbmlajgoklhgbapkiccekfoccmk](https://chrome-stats.com/d/ckejmhbmlajgoklhgbapkiccekfoccmk) |
| Window Resizer | Responsive preview | Resizes the actual browser window to preset resolutions; user-defined presets; global shortcuts | 800,000 / 4.29 (2,281) | Free | `scripting`, `activeTab`, `contextMenus`, `storage`, `offscreen`. No host permissions | [chrome-stats.com/d/kkelicaakdanhinjdeammmilcgefonfh](https://chrome-stats.com/d/kkelicaakdanhinjdeammmilcgefonfh) |
| Lighthouse | Audit | Runs a performance, quality and SEO audit and produces a report with recommendations; desktop and mobile modes | 1,000,000 / 4.40 (334) | Free, open source | `activeTab`, `storage` only. The narrowest set of any audit tool here | [chrome-stats.com/d/blipmdconlkpinefehnmjammfjpmpbjk](https://chrome-stats.com/d/blipmdconlkpinefehnmjammfjpmpbjk) |
| axe DevTools | Accessibility audit | Automated axe-core scan; issue list with code references and WCAG guidance; guided manual tests; saved and exportable results on Pro | 400,000 / 3.81 (128) | Freemium with a strong Pro upsell | `tabs`, `debugger`, `storage`, `unlimitedStorage`. It attaches the debugger, which is exactly the access PRD 1.2 decision 4 declines | [chrome-stats.com/d/lhdoppojpmngadmnindnejefpokejbdd](https://chrome-stats.com/d/lhdoppojpmngadmnindnejefpokejbdd) |
| WAVE Evaluation Tool | Accessibility audit | Injects icons and indicators over the page itself; structural and ARIA views; contrast checker; details panel keyed to WCAG | 700,000 / 4.09 (161) | Free | `activeTab`, `contextMenus`, `scripting`, `webNavigation`, hosts `file:///*`, `http://*/*`, `https://*/*` | [chrome-stats.com/d/jbbplnpkjmmeebjpijfedlgcdilocofh](https://chrome-stats.com/d/jbbplnpkjmmeebjpijfedlgcdilocofh) |
| Accessibility Insights for Web | Accessibility audit | FastPass two-check triage; assessment walkthrough; tab-stop and heading visualisations; open source | 100,000 / 4.70 (40) | Free | `notifications`, `scripting`, `storage`, `tabs`, `webNavigation`, `activeTab`. No host permissions | [chrome-stats.com/d/pbjjkligggfmakdaogkfomddhfmpjeni](https://chrome-stats.com/d/pbjjkligggfmakdaogkfomddhfmpjeni) |
| Web Developer (Chris Pederick) | Toolbar | Port of the Firefox toolbar. Toggles CSS and images, outlines elements, shows form details, resizes, validates, and dumps DOM information | 1,000,000 / 4.46 (2,832) | Free | `browsingData`, `contentSettings`, `cookies`, `history`, `scripting`, `storage`, `tabs`, hosts `<all_urls>`. The broadest permission set of any free tool here, and reviews raise privacy concerns about it | [chrome-stats.com/d/bfbameneiokkgbdmiekhjnmfkcnldhhm](https://chrome-stats.com/d/bfbameneiokkgbdmiekhjnmfkcnldhhm) |
| Check My Links | QA | Crawls the page's links and highlights broken ones in red; also covers Google Sheets and Docs | 90,000 / 4.49 (96) | Free | `scripting`, `storage`, `windows`, `webRequest`, hosts `<all_urls>` | [chrome-stats.com/d/aajoalonednamcpodaeocebfgldhcpbe](https://chrome-stats.com/d/aajoalonednamcpodaeocebfgldhcpbe) |

### 1.7 Inspiration and reference collecting

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| Muzli | Inspiration feed | Replaces the new tab with a curated design feed drawn from a dozen-plus sources; fast dial; daily refresh | 400,000 / 4.51 (834) | Free | `storage`, `alarms` only. It never touches the page you are on | [chrome-stats.com/d/glcipcfhmopcgidicgdociohdoicpdfc](https://chrome-stats.com/d/glcipcfhmopcgidicgdociohdoicpdfc) |
| Savee | Reference collector | One-click, right-click or hover quick-save of any image on the web into boards on savee.com | 8,000 / 3.87 (31) | Freemium, account required | `storage`, `cookies`, `contextMenus`, `activeTab`, `nativeMessaging`, hosts restricted to savee.com and its CDNs | [chrome-stats.com/d/hhefhkepfnmcgalemmofagaioeegonbc](https://chrome-stats.com/d/hhefhkepfnmcgalemmofagaioeegonbc) |
| Eagle for Chrome | Reference collector | Drag or right-click to save images and screenshots into the local Eagle desktop app; batch save; screen capture | 400,000 / 4.43 (797) | Free extension, paid desktop app | `activeTab`, `contextMenus`, `storage`, `tabs`, `scripting`, `webNavigation`, hosts `<all_urls>` | [chrome-stats.com/d/lieogkinebikhdchceieedcigeafdkid](https://chrome-stats.com/d/lieogkinebikhdchceieedcigeafdkid) |
| Refero | Reference library | Searchable library of about 125,000 product screens from 400+ products, tagged by page type, UX pattern and UI element, with an MCP endpoint for agents. It is a web app, not a browser extension. No store listing found | Not applicable | Paid tiers | Not applicable | [refero.design](https://refero.design/), [refero.design/mcp](https://refero.design/mcp) |
| Dribbble | Inspiration | No first-party Dribbble extension exists in the store. Searching returns only third-party downloaders and color generators, all under 2,000 users | Not applicable | Not applicable | Not applicable | [chrome-stats.com/search?q=Dribbble](https://chrome-stats.com/search?q=Dribbble) |
| Motion / mot.io | Motion inspiration | No such extension found in a store search. Motion inspiration is served by web galleries, not extensions | Not applicable | Not applicable | Not applicable | Search returned no matching store listing |
| Same Energy | Visual search | No store listing found. It is a web-based visual search engine | Not applicable | Not applicable | Not applicable | Search returned no matching store listing |

### 1.8 AI-era design-to-code

| Extension | Category | Headline features | Installs / rating | Price | Notable permissions | Source |
|---|---|---|---|---|---|---|
| Anima: Clone website & capture elements | Design to code | Captures an element or clones a page into editable React or HTML; preserves on-brand styles; side panel; feeds the Anima playground | 10,000 / 4.27 (11) | Freemium. The free plan allows 5 website clones a day in the playground; Enterprise starts at $500/mo | `pageCapture`, `activeTab`, `scripting`, `tabs`, `storage`, `sidePanel`, hosts `<all_urls>`. `pageCapture` is a heavy permission that serialises the whole page | [chrome-stats.com/d/paddhneaanoeljlmdepnheehdkaegblo](https://chrome-stats.com/d/paddhneaanoeljlmdepnheehdkaegblo) |
| Locofy | Design to code | No Chrome extension. Locofy ships a Figma, Penpot and Adobe XD plugin plus a VS Code extension | Not applicable | Freemium | Not applicable | [locofy.ai](https://www.locofy.ai/), [locofy.ai/docs/getting-started/installation](https://www.locofy.ai/docs/getting-started/installation/) |
| IMG2HTML | Screenshot to code | Capture a screenshot and send it to a hosted service that returns HTML | 1,000 / 4.43 (7) | Freemium | `activeTab`, `storage`, host `*://*.img2html.com/*` | [chrome-stats.com/d/eooajkmdnelnhhhgmagpelendbbbhink](https://chrome-stats.com/d/eooajkmdnelnhhhgmagpelendbbbhink) |
| Screenshot to Code and similar | Screenshot to code | A long tail of under-700-user listings. No credible incumbent in the Chrome store. The category lives in hosted apps and IDE agents instead | Not applicable | Varies | Varies | [chrome-stats.com/search?q=Screenshot%20to%20code](https://chrome-stats.com/search?q=Screenshot%20to%20code) |

---

## 2. Feature matrix

Columns are the twelve most relevant incumbents plus Design Inspector as the PRD defines it.
For the last column: **Y** = Phase 1 required, **P2** = Phase 2, **P3** = Phase 3, **n** = not planned,
with a note where the PRD scopes it narrowly.

Legend for the incumbent columns: **Y** = yes, **p** = partial or paywalled, **n** = no.

| Feature | VisBug | CSS Peeper | Hoverify | CSS Scan | Pesticide | Dimensions | Designer Tools | PerfectPixel | WhatFont | Fonts Ninja | ColorZilla | Wappalyzer | Design Inspector today |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hover inspect | Y | Y | Y | Y | p (hover bar, broken in 2.0.0) | n | n | n | Y | Y | n | n | **Y** |
| Box model outlines | Y | n | Y | n | n | n | n | n | n | n | n | n | **Y** |
| Outline all elements | n | n | n | n | Y | n | n | n | n | n | n | n | **n** |
| Edit CSS live | Y | n | Y | Y | n | n | n | n | n | n | n | n | **n** (PRD 3.2 excludes editing) |
| Move / resize elements | Y | n | n | n | n | n | n | n | n | n | n | n | **n** (PRD 3.2) |
| Measure distances | Y | n | Y | n | n | Y | Y | n | n | n | n | n | **P2** (LAY-02) |
| Rulers and guides | Y | n | n | n | n | n | Y | n | n | n | n | n | **n** |
| Grid overlay | Y (flex and grid tools) | n | n | n | n | n | Y | n | n | n | n | n | **n** (grid values read, no overlay) |
| Font identification | Y | Y | Y | p | Y | n | n | n | Y | Y | n | p (font providers) | **Y** with Declared / Matched / Verified labels |
| Font download | n | n | n | n | n | n | n | n | n | p (purchase) | n | n | **Y** for discovered self-hosted files |
| Color eyedropper | Y | n | Y | n | n | n | n | n | n | n | Y | n | **n** |
| Palette extraction | n | Y | Y | n | n | n | p (coming soon) | n | n | n | Y | n | **Y** (SUM-03, grouped by role) |
| Contrast check | Y | p (paid) | Y | n | n | n | p (Pro) | n | n | n | n | n | **Y** bounded (SUR-03) |
| Asset download, single | Y (image swap only) | Y | Y | n | n | n | n | n | n | n | n | n | **Y** |
| Asset bulk / ZIP | n | Y | Y | n | n | n | n | n | n | n | n | n | **P2** (AST-05) |
| SVG export | n | p | Y | n | n | n | n | n | n | n | n | n | **Y** (AST-03, standalone .svg) |
| Screenshot element | Y | n | Y | n | n | n | n | n | n | n | n | n | **Y** as part of an explicit save |
| Full-page screenshot | n | n | Y | n | n | n | n | n | n | n | n | n | **n** |
| Stack detection | n | n | Y | n | n | n | n | n | n | p (font source) | n | Y | **Y** small verified signature set |
| Responsive preview | Y (viewport simulation) | n | Y | n | n | n | n | n | n | n | n | n | **n** |
| Pixel-perfect overlay | n | n | n | n | n | p (measures mockups) | Y | Y | n | n | n | n | **n** |
| Accessibility audit | p (inspection, not audit) | n | Y | n | n | n | p (Pro) | n | n | n | n | n | **n** (PRD 3.2 excludes full auditing) |
| Export to CSS / Tailwind / Figma | p (copy styles) | p | Y | Y (CSS, Tailwind, CodePen) | n | n | n | n | n | n | p (CSS gradients) | p (CSV) | **Y** computed CSS and faithful Tailwind; closest-standard Tailwind **P2**; Figma **n** |
| Save / collect references | n | n | n | n | n | n | p (guides only) | n | n | Y (font bookmarks) | p (color history) | n | **Y** local collection with provenance |
| Annotations | n | n | Y | n | p (hover bar label) | n | n | n | n | n | n | n | **p** a "Why I saved this" note, no on-page annotation |
| Share links | n | p | n | p (CodePen) | n | n | n | n | n | n | n | n | **n** (PRD 3.2 excludes cloud and accounts) |

### What the matrix says

Three things stand out.

First, nobody combines page-level pattern summary with per-element inspection and a local
reference collection. CSS Peeper comes closest on palette and typography inventory, but it has no
saved-reference concept and charges for the useful half. Hoverify has the widest feature surface
and asks for `<all_urls>` plus `browsingData` to deliver it.

Second, the free and privacy-respectful end of the market is thin and aging. Pesticide's original
listing was pulled for adware behaviour. Page Ruler Redux, svg-grabber and Visual Inspector are all
delisted. VisBug, the best-loved tool in the survey at 4.78, was archived on GitHub on 15 September
2026 and its extension has not shipped since November 2024.

Third, permission minimalism is a real differentiator that several successful tools already use.
VisBug, Dimensions, Grid Ruler, Lighthouse, WhatFont and Window Resizer all ship with no host
permissions at all. GoFullPage advertises that fact in its store description and has 10 million
installs at 4.89. Our PRD 17.2 baseline is already in that group.

---

## 3. Pesticide deep-dive

### 3.1 What it actually is

Pesticide is not really an inspector. It is a stylesheet. The upstream project, `mrmrs/pesticide`,
is 99 lines of `outline` declarations keyed by tag name, each with its own color, all marked
`!important`:

```css
/*
    pesticide v1.3.0 . @mrmrs . MIT
*/
body    { outline: 1px solid #2980b9 !important; }
article { outline: 1px solid #3498db !important; }
nav     { outline: 1px solid #0088c3 !important; }
h1      { outline: 1px solid #162544 !important; }
```

The README explains the color choice directly: it wants "all the outline colors to be different per
element because, well sometimes I need to tell stuff apart."

Two details matter for us. `outline` is used rather than `border` because outlines do not
participate in layout, so the page does not reflow when you switch it on. And the color mapping is
per HTML tag, not per nesting depth, so what you read off the page is semantics, not hierarchy.

There is a second stylesheet, `css/pesticide-depth.css`, which is the depth mode. It does not use
outlines at all. Every element gets `box-shadow: 0 0 1rem rgba(0,0,0,0.6)` plus
`background-color: rgba(255,255,255,0.25)`. Stacked translucent whites make deeper nesting read as
brighter, which is a cheap fake of a 3D DOM view. In the preprocessor builds it is a variable you
flip: `$pesticide-debug-depth` in Sass, `@pesticide-debug-depth` in Less,
`pesticide-debug-depth` in Stylus.

Upstream repository: 1,413 stars, MIT license per the file headers, last pushed 2026-05-19.

### 3.2 How the extension delivers it

The extension injects that stylesheet into the active tab, then removes it. The live Manifest V3
listing requests exactly `activeTab` and `scripting`, and registers a content script matching
`<all_urls>`. Chrome-Stats records `scripting` being added at the 1.1 to 2.0.0 transition on
2025-03-10, which is the Manifest V3 migration. The fork documentation describes it as a
"one-click toggle to enable or disable visual outlines without needing page reload", injecting
through `chrome.scripting` rather than a background page.

The hover bar is the only interactive part. It is a floating strip that reports the element under
the cursor. Its existence is best evidenced by the fork built to remove it,
`michaelkolesidis/pesticide-without-hover-bar`, whose stated reason is that the bar "could
interfere with website interactions and styling".

### 3.3 Options

Effectively none. There is no options page in the current listing, no color customisation, no
per-site memory, no depth toggle exposed in the UI. The depth mode is a build-time variable in the
CSS project, not a user setting. Everything is one toggle. That is both why it is loved and why the
2.0.0 change hurt so much: with no settings, users had no way to opt out of the new look.

### 3.4 Permissions

- Live listing (London App Brewery): `activeTab`, `scripting`, content script on `<all_urls>`.
  Chrome-Stats flags the `<all_urls>` content script as its one sensitive item.
- Original listing (OAM LLC): no sensitive permissions recorded, and it was still delisted.

This is close to the minimum a page-modifying extension can ask for. Worth noting that the
content-script match on `<all_urls>` is strictly more than our PRD 17.2 baseline needs, since a
content script registered that way runs everywhere rather than waiting for activation.

### 3.5 What users praise and complain about

Praise, from the Chrome-Stats review summary: the outliner makes CSS structure visible, it is
useful for frontend debugging, and the outlines are "simple, unobtrusive" and give "essential info
without clutter".

Complaints are dominated by one event, the 2.0.0 release of 2025-03-10:

1. The new version draws bright filled background blocks instead of thin outlines. They obscure
   content and cannot be turned off. A July 2026 review: "it works but has background colors for
   elements instead of just lines and it's impossible to get rid of the background."
2. The `Ctrl` key annotation feature stopped working, on both local and hosted pages.
3. Users are asking for a rollback. An August 2026 review: "omg they ruined the extension. It used
   to be so good."

The rating tells the same story: 4.01 on the current fork against 4.23 on the delisted original,
and a separate "Pesticide - Advanced CSS Debugger" fork sitting at 4.91 with 20,000 users.

The history is instructive beyond the ratings. The original Pesticide listing was removed from the
store on 2020-09-09, and a review from the week before it went accuses it of quietly opening
AliExpress pages when the browser was idle. A 119,000-install free developer tool with no revenue
model turned into adware, users forked it, and the fork then broke the one thing everyone used it
for. This is the most-installed layout-debugging primitive in the survey and it is currently
unowned.

### 3.6 Three lessons for Design Inspector

1. **Non-reflowing overlays only.** `outline` over `border` is the reason Pesticide is trusted at
   all. Our highlight layer must never change the inspected page's layout. PRD 19.1's
   read-then-write batching is the same instinct.
2. **Never remove a visual mode without a setting.** Pesticide lost a point of rating by changing
   its default look with no opt-out. PRD 6.2 lets the user override the theme; the box-model tint
   intensity deserves the same treatment.
3. **A free tool with no business model is a liability to its users.** Both the adware incident and
   CSS Peeper's PII complaints below come from the same pressure. Our privacy promise in PRD 17.1
   is only credible because there is no server to feed.

---

## 4. Recommendations

Ranked within each tier, most valuable first.

### Tier 1: add these

Cheap, on-brand, and they strengthen the "live lens for understanding design" framing without
touching the page or leaving the device.

**1. Outline-all-elements mode.**
Pesticide's entire value proposition, currently unowned, buildable in an afternoon. Inject a
stylesheet into our existing content script that outlines elements by tag, with one setting for
intensity and one for "outline all" versus "outline layout containers only". Use `outline`, never
`border`, and never fills.
*Architecture:* content script, a second stylesheet in the isolated UI root's sibling injection,
toggled from the popup alongside Inspect.
*Principle:* PRD 3.3.5, the page stays usable. It is inspection, not editing, so it stays inside
PRD 3.2.

**2. Color eyedropper over the rendered page.**
The single most-installed capability in this entire survey: ColorZilla has 4 million users and
ColorPick Eyedropper has 1 million. Our palette extraction reads declared CSS values, which misses
what an image, gradient or blend actually renders. An eyedropper closes that gap and is the honest
answer to the contrast cases PRD 9 already declares unavailable. Use the native `EyeDropper` API so
no screen capture is involved.
*Architecture:* content script invoking `EyeDropper`, result piped into the pinned inspector's copy
actions and the OKLCH conversion from SUR-02.
*Principle:* PRD 3.3.2, evidence before certainty. A picked pixel is Observed, where a derived
background color is not.

**3. Distance measurement promoted from Phase 2 to Phase 1.**
Three separate incumbents exist purely to do this: Dimensions at 100,000 installs, Designer Tools
at 100,000, and VisBug's measurements tool. It is the most common question after "what size is this
heading?", and LAY-02 is already specified in full.
*Architecture:* content script overlay, reusing the geometry cache the highlight layer already
maintains.
*Principle:* PRD 3.1, make basic inspection immediate. It also answers the two-minute workflow
target in PRD 1.

**4. Grid and flex overlay for the pinned element.**
LAY-01 already reads grid template rows and columns, gaps, flex direction and alignment. Drawing
those lines over the element is nearly free once the values are in hand, and it turns a table of
numbers into something you can actually see. VisBug ships `flex.js` and `guides.js` for this reason.
*Architecture:* content script overlay layer, driven by the layout reading already computed for the
pinned inspector.
*Principle:* PRD 3.3.4, patterns remain traceable. The overlay is the visual trace of the numbers.

**5. Search and highlight within the page summary.**
SUM-06 already promises click-through from a summary entry to its examples. Add a text filter over
typography combinations, colors and spacing values. On a large page the summary is long, and
filtering is what makes it usable.
*Architecture:* side panel only, no new page access.
*Principle:* PRD 3.3.4 and the SUM-06 acceptance criterion about reaching a source example.

**6. Keyboard-copyable value rows with a visible copy confirmation.**
Reviews of ColorZilla report clipboard copies silently failing, and CSS Scan reviews complain that
copied output carries clutter. EXP-01 already covers what to copy. What is missing is the
acknowledgement. Show a short confirmation per row, and never write the clipboard without an
explicit action.
*Architecture:* inspector UI in the isolated root; no new permissions.
*Principle:* PRD 19.2 keyboard access, plus the EXP-01 rule about not touching the clipboard
unbidden.

### Tier 2: valuable but larger

Real value, but each needs a new permission, a new surface, or Phase 2 groundwork.

**1. Pixel-perfect mockup overlay.**
PerfectPixel has 300,000 installs at 4.26 and its reviews are dominated by reliability and paywall
complaints, so the category is winnable. A local image overlaid at adjustable opacity, offset and
scale fits our audience exactly. It needs a file-input surface, local blob storage, and a per-site
memory of overlay position, which is new persistence work beyond SAV-03.
*Why Tier 2:* new storage model, new settings surface, and it edges toward QA rather than design
research.

**2. Responsive preview via a resizable frame.**
Responsive Viewer has 400,000 installs and Mobile simulator has 1 million at 4.90, so demand is not
in doubt. The honest version for us is narrow: re-run the page summary at a second viewport width
and diff the two. PRD 4 already lists "comparison across captured viewports" as Phase 3, and
SUM-01 already records viewport with every scan.
*Why Tier 2:* iframe-based previews break on sites that set frame-ancestors, and window resizing
needs the `windows` API. Do the summary diff first, not the device gallery.

**3. Distance measurement between two arbitrary points, not just two elements.**
LAY-02 measures between element bounds. Dimensions measures from the cursor to the nearest border,
which is what people reach for when the thing they want to measure is not an element. Worth adding
after LAY-02 ships, as a second mode.
*Why Tier 2:* needs edge detection against rendered pixels, not layout boxes, which is a different
and less certain technique. It must be labelled as such under PRD 16.1.

**4. Bulk asset export with a manifest.**
Already specified as AST-05. Keep it in Phase 2. CSS Peeper and Hoverify both charge for this, and
Imageye's 2 million installs at 4.87 show that bulk download is a habit. Our differentiator is the
manifest of failures, which nobody else provides.
*Why Tier 2:* ZIP assembly, memory caps, cancellation and partial-failure reporting are all real
work, exactly as AST-05 describes.

**5. Font pairing and scale comparison across saved references.**
Fonts Ninja's collections feature is the most-praised thing in its reviews. Once several references
are saved, comparing their type scales side by side is a genuinely new capability that no inspector
offers, because none of them save anything.
*Why Tier 2:* needs the Phase 2 "multi-reference bundles" from PRD 4 and a new comparison view in
the side panel.

**6. Contrast checking against a picked pixel.**
SUR-03 correctly refuses to invent a ratio over a photograph. With the Tier 1 eyedropper in place,
the user can supply the background themselves, and we can compute a real ratio and label its source
as user-picked rather than derived.
*Why Tier 2:* depends on Tier 1 item 2, and needs a new confidence label in the shared evidence
model.

### Tier 3: deliberately not

**1. Live CSS editing and element dragging.**
PRD 3.2 excludes editing the inspected website, and PRD 3.3.5 promises the page stays usable. VisBug
owns this, is free and open source, and its top review request is an undo button we would also have
to build. Recommend VisBug in our docs instead of competing with it.

**2. Full accessibility auditing.**
PRD 3.2 excludes it. axe DevTools, WAVE and Accessibility Insights are backed by Deque, WebAIM and
Microsoft respectively, and axe reaches its accuracy by attaching the `debugger` permission, which
PRD 1.2 decision 4 explicitly declines. A bounded contrast reading is the right amount of
accessibility for us.

**3. Full-page screenshot.**
GoFullPage has 10 million installs at 4.89 and does nothing else. SAV-02 already gives us the
visible crop we need for provenance. Auto-scrolling and stitching would violate PRD 12's rule
against scrolling the page to force discovery.

**4. Cloud collections, share links and accounts.**
PRD 3.2 rules out accounts, collaboration and cloud collections, and PRD 17.1's privacy promise
depends on there being no server. Site Palette's top review complaint is mandatory login. The taste
ledger is the destination, and it is a file.

**5. Design-to-code generation from a selection.**
PRD 3.2 excludes reconstructing components, and EXP-02 already forbids claiming recovery of a
site's original classes. This is also the wrong bet commercially: Locofy has no Chrome extension at
all, Anima's has 10,000 users and 11 ratings, and the screenshot-to-code listings are all under 700
users. The work moved to IDE agents. Our faithful Tailwind output is the honest subset.

**6. Inspiration feed or new-tab takeover.**
Muzli does this well at 400,000 installs with only `storage` and `alarms`. It is a content product,
not an inspection tool, and it would put us in the business of curating a feed. Design Inspector
should read the site the user already chose to visit.

**7. Framework devtools panels.**
React Developer Tools has 5 million installs and Vue devtools has 1 million, both first-party. Our
STK-02 stack report answers "what is this built with", which is a different and complementary
question. Do not build component trees.

**8. Server-side technology profiling.**
BuiltWith sends the URL to its own server, and Wappalyzer's reviews complain about privacy prompts
and upsells. STK-03 keeps us on page evidence only, which is both more private and more honest about
what "not detected" means.

---

## 5. Sources

All Chrome-Stats pages were read on 18 September 2026 and carry a store ingest date of 2026-09-17
unless the row notes otherwise.

Store listing data (Chrome-Stats mirrors of Chrome Web Store listings):

- https://chrome-stats.com/d/bakpbgckdnepkmkeaiomhmfcnejndkbi (Pesticide)
- https://chrome-stats.com/d/bblbgcheenepgnnajgfpiicnbbdmmooh (Pesticide for Chrome, delisted)
- https://chrome-stats.com/d/cdockenadnadldjbbgcallicgledbeoc (VisBug)
- https://chrome-stats.com/d/mbnbehikldjhnfehhnaidhjhoofhpehk (CSS Peeper)
- https://chrome-stats.com/d/gieabiemggnpnminflinemaickipbebg (CSS Scan)
- https://chrome-stats.com/d/bbpokcagpggnekcmamgdieebhpkjmljm (Hoverify)
- https://chrome-stats.com/d/oiaejidbmkiecgbjeifoejpgmdaleoha (Stylebot)
- https://chrome-stats.com/d/clngdbkpkpeebahjckkjfobafhncgmne (Stylus)
- https://chrome-stats.com/d/baocaagndhipibgklemoalmkljaimfdj (Dimensions)
- https://chrome-stats.com/d/dkaagdgjmgdmbnecmcefdhjekcoceebi (PerfectPixel)
- https://chrome-stats.com/d/giejhjebcalaheckengmchjekofhhmal (Page Ruler Redux, delisted)
- https://chrome-stats.com/d/jiiidpmjdakhbgkbdchmhmnfbdebfnhp (Designer Tools)
- https://chrome-stats.com/d/joadogiaiabhmggdifljlpkclnpfncmj (Grid Ruler)
- https://chrome-stats.com/d/efaejpgmekdkcngpbghnpcmbpbngoclc (Visual Inspector, delisted)
- https://chrome-stats.com/d/jabopobgcpjmedljpbcaablpmlmfcogm (WhatFont)
- https://chrome-stats.com/d/eljapbgkmlngdpckoiiibecpemleclhh (Fonts Ninja)
- https://chrome-stats.com/d/jdlhfjlpaijjhklfadlhbbmpjfddkglc (Fontanello)
- https://chrome-stats.com/d/bhlhnicpbhignbdhedgjhgdocnmhomnp (ColorZilla)
- https://chrome-stats.com/d/pekhihjiehdafocefoimckjpbkegknoh (Site Palette)
- https://chrome-stats.com/d/ohcpnigalekghcmgcdcenkpelffpdolg (ColorPick Eyedropper)
- https://chrome-stats.com/d/eafjmnaiohflfhelegodfedimibnjpgp (svg-grabber, current fork)
- https://chrome-stats.com/d/ndakggdliegnegeclmfgodmgemdokdmg (svg-grabber, delisted original)
- https://chrome-stats.com/d/agionbommeaifngbhincahgmoflcikhm (Image downloader, Imageye)
- https://chrome-stats.com/d/mojcdcedhidldcgaokbelcmffoaengkj (Fatkun)
- https://chrome-stats.com/d/fdpohaocaechififmbbbbbknoalclacl (GoFullPage)
- https://chrome-stats.com/d/gppongmhjkpfnbhagpmjfkannfbllamg (Wappalyzer)
- https://chrome-stats.com/d/dapjbgnjinbpoindlpdmhochffioedbn (BuiltWith)
- https://chrome-stats.com/d/cmkdbmfndkfgebldhnkbfhlneefdaaip (WhatRuns)
- https://chrome-stats.com/d/fmkadmapgofadopljbjfkapdkoienihi (React Developer Tools)
- https://chrome-stats.com/d/nhdogjmejiglipccpnnnanhbledajbpd (Vue.js devtools)
- https://chrome-stats.com/d/npbfdllefekhdplbkdigpncggmojpefi (LocatorJS)
- https://chrome-stats.com/d/inmopeiepgfljkpkidclfgbgbmfcennb (Responsive Viewer)
- https://chrome-stats.com/d/ckejmhbmlajgoklhgbapkiccekfoccmk (Mobile simulator)
- https://chrome-stats.com/d/kkelicaakdanhinjdeammmilcgefonfh (Window Resizer)
- https://chrome-stats.com/d/blipmdconlkpinefehnmjammfjpmpbjk (Lighthouse)
- https://chrome-stats.com/d/lhdoppojpmngadmnindnejefpokejbdd (axe DevTools)
- https://chrome-stats.com/d/jbbplnpkjmmeebjpijfedlgcdilocofh (WAVE Evaluation Tool)
- https://chrome-stats.com/d/pbjjkligggfmakdaogkfomddhfmpjeni (Accessibility Insights for Web)
- https://chrome-stats.com/d/bfbameneiokkgbdmiekhjnmfkcnldhhm (Web Developer, Chris Pederick)
- https://chrome-stats.com/d/aajoalonednamcpodaeocebfgldhcpbe (Check My Links)
- https://chrome-stats.com/d/glcipcfhmopcgidicgdociohdoicpdfc (Muzli)
- https://chrome-stats.com/d/hhefhkepfnmcgalemmofagaioeegonbc (Savee)
- https://chrome-stats.com/d/lieogkinebikhdchceieedcigeafdkid (Eagle for Chrome)
- https://chrome-stats.com/d/paddhneaanoeljlmdepnheehdkaegblo (Anima)
- https://chrome-stats.com/d/eooajkmdnelnhhhgmagpelendbbbhink (IMG2HTML)

Store searches used to establish absence or to pick the primary listing:

- https://chrome-stats.com/search?q=Chroma%20palette
- https://chrome-stats.com/search?q=Dribbble
- https://chrome-stats.com/search?q=Screenshot%20to%20code
- https://chrome-stats.com/search?q=Type%20Sample

Source repositories and mechanism:

- https://github.com/mrmrs/pesticide (Pesticide CSS, README and license)
- https://raw.githubusercontent.com/mrmrs/pesticide/master/css/pesticide.css (per-tag outline rules)
- https://raw.githubusercontent.com/mrmrs/pesticide/master/css/pesticide-depth.css (depth mode)
- https://api.github.com/repos/mrmrs/pesticide (1,413 stars, last pushed 2026-05-19)
- https://github.com/michaelkolesidis/pesticide-without-hover-bar/ (hover bar behaviour and the MV3 injection method)
- https://github.com/GoogleChromeLabs/ProjectVisBug (VisBug, Apache-2.0, 5,768 stars, archived)
- https://raw.githubusercontent.com/GoogleChromeLabs/ProjectVisBug/main/readme.md (VisBug feature list)
- https://api.github.com/repos/GoogleChromeLabs/ProjectVisBug/contents/app (VisBug tool modules: accessibility, guides, measurements, metatip, screenshot, flex, margin, padding, position, text, imageswap, color, boxshadow, hueshift)
- https://github.com/mrflix/dimensions (Dimensions, open source)

Vendor pages for pricing and features:

- https://getcssscan.com/ (CSS Scan, $69 one-time)
- https://tryhoverify.com/ (Hoverify, $30/year or $89 one-time, and its tool list)
- https://csspeeper.com/ (CSS Peeper features)
- https://csspeeper.com/pricing (free, $2.49/mo, $4.99/mo)
- https://designer.tools/ (Designer Tools features)
- https://designer.tools/pricing (free, $2.40/mo, $4.80/mo)
- https://www.sliday.com/sitepalette (Site Palette features and exports)
- https://www.animaapp.com/pricing (Anima free plan limits, Enterprise from $500/mo)
- https://www.locofy.ai/ and https://www.locofy.ai/docs/getting-started/installation/ (Locofy has no Chrome extension)
- https://refero.design/ and https://refero.design/mcp (Refero is a web app with an MCP endpoint)
- https://www.typewolf.com/type-sample (Type Sample is a bookmarklet on Typewolf)

Reference documents in this repository:

- [PRD.md](PRD.md) sections 1 to 4 and 6 to 22, for the "Design Inspector today" column and the
  scope boundaries cited in the recommendations.

Facts that could not be verified from a page opened during this research:

- `pesticide.io` did not resolve (DNS failure) on 18 September 2026, so no vendor page for
  Pesticide exists to cite. All Pesticide mechanism claims come from the GitHub sources above.
- Fonts Ninja's own site returned HTTP 403, so its exact paid tiers are not stated here. The free
  identification path and the font-purchase revenue model are taken from its store listing
  description and the Typewolf-adjacent coverage cited above.
- Video DownloadHelper was not researched at all, by the scope decision recorded in section 1.4.
