# AI Integration Guide

A guide for building your own frontend on top of our AI narrative engine. Covers creative content generation, world state updates, save/load, and story history — everything you need to build a custom AI-driven interactive fiction experience.

At a high level, the whole system is a loop:

```
Player action → CreativeWriting (AI writes the story) → UpdateGameStateAndDocs (world state catches up) → Save → Wait for next action
```

That's it. Four services, one loop. Your job as a frontend developer is to wire these together and present the results to the player. The engine handles all the hard parts — RAG retrieval, prompt engineering, state extraction, ECS updates — you just call the services and render what comes back.

Cool? Cool.

---

## The Core Loop

Here's how a single turn plays out, end to end. We'll go into detail on each service later, but it helps to see the full picture first.

**Phase 1: Build the request.** The player picks a choice or types something. You package that into a `create_request` string, along with some context about recent story events and what output format you want.

**Phase 2: Call CreativeWriting.** This is the big one — it streams back AI-generated narrative content. You'll get partial results as they arrive (great for typewriter effects), and when it's done you get the full package: story text, player choices, state change recommendations, director notes, the works.

**Phase 3: Call UpdateGameStateAndDocs.** Take the output from Phase 2 and feed it to the state updater. A second AI (the "Analyzer") reads the story independently, figures out everything that changed in the world (characters moved, items used, time passed, relationships shifted), and executes the corresponding ECS service calls. This is where the world actually changes.

**Phase 4: Save and record.** Create a checkpoint (snapshot of the entire world state), then write the turn's narrative data to StoryHistory. These two systems are separate on purpose — checkpoints are for rollback, history is for replay.

**Phase 5: Show choices, wait.** Display the AI-generated options (or a free input box) and wait for the player. Then loop back to Phase 1.

That's the rhythm. Every turn follows this pattern. Now let's look at each piece.

---

## CreativeWriting — The Story Generator

This is the heart of the system. You give it a creative request, and it streams back structured narrative content. Internally it handles RAG document retrieval and LLM generation — you don't need to worry about any of that.

### What you send in

```typescript
{
  // What happened? What should the AI write about?
  // Include the player's action, writing style guidance, and any structural requirements.
  create_request: string

  // How should the AI think before writing?
  // Things like: "Check director notes for pacing, verify world consistency,
  // consider whether to introduce new elements."
  thinking_instruction: string

  // Recent story content (last 1-2 turns) so the AI has continuity.
  previous_content_overview: string

  // The shape of the creative content you want back, as a TypeScript interface string.
  // This ONLY describes your custom content (the "step_2" output).
  // Example: "{ novel_content: string; chapter_hint: string; player_choices: Array<{name: string}> }"
  // The engine wraps this in its own larger schema (thinking, state changes, director notes)
  // automatically — you don't include those.
  output_content_schema: string

  // Optional: a JSON Schema object for strict validation of the above.
  output_content_schema_definition?: object

  // Optional: an example of what step_1_thinking_result should look like.
  thinking_example?: string

  // Optional: reuse last RAG results (useful for retries — skip the collector phase).
  reuse_last_collect?: boolean

  // Optional: content-only mode. Only outputs thinking + creative content,
  // skips state change recommendations and director notes. Saves tokens.
  skip_state_updates?: boolean

  // Required: your callback function for receiving streaming events.
  callback: (event: StreamEvent) => void
}
```

The key insight here is that `output_content_schema` only describes *your* creative content format. The engine automatically wraps it in a larger 4-step schema (thinking → content → state recommendations → director notes). You define the shape of step 2; the engine handles the rest.

### What comes back (streaming)

The callback fires in this order:

1. **`collector_result_update`** — RAG retrieval is done. You know which setting documents were selected. This is mostly useful for debugging/transparency; you can skip rendering it if you want.

2. **`reasoning_update`** — The LLM is thinking (may fire multiple times). Again, optional to display, but some users like seeing the AI's reasoning process.

3. **`result_update`** — Streaming content arrives as partial JSON (may fire many times). This is where you do your typewriter rendering. The `content` field will progressively fill in as the AI writes. You'll want a partial JSON parser for this — the output is valid-ish JSON at each step, but fields may be undefined or incomplete.

4. **`done`** — Generation complete. Here's everything:

```typescript
{
  thinking?: string          // The AI's deep thinking process
  content?: any              // YOUR creative content (matches output_content_schema)

  // These four go straight to UpdateGameStateAndDocs:
  setting_changes?: Array<{ option, doc_name, suggestion, creature_id?, ... }>
  event_changes?: Array<{ option, event_id, title?, summary, suggestion, ... }>
  new_entities?: Array<{ type, name, description }>
  director_notes?: { notes: string[], flags: Array<{id, value, remark?}>, stage_goal?: string }

  // Also pass this to UpdateGameStateAndDocs:
  updater_messages?: Array<{ role: string, content: string }>

  // Metadata:
  collector_results?: any[]
  collector_outline?: string
  reasoning?: string
}
```

5. **`error`** — Something went wrong. You get an error string.

### How the prompt works (the interesting part)

You don't need to understand this to use the service, but it helps to know what's happening under the hood so you can write better `create_request` and `thinking_instruction` prompts.

The AI is guided through a 4-step pipeline in a single generation:

**Step 1 — Think first.** Before writing anything, the AI reviews director notes (pacing goals, flags, hidden plot threads), checks ECS world state for consistency, and plans whether to introduce new elements. This is your `thinking_instruction` at work.

**Step 2 — Write the story.** The AI generates content matching your `output_content_schema`. This is the novel text, dialogue, choices — whatever you asked for.

**Step 3 — Recommend state changes.** Three sub-outputs:
- **3a: Setting docs** — Permanent world rules, combat techniques, character profiles. Used sparingly.
- **3b: Events** — Plot events, location history, world situations. The primary record of "what happened."
- **3c: New entities** — Characters, regions, or organizations introduced in the narrative that should be tracked.

**Step 4 — Director notes.** The AI's "note to self" for future turns:
- **notes** — Rolling short-term memory (expires after ~10 turns). Hidden plot threads, foreshadowing plans.
- **flags** — Permanent milestone markers. "first_kill=true" means never re-trigger that event.
- **stage_goal** — Phase-level narrative direction. "The character just lost everything; next few turns should focus on recovery and rebuilding hope." This persists until explicitly replaced.

A few design principles baked into the prompt that are worth knowing:

- **The world is bigger than the data.** The AI is explicitly told that ECS entities are just "the recorded portion" of a vast world. It's encouraged to create new characters, locations, and organizations when the narrative calls for it — not just recycle existing ones.
- **Language auto-detection.** The AI detects the language from ECS data and previous content, then outputs everything in that language. Your prompt instructions can be in English even if the game is in Chinese.
- **Show, don't tell.** Game stats are never exposed in prose. Low stamina becomes "heavy breathing and trembling legs," not "stamina decreased by 20."
- **Director notes drive pacing.** The `stage_goal` acts as a macro compass. Flags prevent contradictions (you can't un-kill someone). Notes keep hidden plot threads alive across turns.

---

## UpdateGameStateAndDocs — The World Updater

After CreativeWriting generates the story, the world needs to catch up. That's this service's job.

Here's the thing that makes this service interesting: it doesn't just translate CreativeWriting's recommendations into ECS calls. It runs a **second AI** (the "Game State Analyzer") that independently reads the story and extracts *all* state changes — because the creative writer typically misses 30-50% of them.

Think about it: the creative writer says "she drank the healing potion and stood up, feeling much better." The writer might recommend adding a "healed" status, but forget to remove the potion from inventory, forget to remove the "injured" status, and forget to advance the game clock. The Analyzer catches all of that.

### What you send in

```typescript
{
  // The full narrative text (player action + AI-generated story).
  new_event: string

  // Everything below comes directly from CreativeWriting's "done" event.
  // Just pass them through.
  setting_changes?: any[]
  event_changes?: any[]
  new_entities?: any[]
  director_notes?: any
  collector_built_messages?: Array<{ role: string, content: string }>  // from updater_messages
}
```

Basically: take what CreativeWriting gave you and forward it. The `new_event` is the narrative text that the player and AI produced this turn.

### What you get back

```typescript
{
  success: boolean
  audit?: string     // The Analyzer's full reasoning (what it found, what it's doing about it)
  outline?: string   // Short summary of affected entities and operations
  summary?: string   // Player-friendly description of what changed (in narrative language)
  calls?: Array<{ service: string, args: any }>       // What ECS calls were made
  results?: Array<{ service: string, success?: boolean, error?: string }>  // Results of each call
  error?: string
}
```

The `summary` is the most useful field for your UI — it's a human-readable description of state changes written in narrative language, not technical jargon. The `audit` and `calls` are great for debug views or power users who want to see exactly what happened under the hood.

### What the Analyzer actually does

The Analyzer prompt gives the AI these responsibilities (in rough priority order):

1. **Independent story scan.** Read the story top to bottom. Extract every state change: movement, combat outcomes, item usage, emotion shifts, relationship changes, time passage. Don't trust the creative writer's hints — they're a starting point, not a checklist.

2. **Stale status cleanup.** This is the Analyzer's most critical fallback duty. It scans every entity's StatusEffects and asks: "Does this still make sense?" If a character has "severely exhausted" but the story shows them fighting at full strength — remove it. The creative writer almost never suggests removals for recovery scenarios.

3. **Item consumption tracking.** The story says "fired three arrows at the wolf." The creative writer forgot to suggest removing arrows from inventory. The Analyzer cross-references the story against each character's actual inventory and catches these.

4. **Time advancement.** Stories almost always imply time passing ("they traveled for hours," "by the time they reached the inn"), but the creative writer rarely remembers to suggest advancing the game clock. The Analyzer estimates duration from context and calls `advanceTime`.

5. **Prerequisite resolution.** The creative writer says "move character to the abandoned temple" but that location doesn't exist in any region yet. The Analyzer creates it first, then moves the character. Same for missing entities, undiscovered paths between regions, etc.

6. **Detail enrichment.** If the story describes an item or character appearance in richer detail than what's currently stored, the Analyzer updates the stored description. This ensures future turns see the enriched version, not the original sparse one.

The key mental model: the creative writer is an artist, the Analyzer is an accountant. The artist paints the scene; the accountant makes sure the books balance.

---

## Save & Load — Checkpoints

Checkpoints snapshot the entire ECS world state. They're your undo system.

```typescript
// Create a checkpoint. Returns a checkpointId you'll need later.
createSave({ title?: string, description?: string })
  → { success, checkpointId?, error? }

// Restore the world to a checkpoint. Everything resets to that moment.
loadSave(checkpointId)
  → { success, error? }

// List all checkpoints.
listSaves()
  → { success, saves?: Array<{ checkpointId, title?, description?, createdAt? }> }

// Delete a checkpoint.
deleteSave(checkpointId)
  → { success, error? }
```

The typical save flow is simple: after UpdateGameStateAndDocs succeeds, call `createSave()`, take the `checkpointId`, and stash it in StoryHistory alongside this turn's data.

One important thing to understand: `loadSave` only restores ECS state. It doesn't touch StoryHistory. It doesn't rebuild your UI. It just rewinds the world. You're responsible for figuring out what that means for your frontend — which turns to show, which choices to present, etc.

---

## StoryHistory — The Narrative Record

StoryHistory and checkpoints serve different purposes:

- **Checkpoints** = what the world looks like (ECS state snapshot)
- **StoryHistory** = what happened in the story (narrative content, player choices, AI reasoning)

They're linked by `checkpoint_id`, but they're separate systems. This is intentional — you might want to show story history without loading a checkpoint, or load a checkpoint without replaying every turn.

```typescript
// Write one turn's data.
setNewStoryHistory({
  turn_id: "turn-1",         // Sequential turn identifier
  data: {
    content: { ... },        // Whatever you want. Fully custom. Engine doesn't care about the shape.
    checkpoint_id?: "abc123" // Link to the checkpoint for this turn
  }
})

// Read everything.
getStoryHistory()
  → {
    success,
    data?: {
      turn_ids?: ["turn-1", "turn-2", ...],   // Ordered
      story?: { "turn-1": { content, checkpoint_id? }, ... }
    }
  }

// Nuke it all.
clearStoryHistory()
  → { success, error? }
```

The `content` field is completely yours. The engine stores and retrieves it, nothing more. You decide what goes in there. For reference, our INK game stores something like this per turn:

```typescript
{
  player?: {
    id: number
    playerAction: string
    selectedChoice?: { name: string, description: string }
    isCustomInput?: boolean
  }
  oocInstructions?: Array<{ content: string, duration: number | null }>
  story: {
    id: number
    content: string             // Part 1 narrative
    contentPart2?: string       // Part 2 narrative
    chapterHint?: string        // Chapter title
    reasoning?: string          // AI reasoning
    thinking?: string           // AI deep thinking
    playerChoices?: Array<{ name: string, description: string, is_special?: boolean }>
    directorNotes?: object
    checkpointId?: string
    updateGameStateResult?: object
  }
}
```

But that's just our implementation. Your game might need totally different data. Store whatever makes sense for your replay and rollback needs.

---

## Rollback — Time Travel

Rollback is just: load an old checkpoint + truncate your history. That's all there is to it.

1. Player picks a checkpoint to rewind to (maybe from a timeline UI, maybe from a save list)
2. Call `loadSave(checkpointId)` — the ECS world snaps back to that moment
3. Call `getStoryHistory()` — you get the full history
4. Find which `turn_id` corresponds to that checkpoint
5. In your frontend, drop everything after that turn
6. Rebuild your UI from the truncated history
7. Player continues from there — it's a new branch

The key thing to remember: `loadSave` handles the world state, but StoryHistory doesn't auto-truncate. You manage the history yourself in your frontend. This gives you flexibility — maybe you want to keep the "erased" turns visible but grayed out, or maybe you want to show a branching timeline. Up to you.

---

## Building Your Own Frontend

If you're starting from scratch, here's what you actually need to build, in rough priority order:

### Must have

- **CreativeWriting caller** — Build the request params, handle streaming callbacks, parse partial JSON as it arrives. This is the most complex piece because of the streaming. You'll want a partial JSON parser (or use something like `openai-partial-json-parser`).
- **UpdateGameStateAndDocs caller** — Simpler. Take CreativeWriting's done output, forward the relevant fields, wait for the response. Maybe show a loading indicator while it runs.
- **Narrative renderer** — Display the streaming story text. A typewriter effect is highly recommended — it turns "waiting for AI" into "watching the story unfold." Without it the text just pops in all at once, which feels worse even though it's technically faster.
- **Choice / input UI** — Show the AI-generated choices and/or a free text input. This is what keeps the game loop going.
- **Save management** — Call `createSave` after each successful state update. Support listing and loading saves. This is your safety net.
- **StoryHistory management** — Write history after each turn. Read it back when loading saves. This is what lets you reconstruct the narrative after a reload.
- **World data refresh** — After state updates, re-query ECS data (player entity, NPCs, inventory, locations) so your UI reflects the current world.

### Nice to have

- **Timeline UI** — Visualize save points as a branching tree. Click to rollback. Our INK game has one; it's a great UX feature.
- **Collector / RAG display** — Show which documents were retrieved. Useful for debugging and transparency.
- **State update audit view** — Show the Analyzer's `audit` and `calls`. Power users love seeing exactly what changed and why.
- **Director notes display** — Show the AI's thinking, flags, and stage goals. Fascinating for advanced users; safely ignorable for casual players.
- **OOC instructions** — Let the player act as "director" and give meta-level instructions that influence the AI's creative direction ("more action scenes," "introduce a romance subplot"). These get injected into the `create_request` prompt.

And that's it. Four services, one loop, your own UI on top. The engine does the heavy lifting; you bring the experience. Have fun building.
