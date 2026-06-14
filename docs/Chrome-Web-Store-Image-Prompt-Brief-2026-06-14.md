# Smart Preload Chrome Web Store Image Brief

Use this document to generate Chrome Web Store listing images with ChatGPT or another image tool.

## Product Facts

- Product name: `Smart Preload`
- One-line summary: `Smarter, more proactive preloading for pages you are likely to open next.`
- Category: Productivity
- Visual style: clean modern productivity tool, calm, technical, trustworthy.
- Brand feeling: faster browsing, intelligent prediction, local control, performance-aware automation.
- Suggested colors:
  - Deep ink: `#10221c`
  - Muted green: `#4f7f6f`
  - Pale green background: `#f5f8f4`
  - Soft border: `#d8e4dc`
  - White panels: `#ffffff`
- Avoid: cartoons, neon cyberpunk, gaming style, overloaded dashboards, fake Google/Chrome logos, exaggerated speed claims.

## Chrome Web Store Constraints

- Localized screenshots:
  - Size: exactly `1280x800` or `640x400`
  - Format: JPEG or 24-bit PNG
  - No alpha / no transparent background
  - At least one screenshot is required
  - Can be localized per language
- Small promo tile:
  - Size: exactly `440x280`
  - Format: JPEG or 24-bit PNG
  - No alpha
  - Not localized
- Marquee promo tile:
  - Size: exactly `1400x560`
  - Format: JPEG or 24-bit PNG
  - No alpha
  - Not localized

## General Image Rules

- Output should be full-bleed at the required canvas size. Do not add transparent padding.
- Text must be large, crisp, and easy to read at store thumbnail sizes.
- Use English text first.
- Keep claims modest and accurate. Do not say “instant browsing” or “guaranteed faster”.
- It is fine to show abstract UI panels, link cards, tabs, arrows, and preload status chips.
- Do not use actual Chrome logo, Google logo, or Chrome Web Store logo.
- Do not show private data, real website brands, API keys, email addresses, or user profiles.

## Prompt 1: Main Localized Screenshot 1280x800

```text
Create a Chrome Web Store screenshot for a browser extension named “Smart Preload”.

Canvas: exactly 1280x800 pixels.
Format target: 24-bit PNG, no alpha, no transparent background.

Scene:
A clean browser-extension settings page for a productivity tool. Show a left sidebar with “Smart Preload” and navigation items “Tracking”, “Preload”, and “Experiments”. The main panel should focus on the Preload section. Include modern rounded setting rows with toggles, similar to a professional browser extension settings page. The visible settings should include:
- Enable preloading
- Hover and context-menu preload
- All-native preload mode
- Exclude incognito windows from preloading
- Proxy skip rules

Add a short headline overlay or top caption inside the image:
“Smarter preload control”

Add a small supporting line:
“Predict likely next pages while keeping limits, privacy, and performance under your control.”

Visual style:
Minimal, modern, calm productivity UI. White panels, pale green background, muted green toggles, deep dark text, thin soft borders. Sharp readable typography. No brand logos from Chrome or Google. No transparent background.

Composition:
Make it look like a real app screenshot, not a marketing poster. Leave enough whitespace. Text must be readable.
```

## Prompt 2: Small Promo Tile 440x280

```text
Create a Chrome Web Store small promo tile for a browser extension named “Smart Preload”.

Canvas: exactly 440x280 pixels.
Format target: 24-bit PNG, no alpha, no transparent background.

Text:
Smart Preload
Preload likely next pages

Visual concept:
A clean browser tab strip with 3-4 simplified tabs. One active tab points through a subtle curved arrow to a softly highlighted next page card. Add small status chips such as “Local signals”, “Preload limits”, and “Performance aware”.

Style:
Modern productivity software, restrained and trustworthy. Pale green background, white cards, muted green accents, deep dark text. Crisp typography. Minimal details because this tile will be small. No Chrome logo, no Google logo, no fake brand websites.

Composition:
Readable title in the left or center. UI illustration on the right or bottom. Keep high contrast and avoid tiny text.
```

## Prompt 3: Marquee Promo Tile 1400x560

```text
Create a Chrome Web Store marquee promo tile for a browser extension named “Smart Preload”.

Canvas: exactly 1400x560 pixels.
Format target: 24-bit PNG, no alpha, no transparent background.

Main headline:
Smart Preload

Supporting line:
Smarter, more proactive preloading for pages you are likely to open next.

Visual concept:
A wide, clean productivity scene showing multiple browser tabs on the left, a lightweight prediction flow in the center, and preloaded page cards on the right. Use subtle arrows or connection lines to show “current page -> predicted next pages -> ready faster”. Include small UI badges:
- Across tabs
- Privacy exclusions
- Performance aware
- Optional local app

Style:
Premium browser extension listing art. Calm pale green background, white interface panels, muted green accents, deep ink text, thin soft borders. Clear professional typography. No cartoon characters. No neon effects. No Chrome or Google logos. No transparent background.

Composition:
Wide layout, strong first-glance readability. Keep the product name large. Keep all text away from edges. Leave safe margins. Avoid clutter.
```

## Optional Prompt 4: Feature Screenshot 1280x800

```text
Create a second Chrome Web Store screenshot for “Smart Preload”.

Canvas: exactly 1280x800 pixels.
Format target: 24-bit PNG, no alpha.

Scene:
A clean extension popup and a browser page side by side. The popup shows a ranked list of likely next links for the current page, with labels like “Top candidates”, “Preload-ready”, and “Current page”. The page in the background should be generic and unbranded, using placeholder cards and links only.

Caption:
“Preload decisions follow the page you are using”

Supporting line:
“Ranks likely next links locally, then keeps the experience responsive across tabs.”

Style:
Modern, realistic browser extension UI, pale green and white, muted green accents, readable text, no real site names or logos.
```

## Export Checklist

- Confirm exact dimensions before upload.
- Confirm no alpha channel. If needed, convert to 24-bit PNG.
- File names can be:
  - `smart-preload-screenshot-en-1.png`
  - `smart-preload-small-promo-440x280.png`
  - `smart-preload-marquee-promo-1400x560.png`
- Upload at least one localized screenshot first.
- Promo tiles can be left empty if the dashboard does not require them.
