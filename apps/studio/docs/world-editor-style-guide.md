# WorldEditor Style Guide

This document defines the visual design language for the World Editor — the "simple mode" editing surface in PubWiki Studio. The goal is to preserve the warm, literary feel of the original Paper design system while integrating seamlessly with Studio's existing Tailwind-based clean interface.

## 1. Design Philosophy

**"Paper meets Modern"** — The World Editor retains the warm, approachable quality of the original Paper theme (warm neutrals, subtle shadows, serif accents in headings) while adopting Studio's utility-first Tailwind approach. The result should feel like opening a handcrafted notebook inside a modern application.

Key principles:
- **Warm neutrals** as base tones (instead of pure white/gray).
- **Serif headings** for display/section titles; sans-serif for body text and UI controls.
- **Subtle depth** via soft shadows (no hard/neo-brutalist shadows).
- **Rounded but not bubbly** — use moderate border radii (6-8px for cards, pill for tabs/badges).
- **No emoji** — all icons are SVG (Lucide or custom inline SVG). Emoji use is strictly prohibited.

## 2. Color Palette

The World Editor introduces a warm sub-palette that coexists with Studio's default Tailwind colors. These are applied via Tailwind arbitrary values or a small set of CSS custom properties.

### 2.1 Background Layers

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--we-bg-base` | `#f4f1ea` | `bg-[#f4f1ea]` | Main editor background |
| `--we-bg-card` | `#fbf9f4` | `bg-[#fbf9f4]` | Card surfaces, elevated panels |
| `--we-bg-secondary` | `#ece7de` | `bg-[#ece7de]` | Secondary surfaces, tab bar background |
| `--we-bg-content` | `#fdfaf3` | `bg-[#fdfaf3]` | Content area, form backgrounds |
| `--we-bg-hover` | `rgba(44,40,37,0.05)` | `hover:bg-black/5` | Hover overlay |
| `--we-bg-active` | `rgba(44,40,37,0.08)` | `active:bg-black/[0.08]` | Active/pressed overlay |

### 2.2 Text Colors

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--we-text-primary` | `#2c2825` | `text-[#2c2825]` | Headings, primary labels |
| `--we-text-secondary` | `#6a645e` | `text-[#6a645e]` | Body text, descriptions |
| `--we-text-tertiary` | `#8b857a` | `text-[#8b857a]` | Hints, placeholders, muted text |
| `--we-text-accent` | `#b05c5c` | `text-[#b05c5c]` | Accent text, active tab label |

### 2.3 Accent Colors

The World Editor reuses Studio's blue (`blue-500`, `blue-600`) for primary actions (save, add) and focus rings, maintaining consistency with the rest of the app. The warm accent color (`#b05c5c`, ink red) is used sparingly for:

- Active/selected tab indicators
- Entity type badges
- Validation error highlights

| Token | Value | Usage |
|-------|-------|-------|
| `--we-accent` | `#b05c5c` | Primary warm accent (ink red) |
| `--we-accent-ochre` | `#d18a4a` | Secondary warm accent (ochre) |
| `--we-accent-olive` | `#5c6256` | Tertiary (muted green) |
| `--we-accent-plum` | `#6a586d` | Quaternary (muted purple) |

These accents are used for **entity type badges**:
- Creatures: ink red (`#b05c5c`)
- Regions: olive (`#5c6256`)
- Organizations: plum (`#6a586d`)
- World: ochre (`#d18a4a`)

### 2.4 Border & Shadow

| Token | Value | Usage |
|-------|-------|-------|
| `--we-border` | `rgba(44,40,37,0.15)` | Default card/section borders |
| `--we-border-hover` | `rgba(44,40,37,0.3)` | Hover state borders |
| `--we-border-focus` | (blue-500) | Focus ring — remains Studio standard |
| `--we-shadow-sm` | `0 1px 2px rgba(44,40,37,0.05)` | Subtle lift |
| `--we-shadow-md` | `0 4px 8px rgba(44,40,37,0.06)` | Card resting state |
| `--we-shadow-lg` | `0 8px 16px rgba(44,40,37,0.08)` | Modal / elevated panels |

## 3. Typography

### 3.1 Font Stack

| Role | Font | Tailwind Class |
|------|------|---------------|
| **Display / Section Titles** | `'Noto Serif SC', Georgia, serif` | `font-serif` (configure in app.css) |
| **Body / UI** | System font stack (Inter if loaded, or system-ui) | `font-sans` (Tailwind default) |
| **Code / Mono** | `'JetBrains Mono', 'Fira Code', monospace` | `font-mono` |

The display serif font is used only for:
- Panel section titles (e.g., "Characters", "World Settings")
- Entity names in card views
- The editor's main heading

All other text (labels, inputs, buttons, descriptions) uses the default sans-serif stack, matching Studio's existing look.

### 3.2 Type Scale

| Size | rem | Usage |
|------|-----|-------|
| xs | 0.75rem | Badges, timestamps, tiny labels |
| sm | 0.875rem | Body text, input values, card descriptions |
| base | 1rem | Section labels, form labels |
| lg | 1.125rem | Panel titles |
| xl | 1.25rem | Major section headers |
| 2xl | 1.5rem | Editor main title (rarely used) |

Use standard Tailwind `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`.

### 3.3 Font Weight

- **Normal (400)**: Body text, descriptions
- **Medium (500)**: Form labels, secondary headings
- **Semibold (600)**: Tab labels, card titles
- **Bold (700)**: Section titles (serif), entity names

## 4. Spacing

Use Tailwind's default spacing scale. Key conventions:

| Context | Spacing |
|---------|---------|
| Card padding | `p-4` to `p-5` (1rem to 1.25rem) |
| Section gap | `gap-4` (1rem) |
| Form group gap | `gap-3` (0.75rem) |
| Inline element gap | `gap-2` (0.5rem) |
| Grid gap | `gap-3` (0.75rem) |
| Tab bar padding | `px-4 py-2` |
| Modal padding | `p-6` |

## 5. Border Radius

| Usage | Value | Tailwind |
|-------|-------|----------|
| Cards, panels | 6px | `rounded-md` |
| Buttons | 6px | `rounded-md` |
| Inputs | 4px | `rounded` |
| Badges, pills | 9999px | `rounded-full` |
| Modals | 12px | `rounded-xl` |
| Tab buttons (active) | pill shape | `rounded-full` |

The Paper system used quite small radii (2-8px). We adopt a middle ground: moderate rounding (`rounded-md`) for most elements, `rounded-full` for badges/pills.

## 6. Component Patterns

### 6.1 Tabs

Horizontal pill-style tabs with group separators.

```html
<!-- Tab bar -->
<div class="flex items-center gap-1 px-4 py-2 bg-[#ece7de] border-b border-black/10 overflow-x-auto">
  <!-- Group: World Building -->
  <button class="tab active">Dashboard</button>
  <button class="tab">World</button>
  <button class="tab">Characters</button>
  <button class="tab">Regions</button>
  <button class="tab">Organizations</button>
  <!-- Separator -->
  <div class="w-px h-5 bg-black/15 mx-1 shrink-0"></div>
  <!-- Group: Story -->
  <button class="tab">Story</button>
  <button class="tab">Wiki</button>
</div>

<!-- Tab button -->
<button class="
  inline-flex items-center gap-1.5
  px-3 py-1.5
  text-sm font-semibold
  rounded-full
  border-2 border-transparent
  text-[#6a645e]
  hover:bg-black/5 hover:text-[#2c2825]
  transition-colors
  whitespace-nowrap shrink-0
">
  <svg class="w-4 h-4"><!-- icon --></svg>
  Dashboard
</button>

<!-- Active state -->
<button class="... bg-[#f4f1ea] text-[#2c2825] border-[#2c2825] font-bold">
```

### 6.2 Entity Cards

Cards in the entity grid (characters, regions, organizations).

```html
<div class="
  bg-[#fbf9f4]
  border-2 border-black/10
  rounded-md
  p-3
  cursor-pointer
  hover:scale-[1.02] hover:-translate-y-0.5
  hover:border-[#b05c5c]
  hover:shadow-md
  transition-all duration-200
  flex flex-col gap-1
  relative
  group
">
  <!-- Type badge -->
  <span class="
    text-[0.65rem] font-bold uppercase tracking-wider
    px-2 py-0.5 rounded-full
    bg-[#f4f1ea] text-[#2c2825]
    w-fit
  ">Character</span>

  <!-- Name (serif) -->
  <span class="font-serif font-bold text-sm text-[#2c2825] truncate">
    Aria Windwalker
  </span>

  <!-- Subtitle -->
  <span class="text-xs text-[#8b857a] truncate">
    Human, Female, 28
  </span>

  <!-- Hover actions -->
  <div class="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
    <button class="p-1 rounded bg-[#fbf9f4] border border-black/10 hover:bg-blue-500 hover:text-white">
      <svg class="w-3.5 h-3.5"><!-- edit icon --></svg>
    </button>
    <button class="p-1 rounded bg-[#fbf9f4] border border-black/10 hover:bg-red-500 hover:text-white">
      <svg class="w-3.5 h-3.5"><!-- delete icon --></svg>
    </button>
  </div>
</div>
```

### 6.3 Bento Cards (Detail View)

Used to display entity sections (Appearance, Inventory, etc.) as a grid of summary tiles.

```html
<div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
  <button class="
    bg-[#fbf9f4]
    border-2 border-black/10
    rounded-md
    p-4
    text-left
    hover:border-black/20
    hover:shadow-sm
    transition-all
    flex flex-col gap-2
  ">
    <div class="flex items-center gap-2">
      <svg class="w-4 h-4 text-[#b05c5c]"><!-- section icon --></svg>
      <span class="text-sm font-semibold text-[#2c2825]">Inventory</span>
      <span class="ml-auto text-xs text-[#8b857a]">3 items</span>
    </div>
    <p class="text-xs text-[#6a645e] line-clamp-2">
      Enchanted sword, Leather armor, Healing potion
    </p>
  </button>
</div>
```

### 6.4 Edit Modal

Overlay modal for detailed editing. Three sizes.

```html
<!-- Backdrop -->
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
  <!-- Modal panel -->
  <div class="
    bg-[#fbf9f4]
    rounded-xl
    shadow-xl
    w-full
    max-w-xl     <!-- normal: max-w-xl (640px) -->
    max-w-3xl    <!-- wide: max-w-3xl (900px) -->
    max-w-6xl    <!-- full: max-w-6xl (1200px) -->
    max-h-[85vh]
    overflow-y-auto
    p-6
  ">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-serif font-bold text-lg text-[#2c2825]">Edit Inventory</h3>
      <button class="p-1 rounded hover:bg-black/5">
        <svg class="w-5 h-5 text-[#6a645e]"><!-- X icon --></svg>
      </button>
    </div>

    <!-- Content -->
    <div> ... form content ... </div>

    <!-- Footer (optional) -->
    <div class="flex justify-end gap-2 mt-6 pt-4 border-t border-black/10">
      <button class="px-4 py-2 text-sm rounded-md border border-black/15 hover:bg-black/5">
        Cancel
      </button>
      <button class="px-4 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600">
        Save
      </button>
    </div>
  </div>
</div>
```

### 6.5 Form Elements

```html
<!-- Form group -->
<div class="flex flex-col gap-1.5">
  <label class="text-sm font-medium text-[#2c2825]">Character Name</label>
  <input class="
    w-full px-3 py-2
    text-sm text-[#2c2825]
    bg-white
    border border-black/15
    rounded
    placeholder:text-[#8b857a]
    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
    transition-colors
  " />
  <span class="text-xs text-[#8b857a]">The character's display name.</span>
</div>

<!-- Form grid (2 columns) -->
<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
  <!-- form groups -->
</div>

<!-- Textarea -->
<textarea class="
  w-full px-3 py-2
  text-sm text-[#2c2825]
  bg-white
  border border-black/15
  rounded
  placeholder:text-[#8b857a]
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  min-h-[80px] resize-y
"></textarea>
```

### 6.6 Buttons

```html
<!-- Primary -->
<button class="px-4 py-2 text-sm font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors">
  Add Character
</button>

<!-- Secondary -->
<button class="px-4 py-2 text-sm font-medium rounded-md border border-black/15 text-[#2c2825] hover:bg-black/5 transition-colors">
  Cancel
</button>

<!-- Danger -->
<button class="px-4 py-2 text-sm font-medium rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">
  Delete
</button>

<!-- Ghost / Icon button -->
<button class="p-1.5 rounded hover:bg-black/5 text-[#6a645e] hover:text-[#2c2825] transition-colors">
  <svg class="w-4 h-4"><!-- icon --></svg>
</button>
```

### 6.7 Collapsible Section

```html
<div class="border-2 border-black/10 rounded-md overflow-hidden">
  <button class="
    w-full flex items-center justify-between
    px-4 py-3
    bg-[#fbf9f4]
    hover:bg-black/5
    transition-colors
  ">
    <span class="text-sm font-semibold text-[#2c2825]">Status Effects</span>
    <svg class="w-4 h-4 text-[#6a645e] transition-transform" class:rotate-180={open}>
      <!-- chevron-down -->
    </svg>
  </button>
  {#if open}
    <div class="px-4 py-3 border-t border-black/10">
      <!-- content -->
    </div>
  {/if}
</div>
```

### 6.8 Empty State

```html
<div class="
  col-span-full
  text-center
  py-8
  text-[#8b857a] text-sm
  bg-[#fbf9f4]
  border-2 border-dashed border-black/15
  rounded-md
">
  No characters yet. Click "Add Character" to create one.
</div>
```

### 6.9 Validation Panel

```html
<div class="bg-red-50 border border-red-200 rounded-md p-3">
  <div class="flex items-center gap-2 mb-2">
    <svg class="w-4 h-4 text-red-500"><!-- alert icon --></svg>
    <span class="text-sm font-semibold text-red-700">3 validation errors</span>
  </div>
  <ul class="text-xs text-red-600 space-y-1 ml-6 list-disc">
    <li>Creatures[0].creature.name: Creature name is required</li>
    <li>Regions[1].region.paths[0]: References non-existent region</li>
  </ul>
</div>
```

## 7. Icon System

All icons use inline SVG from the Lucide icon set (or equivalent). Never use emoji characters.

Representative icon mapping for tabs and sections:

| Section | Icon (Lucide name) | SVG Stroke |
|---------|-------------------|------------|
| Dashboard | `layout-dashboard` | current |
| World | `globe` | current |
| Characters | `users` | current |
| Regions | `map` | current |
| Organizations | `building-2` | current |
| Story | `book-open` | current |
| Wiki | `scroll-text` | current |
| Inventory | `backpack` | current |
| Appearance | `palette` | current |
| Relationships | `heart-handshake` | current |
| Status Effects | `sparkles` | current |
| Logs | `list` | current |
| Documents | `file-text` | current |
| Time | `clock` | current |
| Flags | `flag` | current |
| Settings | `sliders-horizontal` | current |

Icons are sized consistently:
- Tab icons: `w-4 h-4`
- Card section icons: `w-4 h-4`
- Toolbar buttons: `w-4 h-4`
- Modal header: `w-5 h-5`
- Empty state illustrations: `w-8 h-8` or `w-12 h-12`

## 8. CSS Custom Properties Setup

Add these to the WorldEditor root element or to `app.css` scoped under a `.world-editor` class:

```css
/* apps/studio/src/app.css — World Editor warm palette */
.world-editor {
  --we-bg-base: #f4f1ea;
  --we-bg-card: #fbf9f4;
  --we-bg-secondary: #ece7de;
  --we-bg-content: #fdfaf3;
  --we-text-primary: #2c2825;
  --we-text-secondary: #6a645e;
  --we-text-tertiary: #8b857a;
  --we-accent: #b05c5c;
  --we-border: rgba(44, 40, 37, 0.15);
  --we-border-hover: rgba(44, 40, 37, 0.3);
  --we-shadow-sm: 0 1px 2px rgba(44, 40, 37, 0.05);
  --we-shadow-md: 0 4px 8px rgba(44, 40, 37, 0.06);
  --we-shadow-lg: 0 8px 16px rgba(44, 40, 37, 0.08);
}
```

Then reference them in Tailwind arbitrary values: `bg-[var(--we-bg-base)]`, `text-[var(--we-text-primary)]`, etc. This keeps values centralized while staying in the Tailwind utility paradigm.

Using Tailwind inline values (`bg-[#f4f1ea]`) is acceptable for one-off usage, but for values referenced more than 3 times, prefer the CSS custom property.

## 9. Responsive Behavior

| Breakpoint | Behavior |
|-----------|----------|
| < 640px (sm) | Entity grid: single column. Form grid: single column. Bento grid: 1-2 columns. Tabs scroll horizontally. |
| 640-1024px (md) | Entity grid: 2-3 columns. Form grid: 2 columns. Bento: 2-3 columns. |
| > 1024px (lg) | Entity grid: 3-4+ columns. Form grid: 2-3 columns. Bento: 3-4+ columns. |

Use Tailwind responsive prefixes: `sm:grid-cols-2`, `lg:grid-cols-3`.

## 10. Animation & Transitions

Keep animations minimal and purposeful:

| Element | Transition | Duration |
|---------|-----------|----------|
| Hover effects (bg, border) | `transition-colors` | 150ms (default) |
| Card hover (scale) | `transition-all duration-200` | 200ms |
| Modal enter | fade + scale up | 200ms |
| Collapsible expand | height auto-animate | 200ms |
| Tab switch | none (instant content swap) | — |

Avoid bouncing effects, complex keyframe animations, or shimmer effects. The editor should feel calm and professional.

## 11. Visual Boundary with Studio

The World Editor content area sits where the SvelteFlow canvas normally appears. The transition from Studio's white/gray chrome to the warm editor palette is handled by:

1. The tab bar at the top provides the visual transition — it uses `bg-[#ece7de]` (warm secondary).
2. The editor content area uses `bg-[#f4f1ea]` (warm base).
3. The Studio sidebar remains unchanged (white/gray), providing contrast that naturally frames the warm editor area.
4. Blue primary actions and focus rings remain consistent with Studio.

This creates a "content island" effect — the editor feels distinct but not foreign within the Studio shell.
