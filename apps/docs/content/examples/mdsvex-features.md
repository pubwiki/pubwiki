---
title: MDsveX Features
description: Showcase of all mdsvex features supported in this documentation
order: 10
---

<script>
  import Callout from '$lib/components/Callout.svelte';
  
  let count = $state(0);
  
  function increment() {
    count++;
  }
</script>

# MDsveX Features Demo

This page demonstrates all the features available when writing documentation with mdsvex.

## Svelte Components in Markdown

You can import and use Svelte components directly in your markdown files:

<Callout type="info">
  This is an **info** callout. It supports <strong>HTML</strong> and *Markdown* inside!
</Callout>

<Callout type="warning">
  This is a **warning** callout. Use it to highlight important caveats.
</Callout>

<Callout type="error">
  This is an **error** callout. Use it for critical warnings or breaking changes.
</Callout>

<Callout type="tip">
  This is a **tip** callout. Perfect for best practices and pro tips!
</Callout>

## Interactive Components

MDsveX supports full Svelte reactivity. Here's an interactive counter:

<div class="my-4 p-4 border border-gray-200 rounded-lg bg-gray-50 not-prose">
  <p class="text-lg mb-2">Count: <strong class="text-blue-600">{count}</strong></p>
  <button 
    onclick={increment}
    class="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90 transition-opacity"
  >
    Increment
  </button>
</div>

## Code Highlighting

Code blocks are automatically highlighted with Shiki:

### JavaScript

```javascript
// Async function example
async function fetchData(url) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

// Using the function
const result = await fetchData('https://api.example.com/data');
console.log(result);
```

### TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

function greetUser(user: User): string {
  return `Hello, ${user.name}!`;
}
```

### Svelte

```svelte
<script lang="ts">
  let name = $state('World');
</script>

<h1>Hello {name}!</h1>

<input bind:value={name} />
```

### Lua

```lua
-- Define a character
local character = {
  name = "Hero",
  health = 100,
  attack = function(self, target)
    target.health = target.health - 10
    return self.name .. " attacks " .. target.name
  end
}

-- Use the character
local enemy = { name = "Dragon", health = 50 }
print(character:attack(enemy))
```

### Bash

```bash
# Clone the repository
git clone https://github.com/pubwiki/pubwiki.git
cd pubwiki

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

## Markdown Features

### Tables

| Feature | Supported | Notes |
|---------|-----------|-------|
| Tables | ✅ | Full GFM support |
| Code blocks | ✅ | Shiki highlighting |
| Svelte components | ✅ | Full reactivity |
| Frontmatter | ✅ | YAML format |

### Lists

#### Unordered Lists

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

#### Ordered Lists

1. First step
2. Second step
3. Third step

#### Task Lists

- [x] Create documentation site
- [x] Add mdsvex support
- [x] Implement code highlighting
- [ ] Add search functionality

### Blockquotes

> "The best way to predict the future is to invent it."
> 
> — Alan Kay

### Links and Images

Visit [Pub.Wiki](https://pub.wiki) to learn more.

### Inline Code

Use `$state()` for reactive state in Svelte 5.

### Emphasis

- *Italic text* or _italic text_
- **Bold text** or __bold text__
- ***Bold and italic*** or ___bold and italic___
- ~~Strikethrough~~

### Horizontal Rules

---

## Frontmatter Variables

You can access frontmatter in your content. This page has:

- **Title:** MDsveX Features
- **Description:** Showcase of all mdsvex features supported in this documentation

## Custom Styling

You can use Tailwind classes directly in your markdown:

<div class="grid grid-cols-2 gap-4 my-4 not-prose">
  <div class="p-4 bg-blue-100 rounded-lg border border-blue-200">
    <h4 class="font-bold text-blue-800">Blue Card</h4>
    <p class="text-blue-600">Custom styled card</p>
  </div>
  <div class="p-4 bg-green-100 rounded-lg border border-green-200">
    <h4 class="font-bold text-green-800">Green Card</h4>
    <p class="text-green-600">Another styled card</p>
  </div>
</div>

## Summary

MDsveX gives you the power of:

1. **Markdown** for easy content writing
2. **Svelte** for interactive components
3. **Frontmatter** for metadata
4. **Shiki** for beautiful code highlighting

Happy documenting! 🎉
