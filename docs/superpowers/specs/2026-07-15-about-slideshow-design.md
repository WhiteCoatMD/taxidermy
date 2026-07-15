# "Our Story" Admin-Managed Slideshow — Design

**Date:** 2026-07-15
**Status:** Approved (pending spec review)

## Goal

Replace the single fixed photo in the homepage "Our Story" (About) section with a
slideshow that the shop owner controls from the admin panel — without touching code.
The owner can add photos in two ways: upload new ones just for the slideshow, or pick
from photos already uploaded to the Trophy Room gallery. The gold "Award Winning
Quality" badge stays exactly as it is.

## Current state

- The About section (`index.html`, ~line 1446) has a `.about-frame` containing one
  `<img src="public/father-son.jpg">`, with a sibling `.about-badge` ("Award / Winning
  Quality") absolutely positioned in the corner. The badge is **outside** `.about-frame`,
  so it is unaffected by whatever image(s) sit inside the frame.
- The gallery already follows the pattern we're reusing: admin uploads a photo →
  `/api/upload` compresses/stores it in Vercel Blob under `gallery/{id}.ext` and appends
  an entry to `gallery-manifest.json` → the homepage fetches `/api/gallery` and renders
  dynamic items. Auth is a SHA-256 cookie token checked against `ADMIN_PASSWORD`
  (`api/auth.js`, `isAuthenticated` in `api/upload.js`/`api/hide.js`).
- Blob JSON manifests are written with `put(key, json, { access:'public',
  addRandomSuffix:false, allowOverwrite:true, contentType:'application/json' })`.

## Design

### Data model

New Blob manifest: **`about-slideshow.json`** — an ordered array. Display order = array
order. Each entry:

```json
{ "id": "uuid", "url": "https://blob-url", "source": "upload" | "gallery", "refId": "gallery-id-or-null" }
```

- `source: "upload"` — photo uploaded specifically for the slideshow; the image blob
  lives at `about/{id}.ext`.
- `source: "gallery"` — references an existing gallery image; `url` is the gallery blob
  URL, `refId` is the gallery entry's `id` (used to avoid adding the same gallery photo
  twice and to detect dangling references).

Kept in a **separate** manifest from the gallery so the two features never interfere.

### API — `api/about.js`

Follows the existing endpoint conventions (same auth helper, same manifest read/write
helpers as `api/gallery.js`).

- **`GET`** (public): return the slideshow array. Set
  `Cache-Control: public, s-maxage=10, stale-while-revalidate=30` (matches gallery).
  On any error, return `[]` so the homepage falls back gracefully.
- **`POST`** (admin auth required — 401 if not): dispatch on `action`:
  - `add-upload`: body `{ image (base64), filename }` → decode, `put` to `about/{id}.ext`
    → append `{ id, url, source:'upload', refId:null }`.
  - `add-gallery`: body `{ refId, url }` → ignore if `refId` already present → append
    `{ id:newUuid, url, source:'gallery', refId }`.
  - `remove`: body `{ id }` → remove entry from manifest. If the removed entry is
    `source:'upload'`, also `del(...)` its `about/{id}.ext` blob to avoid orphans.
- Reuse the 6 MB `bodyParser` size limit config from `api/upload.js`.

### Admin UI — `admin.html`

New section "Our Story Slideshow" (homepage photo), placed near the existing upload/
manage sections. Reuses existing styles and the `compressImage` helper.

- **Upload zone** — add a photo directly to the slideshow (client-side compress → base64
  → `POST /api/about {action:'add-upload'}`).
- **Add from gallery** — a horizontal strip of thumbnails of current gallery uploads
  (fetched from `/api/gallery`); clicking one calls `POST /api/about {action:'add-gallery'}`.
  Photos already in the slideshow are marked/disabled.
- **Current slideshow photos** — thumbnails of the active set, each with an **×** remove
  button (`POST /api/about {action:'remove'}`).
- Empty state message when no photos are set.
- New JS functions: `loadAboutSlides()`, `renderAboutSlides()`, `addAboutUpload()`,
  `renderGalleryPicker()`, `addFromGallery(refId,url)`, `removeAboutSlide(id)`.

### Homepage — `index.html`

- Keep the existing `<img src="public/father-son.jpg">` inside `.about-frame` as the
  default/fallback so the page is correct even before JS runs or if the API fails.
- On load, `fetch('/api/about')`:
  - **0 photos or error:** leave the static fallback image in place. Done.
  - **1+ photos:** replace the frame's contents with stacked, absolutely-positioned
    `<img>` layers (one per photo) that crossfade. Apply the same image styling the frame
    already uses (object-fit cover, brightness/saturate/sepia filter, hover zoom).
  - Auto-advance ~every 5s, looping. With exactly 1 photo, just show it (no animation).
  - No arrows/dots — keep it clean and low-maintenance.
- `.about-badge` is untouched (separate sibling element).
- **Reduced motion:** if `matchMedia('(prefers-reduced-motion: reduce)')` matches, show
  the first photo statically (no auto-advance).

## Explicitly out of scope (YAGNI)

- Drag-to-reorder photos (v1 shows them in the order added; can add later).
- Per-photo captions in the slideshow (the section is a mood/story accent, not a gallery).
- Manual navigation controls (arrows/dots).
- Transition-style options / configurable timing in the UI.

## Error handling

- Homepage: any fetch/parse failure → keep the static fallback image; never blank.
- Admin actions: show the existing toast on success/failure; a failed upload/remove
  leaves the current set unchanged.
- `add-gallery` guards against duplicate `refId`.

## Testing / verification

No test framework exists in this project (static site + serverless functions), so
verification is manual in a running/preview deploy:

1. Admin: upload a new photo → it appears in "Current slideshow photos" and on the
   homepage About frame.
2. Admin: "Add from gallery" a photo → appears in slideshow; adding it again is a no-op.
3. Admin: remove a photo → disappears from homepage; an uploaded photo's blob is deleted.
4. Set exactly one photo → homepage shows it with no animation.
5. Remove all photos → homepage falls back to `father-son.jpg`.
6. Badge stays correctly positioned across all of the above.
7. With OS "reduce motion" on → no auto-advance.

## Files touched

- **New:** `api/about.js`, this spec.
- **Edited:** `admin.html` (new section + JS), `index.html` (slideshow JS in the About
  frame).
- **Unchanged:** gallery, leads, contact, auth flows.
