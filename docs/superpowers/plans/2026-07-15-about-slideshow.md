# "Our Story" Admin-Managed Slideshow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fixed homepage "Our Story" photo into a slideshow the shop owner controls from the admin panel (upload new photos or pick from the existing gallery), keeping the gold "Award Winning Quality" badge and a static fallback.

**Architecture:** Mirror the existing gallery feature exactly. A new `/api/about` serverless function reads/writes a `about-slideshow.json` manifest in Vercel Blob and stores uploaded images under `about/{id}.ext`. `admin.html` gets a new management section; `index.html` fetches the manifest and crossfades the photos inside the existing `.about-frame`, falling back to the current static image when empty or on error.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step, no framework), Vercel serverless functions (Node, ES modules), `@vercel/blob` (`put`, `del`, `list`), SHA-256 cookie auth against `ADMIN_PASSWORD`.

## Global Constraints

- Auth on every mutating endpoint: SHA-256 of `process.env.ADMIN_PASSWORD + '_lonely_pines_salt'`, compared to the `admin_token` cookie value. Copy the `isAuthenticated(req)` helper verbatim from `api/upload.js`. GET is public.
- All JSON manifests written with: `put(KEY, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' })`. The `allowOverwrite: true` is mandatory — without it fixed-key writes silently fail.
- Request body limit for image uploads: `export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };` (matches `api/upload.js`).
- Images are compressed client-side to base64 JPEG via the existing `compressImage(file)` before upload (max 1400px, quality 0.78).
- No test framework exists in this repo. Verification is `node --check` for syntax plus manual browser checks against a running dev server (`vercel dev`) or a preview deployment. Do not fabricate a test harness.
- Do not modify the gallery, leads, contact, or auth features. The `.about-badge` element must stay untouched.

---

## File Structure

- **Create:** `api/about.js` — GET (public list) + POST (admin: `add-upload`, `add-gallery`, `remove`) for the slideshow manifest.
- **Modify:** `index.html` — add slideshow CSS + `loadAboutSlideshow()` JS in the About frame; give the frame an id.
- **Modify:** `admin.html` — add "Our Story Slideshow" section markup + JS (load/render/upload/gallery-picker/remove).

Order: API first (both UIs depend on it) → Admin (produces the data) → Homepage (displays it, easiest to verify once real data exists).

---

## Task 1: Backend API — `api/about.js`

**Files:**
- Create: `api/about.js`

**Interfaces:**
- Produces (consumed by `admin.html` and `index.html`):
  - `GET /api/about` → `200` JSON array of `{ id: string, url: string, source: 'upload'|'gallery', refId: string|null }`. Returns `[]` (never errors) so the homepage can fall back.
  - `POST /api/about` (admin cookie required, else `401`), body `{ action, ... }`:
    - `{ action: 'add-upload', image: <base64 data URL>, filename: string }` → `200 { success: true, entry }`
    - `{ action: 'add-gallery', refId: string, url: string }` → `200 { success: true, entry }` (no-op `200 { success: true, duplicate: true }` if `refId` already present)
    - `{ action: 'remove', id: string }` → `200 { success: true }` (also deletes the blob when `source === 'upload'`)

- [ ] **Step 1: Write the full endpoint**

Create `api/about.js` with exactly this content:

```js
import crypto from 'crypto';
import { put, del, list } from '@vercel/blob';

const MANIFEST_KEY = 'about-slideshow.json';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

async function getSlides() {
  const { blobs } = await list({ prefix: MANIFEST_KEY });
  if (blobs.length === 0) return [];
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveSlides(slides) {
  await put(MANIFEST_KEY, JSON.stringify(slides), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  // Public read — never throws, so the homepage can always fall back.
  if (req.method === 'GET') {
    try {
      const slides = await getSlides();
      res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
      return res.status(200).json(slides);
    } catch (error) {
      console.error('Failed to load slideshow:', error);
      return res.status(200).json([]);
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { action } = req.body || {};

  try {
    const slides = await getSlides();

    if (action === 'add-upload') {
      const { image, filename } = req.body;
      if (!image) return res.status(400).json({ error: 'Image is required' });

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const id = crypto.randomUUID();
      const ext = filename?.split('.').pop()?.toLowerCase() || 'jpg';
      const blob = await put(`about/${id}.${ext}`, buffer, {
        access: 'public',
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      });

      const entry = { id, url: blob.url, source: 'upload', refId: null };
      slides.push(entry);
      await saveSlides(slides);
      return res.status(200).json({ success: true, entry });
    }

    if (action === 'add-gallery') {
      const { refId, url } = req.body;
      if (!refId || !url) return res.status(400).json({ error: 'refId and url are required' });
      if (slides.some(s => s.refId === refId)) {
        return res.status(200).json({ success: true, duplicate: true });
      }
      const entry = { id: crypto.randomUUID(), url, source: 'gallery', refId };
      slides.push(entry);
      await saveSlides(slides);
      return res.status(200).json({ success: true, entry });
    }

    if (action === 'remove') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID is required' });
      const entry = slides.find(s => s.id === id);
      if (entry && entry.source === 'upload') {
        try { await del(entry.url); } catch (e) { console.error('Blob delete failed:', e); }
      }
      await saveSlides(slides.filter(s => s.id !== id));
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Slideshow update failed:', error);
    return res.status(500).json({ error: 'Update failed' });
  }
}
```

- [ ] **Step 2: Verify the file parses**

Run: `node --check api/about.js`
Expected: no output, exit code 0 (a syntax error would print and exit non-zero).

- [ ] **Step 3: Commit**

```bash
git add api/about.js
git commit -m "feat: add /api/about slideshow endpoint (list, upload, add-from-gallery, remove)"
```

---

## Task 2: Admin UI — "Our Story Slideshow" section in `admin.html`

**Files:**
- Modify: `admin.html` (markup after the Gallery Management section ~line 564; JS in the `<script>`; init calls ~line 593)

**Interfaces:**
- Consumes: `GET/POST /api/about` (Task 1); existing `compressImage(file)` (~line 662), `showToast(msg, isError)` (~line 921), `staticImages` array (~line 777), `galleryData` (built in `loadGallery`, ~line 814).
- Produces: `loadAboutSlides()` — called on login to populate the section.

- [ ] **Step 1: Add the section markup**

In `admin.html`, immediately after the Gallery Management section's closing `</div>` (the `<div class="manage-section">` block that ends at line 564, right before `</div>` at line 566 that closes `.admin-panel`), insert:

```html
    <!-- Our Story Slideshow -->
    <div class="upload-section">
      <div class="section-label">Our Story Slideshow (Homepage Photo)</div>
      <p style="color:var(--muted);font-size:0.75rem;margin:0 0 0.75rem;line-height:1.5;">
        These photos rotate in the "Our Story" section of the homepage. Upload new ones or add from your gallery below.
      </p>

      <label for="aboutFileInput" class="upload-zone">
        <div class="upload-zone-icon">&#128247;</div>
        <div class="upload-zone-text">Tap to <strong>add a photo</strong> to the slideshow</div>
      </label>
      <input type="file" id="aboutFileInput" accept="image/*" style="position:absolute;left:-9999px;opacity:0;" onchange="addAboutUpload(this.files)" />

      <div class="section-label" style="margin-top:1rem;">Current Slideshow Photos</div>
      <div class="manage-grid" id="aboutSlidesGrid"></div>
      <div class="empty-state" id="aboutSlidesEmpty" style="display:none;">No slideshow photos yet — the homepage shows the default photo</div>

      <div class="section-label" style="margin-top:1rem;">Add From Gallery</div>
      <div class="manage-grid" id="aboutPickerGrid"></div>
    </div>
```

- [ ] **Step 2: Add the JS functions**

In the `<script>` of `admin.html`, add these functions (place them right before the `// ── GALLERY MANAGEMENT ──` comment at ~line 803):

```js
    // ── OUR STORY SLIDESHOW ──
    let aboutSlides = [];

    async function loadAboutSlides() {
      try {
        const res = await fetch('/api/about');
        aboutSlides = res.ok ? await res.json() : [];
      } catch { aboutSlides = []; }
      renderAboutSlides();
      renderAboutPicker();
    }

    function renderAboutSlides() {
      const grid = document.getElementById('aboutSlidesGrid');
      const empty = document.getElementById('aboutSlidesEmpty');
      grid.innerHTML = '';
      empty.style.display = aboutSlides.length === 0 ? 'block' : 'none';
      aboutSlides.forEach(s => {
        const div = document.createElement('div');
        div.className = 'manage-item';
        div.innerHTML =
          '<img src="' + s.url + '" alt="Slideshow photo" />' +
          '<button class="delete-btn" title="Remove" onclick="removeAboutSlide(\'' + s.id + '\')">&times;</button>';
        grid.appendChild(div);
      });
    }

    function renderAboutPicker() {
      const grid = document.getElementById('aboutPickerGrid');
      grid.innerHTML = '';
      // galleryData is built by loadGallery(): uploaded photos + staticImages.
      const usedRefIds = new Set(aboutSlides.map(s => s.refId).filter(Boolean));
      galleryData.forEach(g => {
        const div = document.createElement('div');
        const already = usedRefIds.has(g.id);
        div.className = 'manage-item' + (already ? ' picker-used' : '');
        div.style.opacity = already ? '0.35' : '1';
        div.innerHTML = '<img src="' + g.url + '" alt="Gallery photo" />';
        if (!already) {
          div.style.cursor = 'pointer';
          div.onclick = () => addFromGallery(g.id, g.url);
        }
        grid.appendChild(div);
      });
    }

    async function addAboutUpload(files) {
      if (!files || files.length === 0) return;
      const file = files[0];
      try {
        const compressed = await compressImage(file);
        const res = await fetch('/api/about', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add-upload', image: compressed, filename: file.name }),
        });
        if (!res.ok) throw new Error('server error (' + res.status + ')');
        showToast('Photo added to slideshow!');
        await loadAboutSlides();
      } catch (err) {
        console.error('Slideshow upload failed:', err);
        showToast('Could not add photo — ' + (err.message || 'unknown error'), true);
      }
      document.getElementById('aboutFileInput').value = '';
    }

    async function addFromGallery(refId, url) {
      try {
        const res = await fetch('/api/about', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add-gallery', refId, url }),
        });
        if (!res.ok) throw new Error('server error (' + res.status + ')');
        showToast('Added to slideshow!');
        await loadAboutSlides();
      } catch (err) {
        console.error('Add-from-gallery failed:', err);
        showToast('Could not add photo', true);
      }
    }

    async function removeAboutSlide(id) {
      try {
        const res = await fetch('/api/about', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', id }),
        });
        if (!res.ok) throw new Error('server error (' + res.status + ')');
        showToast('Removed from slideshow');
        await loadAboutSlides();
      } catch (err) {
        console.error('Remove slide failed:', err);
        showToast('Could not remove photo', true);
      }
    }
```

- [ ] **Step 3: Wire it into login init**

In `admin.html`, in the login success block (after `loadGallery();` and `loadLeads();` at lines 593-594), add a call so the picker has `galleryData`. Because `renderAboutPicker` reads `galleryData` (populated by `loadGallery`), call `loadAboutSlides()` after `loadGallery()` resolves. Change lines 593-594 from:

```js
          loadGallery();
          loadLeads();
```

to:

```js
          loadGallery().then(loadAboutSlides);
          loadLeads();
```

(`loadGallery` is `async`, so `.then` runs `loadAboutSlides` once `galleryData` is ready.)

- [ ] **Step 4: Verify the page loads and works**

Start the dev server (`vercel dev`) or use a preview deploy, then:
1. Open `/admin.html`, log in with the admin password.
2. Confirm the new "Our Story Slideshow" section appears with an empty-state message and an "Add From Gallery" grid showing your gallery + static photos.
3. Click a gallery photo → toast "Added to slideshow!", it appears under "Current Slideshow Photos", and that picker thumbnail dims (can't double-add).
4. Use "add a photo" to upload a file → toast success, appears in current photos.
5. Click **×** on a current photo → toast "Removed", it disappears; if it was a gallery photo, its picker thumbnail un-dims.
6. Confirm the gallery and leads sections still work normally.

Expected: all six behaviors as described; browser console shows no errors.

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "feat: add Our Story slideshow management to admin panel"
```

---

## Task 3: Homepage slideshow — `index.html`

**Files:**
- Modify: `index.html` (CSS in `<style>` near `.about-frame` ~line 400; markup at `.about-frame` ~line 1452; JS near `loadDynamicGallery` ~line 2080 and its call site ~line 2151)

**Interfaces:**
- Consumes: `GET /api/about` (Task 1).
- Produces: visible crossfading slideshow; no exports.

- [ ] **Step 1: Add slideshow CSS**

In `index.html`, right after the `.about-frame:hover img { ... }` rule (ends at line 411), add:

```css
    .about-frame img.about-slide {
      position: absolute;
      inset: 0;
      opacity: 0;
      transition: opacity 1.2s ease, transform 0.6s ease, filter 0.6s ease;
      z-index: 0;
    }
    .about-frame img.about-slide.is-active { opacity: 1; }
```

- [ ] **Step 2: Give the frame an id (keep the fallback image)**

In `index.html` change the About frame opening tag (line 1452) from:

```html
      <div class="about-frame">
        <img src="public/father-son.jpg" alt="Father and son team with award-winning deer mounts and purple ribbon" />
```

to:

```html
      <div class="about-frame" id="aboutFrame">
        <img src="public/father-son.jpg" alt="Father and son team with award-winning deer mounts and purple ribbon" />
```

(The static `<img>` stays as the default/fallback; JS removes it only when real slides exist.)

- [ ] **Step 3: Add the slideshow JS**

In `index.html`, right before the `// Load on page ready` comment (line 2150), add:

```js
    // ── OUR STORY SLIDESHOW ──
    async function loadAboutSlideshow() {
      const frame = document.getElementById('aboutFrame');
      if (!frame) return;

      let slides = [];
      try {
        const res = await fetch('/api/about');
        if (res.ok) slides = await res.json();
      } catch { return; } // network error → keep the static fallback image

      if (!Array.isArray(slides) || slides.length === 0) return; // empty → keep fallback

      // Replace the fallback image with layered, crossfading slides.
      frame.querySelectorAll('img').forEach(el => el.remove());
      slides.forEach((s, i) => {
        const img = document.createElement('img');
        img.src = s.url;
        img.alt = 'Lonely Pines Taxidermy work';
        img.className = 'about-slide' + (i === 0 ? ' is-active' : '');
        img.loading = i === 0 ? 'eager' : 'lazy';
        // A deleted gallery photo would 404 — drop that slide instead of showing a broken image.
        img.onerror = () => img.remove();
        frame.appendChild(img);
      });

      const visible = () => frame.querySelectorAll('.about-slide');
      if (visible().length <= 1) return; // single photo → no animation
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      let idx = 0;
      setInterval(() => {
        const imgs = visible();
        if (imgs.length <= 1) return;
        if (idx >= imgs.length) idx = 0;
        imgs[idx].classList.remove('is-active');
        idx = (idx + 1) % imgs.length;
        imgs[idx].classList.add('is-active');
      }, 5000);
    }
```

- [ ] **Step 4: Call it on page load**

In `index.html` change the load block (lines 2150-2151) from:

```js
    // Load on page ready
    loadDynamicGallery();
```

to:

```js
    // Load on page ready
    loadDynamicGallery();
    loadAboutSlideshow();
```

- [ ] **Step 5: Verify in the browser**

With slideshow photos set (from Task 2), on the homepage:
1. Scroll to "Our Story" — the framed photo crossfades through the chosen photos (~5s each), looping.
2. The gold "Award Winning Quality" badge stays pinned to the corner over every photo.
3. The warm vignette, inner border, and hover-zoom still work.
4. In the admin, remove all slideshow photos, reload the homepage → it shows the original father-and-son photo (fallback), not a blank frame.
5. Set exactly one slideshow photo → it shows with no animation.
6. Turn on "reduce motion" in OS settings, reload → first photo shows, no auto-advance.
7. `node --check` isn't applicable to HTML; instead confirm the browser console shows no errors.

Expected: all behaviors as described.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: crossfading Our Story slideshow on homepage with static fallback"
```

---

## Self-Review

**Spec coverage:**
- Separate `about-slideshow.json` manifest, images under `about/{id}.ext` → Task 1. ✓
- `/api/about` GET public + POST admin (add-upload / add-gallery / remove, blob delete on remove, duplicate guard) → Task 1. ✓
- Admin section: upload + gallery picker + current list with remove + empty state → Task 2. ✓
- Homepage: crossfade, static fallback on empty/error, single-photo no-animation, badge untouched, existing styling kept, reduced-motion, broken-image drop → Task 3. ✓
- Out of scope (reorder, captions, arrows/dots) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; all code is complete and literal. ✓

**Type consistency:** Manifest entry shape `{ id, url, source, refId }` is identical across `api/about.js`, `renderAboutPicker` (`s.refId`), and homepage (`s.url`). Function names (`loadAboutSlides`, `renderAboutSlides`, `renderAboutPicker`, `addAboutUpload`, `addFromGallery`, `removeAboutSlide`, `loadAboutSlideshow`) are used consistently. `galleryData` items expose `.id` and `.url`, matching `renderAboutPicker`. ✓

**Note for implementer:** `loadGallery()` in `admin.html` must return its promise for `loadGallery().then(loadAboutSlides)` to sequence correctly. It is declared `async` (line 804), so it already returns a promise — no change needed. If a future edit makes it non-async, add `return` to its awaited chain.
