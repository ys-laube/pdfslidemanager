# Design

## Source of truth
- Status: Active draft for v1 implementation
- Last refreshed: 2026-06-26
- Primary product surfaces:
  - Static browser web app for converting multi-slide PDF handouts into one-slide-per-page PDFs.
  - Empty/upload screen, loaded PDF preview workspace, per-page/range edit controls, conversion/download status, error/limit states.
  - Evidence reviewed:
    - `.omx/specs/deep-interview-pdf-slide-splitter-webapp.md` — product requirements from user interview.
    - `.omx/plans/prd-pdf-slide-splitter-webapp.md` — approved ralplan PRD and architecture.
    - `.omx/plans/test-spec-pdf-slide-splitter-webapp.md` — verification expectations.
    - G003 inspector saved-layout UI context — separated Grid preset and Saved crop layout IA.
  - getdesign.md Apple analysis: https://getdesign.md/apple/design-md
  - getdesign.md catalog / DESIGN.md format context: https://getdesign.md/
  - VoltAgent Apple DESIGN.md source analysis: https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/apple/DESIGN.md
  - Apple Developer Design resources / HIG entry point: https://developer.apple.com/design/
- Evidence absent:
  - No existing app UI, components, screenshots, tokens, brand files, or repo-local design docs existed before this file.
- Attribution and boundary:
  - The visual direction is **Apple-inspired**, using getdesign.md’s publicly observable analysis as inspiration.
  - This project is not affiliated with Apple. Do not use Apple logos, product imagery, proprietary app icons, trademarked marks, or copy that implies endorsement.

## Brand
- Personality:
  - Calm, premium, precise, privacy-first, study-focused.
  - Feels like a polished macOS/iPad utility: low-friction, trustworthy, and quiet.
- Trust signals:
  - Persistent “local-only / no upload” reassurance near upload and export actions.
  - Transparent processing steps: loaded locally, previewed locally, exported locally.
  - Clear edit-before-export workflow so users can catch detection mistakes.
- Avoid:
  - Apple branding or trademarked assets.
  - Decorative gradients, novelty illustrations, heavy shadows, cluttered dashboards, dense enterprise tables.
  - Over-marketing. This is a practical study utility, not a cinematic product launch page.

## Product goals
- Goals:
  - Make bundled lecture/conference PDF slides comfortable to read and annotate in GoodNotes.
  - Keep the user’s source PDF private and unchanged.
  - Make mixed layouts understandable through preview, confidence, and fast correction.
  - Look polished enough to feel trustworthy across desktop/laptop environments.
- Non-goals:
  - Cloud upload, account system, library management, OCR/AI extraction, polished SaaS marketing site.
  - Pixel-perfect Apple clone or use of Apple-owned visual assets.
- Success signals:
  - A new user understands “drop PDF → review layouts → download split PDF” within seconds.
  - A user can correct a wrong 3x2/2x2/2-up/1-up guess without reading docs.
  - Visual hierarchy remains calm even for long PDFs and mixed page formats.

## Personas and jobs
- Primary personas:
  - Student/researcher using conference or lecture handouts on iPad/GoodNotes.
  - Knowledge worker who receives exported slide PDFs with 2-up/4-up/6-up pages.
- User jobs:
  - Convert a PDF locally into one slide per page.
  - Review uncertain pages and apply corrections to page ranges quickly.
  - Download a predictable PDF without changing the source file.
- Key contexts of use:
  - Desktop/laptop browser before importing to iPad.
  - Potentially large PDFs, mixed title/TOC/content pages, landscape/portrait variation.
  - Privacy-sensitive academic or professional material.

## Information architecture
- Primary navigation:
  - Single-page app. No multi-route navigation required for v1.
  - Minimal top bar: product name, local-only privacy status, help/limitations link if needed.
- Core routes/screens:
  - Empty/upload state.
  - PDF loaded preview/editor workspace.
  - Conversion/progress state.
  - Success/download state.
  - Recoverable error/limit-warning state.
- Content hierarchy:
  1. Current task/action: upload, review, convert, download.
  2. Document preview and detected layout confidence.
  3. Correction controls for selected page/page range.
  4. Privacy and file-status details.
  5. Help/limitations in secondary disclosure.
- Inspector hierarchy:
  1. Page context and detection/edit reason.
  2. **Grid preset** controls: choose a deterministic 1x1, 1x2, 2x1, 2x2, 2x3, or 3x2 slide grid.
  3. **Apply grid preset to pages** controls: explicit page range plus preset selector. This must not look or read like a saved layout action.
  4. **Saved crop layouts** controls: save current crop geometry, select a session-local saved layout, rename, update from the current page, delete, and apply the saved layout to an explicit range.
  5. Secondary crop-template copy and crop-spacing controls. Current-template copy remains available but visually subordinate to grid presets and saved layouts.

## Design principles
- Principle 1: Interface chrome recedes; the PDF preview is the hero.
- Principle 2: Calm precision beats flashy automation. Detection is advisory and editable.
- Principle 3: Every primary action should reinforce local processing and source preservation.
- Principle 4: Mixed layouts must be visually obvious, not hidden in labels.
- Tradeoffs:
  - Use generous whitespace but avoid wasting workspace on smaller laptop screens.
  - Use Apple-inspired minimalism, but keep controls discoverable for non-design users.
  - Prefer deterministic UI states over animated delight when performance is constrained by large PDFs.

## Visual language
- Color:
  - Canvas: `#ffffff`.
  - Off-white workspace/surface: `#f5f5f7`, `#fafafc`.
  - Ink: `#1d1d1f`; muted text: `#6e6e73` or `#7a7a7a`.
  - Hairline/divider: `#d2d2d7`, `#e0e0e0`, `#f0f0f0`.
  - Primary action blue: `#0066cc`; focus/hover blue: `#0071e3`; dark-surface blue if needed: `#2997ff`.
  - Error/warning colors must meet WCAG AA contrast and should be used sparingly.
- Typography:
  - Use system stack first: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif`.
  - Large, clear headings with slight negative letter spacing; body text around 15-17px with generous line height.
  - Avoid decorative display fonts and dense all-caps blocks.
- Spacing/layout rhythm:
  - 4px base increments; common steps 8, 12, 16/17, 24, 32, 48, 80.
  - Wide breathing room around upload and success states; tighter but still calm spacing inside the editor.
- Shape/radius/elevation:
  - Soft cards: 18px radius for primary panels; 9999px for pill buttons/chips.
  - Prefer 1px hairlines and subtle surface contrast over heavy shadows.
  - Shadows only for active floating panels or PDF page lift, never as decorative chrome.
- Inspector styling:
  - Use quiet card groups with off-white fills and hairline borders to separate Grid preset, page-range preset apply, Saved crop layouts, and Crop spacing.
  - Saved crop layouts may use a subtle blue-tinted surface to signal reusable crop geometry, but not a promotional or branded treatment.
  - Empty saved-layout state should be explicit and calm: “No saved layouts” in the selector, disabled dependent controls, and helper copy that says layouts are session-local to the current PDF.
- Motion:
  - Short, functional transitions under 180ms for hover/focus/panel reveal.
  - Respect `prefers-reduced-motion`; disable nonessential animation.
- Imagery/iconography:
  - No Apple product imagery.
  - Use simple inline icons only when they clarify actions: upload, lock/local, grid, warning, download.
  - PDF thumbnails/previews provide the main visual content.

## Components
- Existing components to reuse:
  - None; greenfield repo.
- New/changed components:
  - `AppShell`: minimal top bar, privacy status, main workspace.
  - `DropZoneCard`: large rounded upload target with drag, click-to-select, supported PDF copy, local-only reassurance.
  - `PrivacyBadge`: persistent no-upload/source-unchanged cue.
  - `PreviewCanvas`: PDF page render with crop-grid overlay, reading-order labels, selected crop state.
  - `PageStrip` / `ThumbnailRail`: compact page navigation with confidence markers.
  - `InspectorPanel`: selected page context plus grouped controls for Grid preset, applying a grid preset to page ranges, Saved crop layouts, current crop-template copy, and crop spacing.
  - `SegmentedLayoutPicker`: 1x1, 1x2, 2x1, 2x2, 2x3, and 3x2 presets in pill/segmented controls.
  - `RangeApplySheet` / range row: explicit page-range input paired with either a grid-preset action or a saved-layout action. The action label must state which kind of layout is applied.
  - `SavedCropLayoutsSection`: current-PDF/session-only layout save/select/rename/update/delete/apply controls, with a visible empty state and disabled reasons for review-needed or no-crop pages.
  - `WorkloadWarning`: non-blocking warning for large file/page/output estimates.
  - `ExportBar`: primary convert/download action, progress, success, error recovery.
- Variants and states:
  - Empty, drag-over, file-loaded, confidence-high, review-needed, selected, overridden, processing, success, warning, error, disabled.
  - All interactive states need visible hover/focus/active treatment, not color-only changes.
- Token/component ownership:
  - Store design tokens as CSS custom properties in `src/styles.css` or `src/styles/tokens.css`.
  - Optional TypeScript constants may mirror layout/grid tokens only if code needs them; CSS remains visual source of truth.

## Accessibility
- Target standard:
  - WCAG 2.2 AA for contrast, keyboard access, focus visibility, and semantic controls.
- Keyboard/focus behavior:
  - File input remains keyboard accessible through the drop zone label/button.
  - Page thumbnails, layout picker, range controls, convert/download actions are reachable by keyboard.
  - Focus ring uses primary blue and is visible on light/off-white surfaces.
- Contrast/readability:
  - Body text and controls must pass AA on white/off-white.
  - Muted text is secondary only; do not use it for critical instructions/errors.
- Screen-reader semantics:
  - Canvas previews must be paired with accessible text: page number, detected layout, confidence, selected crop/order summary.
  - Progress and conversion status use live regions where appropriate.
- Reduced motion and sensory considerations:
  - Respect reduced motion.
  - Avoid flashing progress and unnecessary parallax/zoom effects.

## Responsive behavior
- Supported breakpoints/devices:
  - Desktop/laptop first: 1280px, 1024px, 768px minimum useful widths.
  - Tablet browser support is desirable; phone support may be limited but should degrade cleanly.
- Layout adaptations:
  - Large screens: three-zone workspace — thumbnail rail, central preview, right inspector/export panel.
  - Medium screens: preview first, collapsible rail/inspector.
  - Small screens: stacked workflow with selected page controls below preview; no horizontal overflow.
  - At 1024px and 768px, mixed-layout review-needed status, edit controls, and override affordances must remain visible or immediately reachable with explicit labels; do not hide correction controls behind ambiguous overflow or purely decorative minimalism.
- Touch/hover differences:
  - Touch targets minimum 44px where practical.
  - Hover affordances must have touch-visible equivalents.

## Interaction states
- Loading:
  - Show local-read progress and “processing in this browser” language.
  - Skeletons should be subtle; avoid fake precision.
- Empty:
  - Centered drop zone card with one primary action and one privacy statement.
- Error:
  - Plain-language issue, likely cause, and recovery action. Preserve edits whenever possible.
- Success:
  - Clear download button, output filename, page count summary, source-unchanged reassurance.
- Disabled:
  - Disabled convert action must explain what is missing: no file, review required, invalid crop, or export in progress.
  - Disabled saved-layout actions must explain the missing state when possible: no saved layouts, review-needed crop boxes, or no crop boxes on the selected page.
  - Disabled controls still need a visible shape, hairline, and readable label; do not rely on low opacity alone.
- Offline/slow network:
  - After static assets load, the app should not depend on network for PDF processing. If dependencies fail to load, show a static-load error, not an upload error.

## Content voice
- Tone:
  - Calm, concise, helpful, privacy-confident.
- Terminology:
  - Use “PDF”, “slide”, “page”, “layout”, “crop”, “preview”, “download”.
  - Avoid ambiguous “6-up” alone; pair with “3x2 / six slides per page”.
- Microcopy rules:
  - Reassure without overpromising: “Processed locally in your browser” rather than “impossible to upload”.
  - Explain detection limits: “Suggested layout — review before export”.
  - Prefer action labels: “Apply to page range”, “Convert to one slide per page”, “Download split PDF”.
  - Disambiguate layout concepts: use “Grid preset” for built-in row/column presets, “Saved crop layout” for user-saved crop geometry, and “current crop template” only for one-off copying from the selected page.

## Implementation constraints
- Framework/styling system:
  - Vite + TypeScript static browser app.
  - Vanilla DOM or lightweight component modules unless execution evidence justifies a UI framework.
  - CSS custom properties for tokens; avoid adding a design-system dependency in v1.
- Design-token constraints:
  - Implement root tokens for color, type, radius, spacing, focus, and surface roles before feature UI work.
  - Keep Apple-inspired values as project tokens, not brand references in user-facing copy.
- Performance constraints:
  - PDF rendering/conversion may be heavy. UI must remain responsive and show progress; avoid expensive decorative effects.
  - Preview density should adapt to long PDFs without rendering every full-resolution page at once.
- Compatibility constraints:
  - Browser-only/static v1; no backend or local server path.
  - No analytics or external upload paths.
- Test/screenshot expectations:
  - Capture main visual states for review: empty/drop, loaded preview, selected/overridden page, review-needed, processing, success/download, error/warning.
  - UI tests should verify focus visibility, keyboard reachability of core controls, and local-only messaging presence.

## Open questions
- [ ] Representative real PDFs / owner: user / impact: improves visual density and detection-state tuning.
- [ ] Exact app name / owner: user or implementation lead / impact: affects top-bar and output filename copy only.
- [ ] Whether to add dark mode in v1 / owner: implementation lead / impact: likely defer; Apple-inspired light mode is default.
