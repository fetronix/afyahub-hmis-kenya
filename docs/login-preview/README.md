# Syrona Medical Center HMIS — sign-in page verification

Evidence captured on **2026-11-19** from the local development server
(`npm run dev`, Express + Vite middleware) rendered in headless Chromium
(`@sparticuz/chromium` 153 + `puppeteer-core` 25, `deviceScaleFactor: 1`, i.e.
100% zoom).

`/api/*` was answered with `401 Authentication is required.` by request
interception so the unauthenticated screen rendered, exactly as it does for a
signed-out user. Nothing in the application was mocked or altered for the run.

## Viewports measured

| Viewport | Document width | Horizontal overflow | Elements outside viewport | Key-element collisions | Broken images | Page errors |
| --- | --- | --- | --- | --- | --- | --- |
| 1280x720 | 1280 | 0 px | 0 | 0 | 0 | none¹ |
| 1366x768 | 1366 | 0 px | 0 | 0 | 0 | none¹ |
| 1440x900 | 1440 | 0 px | 0 | 0 | 0 | none¹ |
| 1920x1080 | 1920 | 0 px | 0 | 0 | 0 | none¹ |
| 1024x768 | 1024 | 0 px | 0 | 0 | 0 | none¹ |
| 768x1024 (stacked) | 768 | 0 px | 0 | 0 | 0 | none¹ |
| 390x844 (stacked) | 390 | 0 px | 0 | 0 | 0 | none¹ |

¹ The only console entry in the headless run is Vite's development HMR client
(`WebSocket closed without opened`), which does not exist in a production
build. No application exception was raised.

At 1280x720, 1366x768, 1440x900, 1920x1080 and 1024x768 the document height
equals the viewport height (`lg:h-dvh`, `lg:overflow-hidden`); nothing scrolls
and the brand panel's internal scroller never overflows. Below 1024px the two
panels stack and the page scrolls vertically, as specified.

## Method

For each viewport the harness recorded `document.documentElement.scrollWidth`,
`document.body.scrollWidth`, every element whose box crossed the viewport edge,
and pairwise intersections between these boxes:

`h1`, hero subtitle, the five module rows, the circular clinician portrait, the
tagline, the trust card, the language selector, the plaque logo, "Welcome
Back", the sign-in form, and the panel footer.

Intersections were computed on `getBoundingClientRect()` with a 0.5 px tolerance.
All three `<img>` elements (left lockup, plaque lockup, clinician photo)
reported `complete && naturalWidth > 0`; the favicon is declared in
`index.html` and served from the same generated asset.

The production bundle was also built from the same tree
(`vite build`: 2040 modules transformed, no errors) to confirm the new CSS and
component compile outside the dev server.

## Visual expectations

* Palette is exactly `#142143` (navy), `#1888B5` (cyan), `#F8FAFC` / `#FFFFFF`
  (surfaces), `#E2E8F0` (borders); the Sign In button is a flat navy `#142143`
  that darkens to `#0F1933` on hover, with an 8px radius on inputs and buttons.
* No Biometric or Smart Card buttons exist. The page contains no `JaliCare` or
  `AfyaHub` string.
* Below 640px the module list, clinician portrait and script tagline are hidden
  so the sign-in form is reachable in the first screen; the trust bar remains.
  From 640px up all brand content is shown.

## Files

* `login-1280x720.png`, `login-1366x768.png`, `login-1440x900.png`,
  `login-1920x1080.png` — full-viewport screenshots of the four acceptance
  sizes.
* `measurements.json` — the raw measurements and image-load results quoted
  above.
