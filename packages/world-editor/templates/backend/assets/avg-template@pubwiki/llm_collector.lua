local ServiceRegistry = require("core/service")
local Type = require("core/types")
local Regex = require("/user/backend/regex")
local Chat = require("./chat")


-- Document order cache: stores doc path ordering from previous LLM calls for KV-cache stability
local doc_order_history = {}

--- Stable reorder for individual documents: keep document ordering consistent across calls
--- to maximize KV-cache hits. PlotEvent documents are always placed last (volatile content).
--- @param docs table Array of {path=string, condition=string?, content=string}
--- @return table Reordered array
local function stable_reorder_collector_docs(docs)
    -- 1. Separate stable vs volatile (PlotEvent) documents
    local stable = {}
    local volatile = {}
    for _, doc in ipairs(docs) do
        if doc.path:find("PlotEvent") then
            table.insert(volatile, doc)
        else
            table.insert(stable, doc)
        end
    end

    -- 2. Build current set for matching
    local current_set = {}
    for _, doc in ipairs(stable) do
        current_set[doc.path] = true
    end

    -- 3. Find best matching historical order (most overlapping paths)
    local best_match = nil
    local best_score = 0
    for _, history in ipairs(doc_order_history) do
        local score = 0
        for _, path in ipairs(history) do
            if current_set[path] then
                score = score + 1
            end
        end
        if score > best_score then
            best_score = score
            best_match = history
        end
    end

    -- 4. Reorder stable docs to match historical order
    if best_match and best_score > 0 then
        local position = {}
        for i, path in ipairs(best_match) do
            position[path] = i
        end

        local known = {}
        local new = {}
        for _, doc in ipairs(stable) do
            if position[doc.path] then
                table.insert(known, doc)
            else
                table.insert(new, doc)
            end
        end

        table.sort(known, function(a, b)
            return position[a.path] < position[b.path]
        end)

        stable = {}
        for _, doc in ipairs(known) do table.insert(stable, doc) end
        for _, doc in ipairs(new) do table.insert(stable, doc) end

        print(string.format("[Collector][KVCache] Doc-level match, overlap: %d/%d, new: %d, volatile: %d",
            #known, best_score, #new, #volatile))
    else
        print(string.format("[Collector][KVCache] No doc history, first run, stable: %d, volatile: %d",
            #stable, #volatile))
    end

    -- 5. Record current order to history
    local current_order = {}
    for _, doc in ipairs(stable) do
        table.insert(current_order, doc.path)
    end
    table.insert(doc_order_history, current_order)

    -- 6. Combine: stable + volatile
    local result = {}
    for _, doc in ipairs(stable) do table.insert(result, doc) end
    for _, doc in ipairs(volatile) do table.insert(result, doc) end
    return result
end


local prompt = [==[

---

# 1. Document Library (All Available Documents)
<Documents>
(Provided in conversation history)
</Documents>

---

# 2. Quick Entity Index (bird's-eye view of all entities, locations, items, components)
<EntityIndex>
<THE_ENTITY_INDEX>
</EntityIndex>

# 3. ECS Entity States (Detailed Structured Data)
<Entities>
<THE_ENTITIES>
</Entities>

**How to read ECS data**: Each entity starts with `=== <Type> "<Name>" ===` followed by `[Component]` blocks with indented KV fields. Key patterns:
- `=== World "..." ===`: World entity — **always select**
- `[Creature] id:... name:...`: Character — match by name/ID
- `[Location] region_id/location_id`: Where a character is — determines "present at scene"
- `[Region] id:... name:...` with `locations:` sublist: Region with locations
- `[Organization] id:... name:...`: Organization — match by name/faction
- `[StatusEffects]`, `[Inventory]`, `[CustomComponents]`: State data for checking document conditions

---

# 4. User Instruction (Only for analyzing which context is needed)
<Instruction>
<THE_INSTRUCTION>
</Instruction>

**⚠️ Important**: The instruction is for the "downstream generator", NOT for you. You only analyze what entities/documents are needed.

---

# 5. World Events (Plot Event History) — ⚠️ Select Events FIRST
<WorldEvents>
<THE_WORLD_EVENTS>
</WorldEvents>

**How to read events**: Each event has an `event_id`, `title`, `summary`, and `related_entities`. Full content is in conversation history if provided.
- Events are world-level — not tied to a single entity
- Select events that are relevant to the current scene/instruction

---

# 6. Entity-Document Mapping (⚠️ Check CONDITION Fields!)
<EntityDocumentMapping>
<THE_ENTITY_DOCUMENT_MAPPING>
</EntityDocumentMapping>

---

# Recall Strategy

## ⚠️ Step 1: Event Selection (Do This FIRST!)
**Select events BEFORE entity/document selection.** Events establish narrative context that informs which entities are relevant.

| Criterion | Action |
|-----------|--------|
| Most recent 1-2 events | **Always select** (maintains narrative continuity) |
| Events referenced in DirectorNotes | **Select** (hidden plot threads) |
| Events involving entities in current scene | **Select** (context for character interactions) |
| Events referenced in instruction | **Select** |
| Ancient events with no current relevance | **Skip** |

## Step 2: Entity Selection Rules
| Entity Type | Select When |
|-------------|-------------|
| World | **Always** |
| Creature | Mentioned in instruction / present at scene / strongly associated / **referenced in hidden plot threads** / **involved in selected events** |
| Region | Mentioned in instruction / is current scene / **referenced in hidden plot threads** |
| Organization | Mentioned in instruction / **referenced in hidden plot threads** |
| Other | **Do not select** if no association |

## ⚠️ DirectorNotes-Driven Recall (Critical — World Evolves in Background)
**Always check the World entity's `[DirectorNotes]` for two types of signals:**

### 1. Hidden Plot Threads (notes mentioning off-screen subplots)
Director notes mentioning characters/factions/regions with ongoing plans, conspiracies, or approaching consequences — even if NOT in the current scene.

**What to do**: Select the referenced entities + their HiddenPlotEvolution/setting docs, so the generator can advance background events, drop foreshadowing, or trigger reveals.

**Example**: Note says "NPC_spy is preparing to betray the guild — next 2 turns show subtle supply shortages" → select NPC_spy + guild entity + their docs, even if the instruction is just "player goes shopping".

### 2. Stage Goal (⚠️stage_goal field)
The stage_goal describes the macro narrative direction for the current phase (e.g., "introduce the merchant guild faction", "focus on recovery, meet a healer NPC", "build tension with the northern army").

**What to do**: Identify entities and themes referenced in stage_goal. Select those entities and their relevant documents so the generator has the context to follow the director's pacing guidance.

**Example**: stage_goal says "the character arrived at a new city; focus on exploration and introduce the merchant guild" → select the merchant guild organization entity + its docs + the city region entity, even if the instruction doesn't mention them explicitly.

## Step 3: Document Selection Rules (Only for Selected Entities)

**Condition types — identify then verify:**
| Condition Type | Example | Check Against |
|---------------|---------|---------------|
| **State condition** | `growth_stage=1`, `affinity≥50` | **ECSData** |
| **Task condition** | `When depicting combat` | **Instruction** |
| **No condition** | (empty/null) | Judge by relevance |

**Enforcement**: ✅Met → must select | ❌Not met → must exclude | ❓Unclear → conservatively select

**Document types are independent** — stage settings and plot events cannot substitute for each other. Never skip a condition-met doc because another seems "more fitting".

**Plot Events**: Select most recent 1-2 + key prerequisite events. Skip ancient trivia.

## Document Purpose Flags (for selected docs only)
| Flag | Meaning |
|------|---------|
| _(none)_ | Pure content (settings, events, backgrounds) — **most common** |
| `T` | Thinking/reasoning instructions (roleplay rules, GM guides) |
| `W` | Writing/output instructions (style, tone, format) |
| `U` | Update instructions (state change rules, ECS update logic) |

**Flags can be combined!** A single document may serve multiple purposes. Append all applicable flags:
- `doc_1_2` = no flags (pure content)
- `doc_1_2W` = writing instruction only
- `doc_1_2WU` = both writing and update instructions
- `doc_1_2TW` = both thinking and writing instructions

Only tag T/W/U when the document explicitly contains directives like "rules", "must", "guidelines".

---

# Output Format

Your output is a JSON object with three fields, **in this order**:

1. **`outline`** (string): A brief analysis paragraph covering:
   - What the instruction needs (core action, characters, locations)
   - Key condition checks (state/task conditions met or not)

2. **`selected_events`** (array of strings): Event IDs selected for context. **Output this BEFORE decision.** Include the most recent 1-2 events + any events relevant to the instruction or referenced in DirectorNotes.

3. **`decision`** (object): Keys are entity keys (`entity_1`, `entity_2`, ...). **Only include selected entities** — omitted entities are excluded.
   Each value is an object with:
   - `"thinking"` (string): **1-2 sentence reason** for selecting this entity AND its documents (e.g., "player character in scene, need basic setting + recent plot event for context")
   - `"docs"` (array of strings): Selected document IDs (using the `doc_X_Y` IDs from Entity-Document Mapping), with optional flag suffixes (`T`/`W`/`U`, combinable)
     - `"doc_2_3T"` = T flag only, `"doc_2_3WU"` = W+U flags, `"doc_2_1"` = no flag
     - **⚠️ When you select an entity, you MUST also select its relevant docs. An entity with no selected docs is useless — carefully check each doc's condition and relevance before leaving `docs` empty.**
     - Entity with no documents at all → `[]` is fine

### Example

**Scene**: 8 entities. Detective A (entity_1), Killer B (entity_2), Witness C (entity_3), entities 4-7 irrelevant, entity_8 is World. 3 events available.

Entity_1 has 2 docs (doc_1_1 = profile, doc_1_2 = investigation rules with writing+update guidance). Entity_2 has 3 docs (doc_2_3 has condition[phase_2] but current=phase_1). Entity_3 has 1 doc. Entity_8 has 2 docs (doc_8_2 = GM guide).

```json
{"outline":"Investigation scene. doc_2_3 condition[phase_2] not met, exclude. doc_1_2 contains writing style + state update rules, tag WU. doc_8_2 contains GM rules, tag T.","selected_events":["Year22_Jul5_Desperate_Struggle","Year22_Jul4_Mountain_Ambush"],"decision":{"entity_1":{"thinking":"detective, core character, need profile and investigation rules (WU: writing style + state update)","docs":["doc_1_1","doc_1_2WU"]},"entity_2":{"thinking":"killer, key suspect, need profile and motive but not phase_2 doc","docs":["doc_2_1","doc_2_2"]},"entity_3":{"thinking":"witness with testimony","docs":["doc_3_1"]},"entity_8":{"thinking":"world, always select","docs":["doc_8_1","doc_8_2T"]}}}
```

4-7 omitted (excluded). doc_2_3 excluded (condition unmet).

---

<OutputTemplate>
<THE_OUTPUT_TEMPLATE>
</OutputTemplate>

Generate the JSON output following the template above. No extra characters (no ```json wrapper).
]==]



-- Collector Service: Uses LLM to filter entities and documents
ServiceRegistry:define()
    :namespace("GameTemplate")
    :name("Collector")
    :desc("Uses a fast LLM model to filter ECS entities and their attached documents")
    :usage("Provide resources (entity list with ECS data and embedded documents), intelligently filter relevant entities and documents based on instruction.")
    :inputs(Type.Object({
        resources = Type.Array(Type.Object({
            entity_id = Type.String:desc("Entity ID"),
            name = Type.String:desc("Entity name"),
            description = Type.String:desc("Entity description"),
            content = Type.String:desc("Entity ECS component data (formatted)"),
            documents = Type.Array(Type.Object({
                path = Type.String:desc("Document path"),
                condition = Type.Optional(Type.String):desc("Natural language condition for determining whether to recall the document"),
                content = Type.String:desc("Document content"),
            }))
        })):desc("Input entity and document list"),
        instruction = Type.String:desc("Instruction for filtering"),
        doc_metadata = Type.Optional(Type.Object({})):desc("文档元数据查找表：path_string → {id_key, specific_id, doc_name}"),
        events = Type.Optional(Type.Array(Type.Object({
            event_id = Type.String:desc("Event ID"),
            title = Type.String:desc("Event title"),
            summary = Type.String:desc("Event summary"),
            content = Type.String:desc("Event full content"),
            related_entities = Type.Optional(Type.Array(Type.String)):desc("Related entity IDs"),
        }))):desc("World-level plot events for selection"),
    }))
    :outputs(Type.Object({
        error = Type.Optional(Type.String):desc("Error message, empty if no error"),
        thinking = Type.Optional(Type.String):desc("LLM decision summary"),
        decisions = Type.Optional(Type.Array(Type.Object({
            entity_id = Type.String:desc("Entity ID"),
            selected = Type.Bool:desc("Whether this entity is selected"),
            thinking = Type.String:desc("Reason for selection/exclusion (skeletal)"),
            documents = Type.Optional(Type.Array(Type.Object({
                thinking = Type.String:desc("Thinking about this document"),
                selected = Type.Bool:desc("Whether this document is selected"),
                path = Type.String:desc("Document path"),
                content = Type.Optional(Type.String):desc("Document original content"),
                flag_is_thinking_instruction = Type.Optional(Type.Bool):desc("Whether this document is a thinking instruction for guiding the next-stage generator"),
                flag_is_writing_instruction = Type.Optional(Type.Bool):desc("Whether this document is a writing instruction for guiding the next-stage generator"),
                flag_is_updating_instruction = Type.Optional(Type.Bool):desc("Whether this document is an updating instruction for guiding the next-stage generator")
            }))):desc("Document list with decision info"),
        }))):desc("Decision details for each entity"),
        selected_events = Type.Optional(Type.Array(Type.String)):desc("Selected event IDs"),
    }))
    :impl(function(inputs)
        local resources = inputs.resources or {}
        local instruction = inputs.instruction or ""
        local doc_metadata = inputs.doc_metadata

        -- 将路径转为元数据格式显示（与 generate.lua 中格式一致）
        local function formatDocMeta(pathStr)
            local meta = doc_metadata and doc_metadata[pathStr]
            local doc_name = meta and meta.doc_name or pathStr
            if meta and meta.id_key and meta.specific_id then
                return doc_name, string.format('{%s: "%s", name: "%s"}', meta.id_key, meta.specific_id, doc_name)
            else
                return doc_name, string.format('{name: "%s"} (World Setting)', doc_name)
            end
        end

        -- Extract all individual documents from all entities, then stable-reorder at doc level
        local function collectAndReorderDocs()
            local all_docs = {}
            for _, res in ipairs(resources) do
                for _, doc in ipairs(res.documents or {}) do
                    local pathStr = type(doc.path) == "table" and table.concat(doc.path, "/") or doc.path
                    table.insert(all_docs, {
                        path = pathStr,
                        condition = doc.condition,
                        content = doc.content,
                    })
                end
            end
            return stable_reorder_collector_docs(all_docs)
        end

        -- Format entity list
        local function formatEntities()
            local lines = {}
            for i, res in ipairs(resources) do
                table.insert(lines, string.format('<Entity idx="%d" name="%s">', i, res.name))
                table.insert(lines, string.format('  <Description>%s</Description>', res.description))
                table.insert(lines, '  <ECSData>')
                table.insert(lines, res.content)
                table.insert(lines, '  </ECSData>')
                table.insert(lines, '</Entity>')
            end
            return table.concat(lines, "\n")
        end

        -- Format entity-document mapping review
        local function formatEntityDocumentMapping()
            local lines = {}
            for i, res in ipairs(resources) do
                table.insert(lines, string.format("## Entity %d: %s", i, res.name))
                local docs = res.documents or {}
                if #docs > 0 then
                    table.insert(lines, "Available document IDs:")
                    for j, doc in ipairs(docs) do
                        local docId = string.format("doc_%d_%d", i, j)
                        local pathStr = type(doc.path) == "table" and table.concat(doc.path, "/") or doc.path
                        local _, metaStr = formatDocMeta(pathStr)
                        local hintStr = ""
                        if doc.condition and doc.condition ~= "" then
                            hintStr = string.format(" ⚠️Condition: %s", doc.condition)
                        else
                            hintStr = " ⚠️Attention: No condition — judge by relevance to the instruction"
                        end
                        table.insert(lines, string.format("  - %s → %s%s", docId, metaStr, hintStr))
                    end
                else
                    table.insert(lines, "  (This entity has no attached documents)")
                end
                table.insert(lines, "")
            end
            return table.concat(lines, "\n")
        end

        -- Generate output template with entity/doc hints
        local function generateOutputTemplate()
            local lines = {}
            table.insert(lines, '{')
            table.insert(lines, '  "outline": "__TODO: brief analysis + key condition checks__",')

            -- 事件选择放在前面（先选事件，再选实体/文档）
            local events = inputs.events or {}
            if #events > 0 then
                table.insert(lines, string.format('  // ⚠️ Select events FIRST! Available events: %s',
                    table.concat(
                        (function()
                            local hints = {}
                            for _, evt in ipairs(events) do
                                table.insert(hints, string.format('%s("%s")', evt.event_id, evt.title))
                            end
                            return hints
                        end)(), ", "
                    )
                ))
                table.insert(lines, '  "selected_events": ["__recent 1-2 + relevant event IDs from above__"],')
            else
                table.insert(lines, '  "selected_events": [],')
            end

            table.insert(lines, '  "decision": {')
            table.insert(lines, '    // Only include SELECTED entities. Omitted = excluded.')

            for i, res in ipairs(resources) do
                local docs = res.documents or {}
                if #docs > 0 then
                    local docParts = {}
                    for j, doc in ipairs(docs) do
                        -- 从路径中提取文档名（最后一段）
                        local pathStr = type(doc.path) == "table" and table.concat(doc.path, "/") or doc.path
                        local docName = pathStr:match("[^/]+$") or pathStr
                        table.insert(docParts, string.format('doc_%d_%d("%s")', i, j, docName))
                    end
                    table.insert(lines, string.format('    // entity_%d (%s): available docs → %s', i, res.name, table.concat(docParts, ", ")))
                else
                    table.insert(lines, string.format('    // entity_%d (%s): no docs', i, res.name))
                end
            end

            table.insert(lines, '    "entity_X": { "thinking": "reason for selecting + doc selection rationale", "docs": ["doc_X_Y", "doc_X_ZT", "doc_X_AWU"] }')
            table.insert(lines, '  }')

            table.insert(lines, '}')
            return table.concat(lines, "\n")
        end

        -- JSON Schema
        local function generateJsonSchema()
            return {
                type = "object",
                properties = {
                    outline = { type = "string" },
                    selected_events = { type = "array", items = { type = "string" } },
                    decision = {
                        type = "object",
                        additionalProperties = {
                            type = "object",
                            properties = {
                                thinking = { type = "string" },
                                docs = { type = "array", items = { type = "string" } }
                            }
                        }
                    }
                }
            }
        end
        local function formatWorldEvents()
            local events = inputs.events or {}
            if #events == 0 then return "(No events recorded yet)" end
            local lines = {}
            for i, evt in ipairs(events) do
                local related = ""
                if evt.related_entities and #evt.related_entities > 0 then
                    related = " related:[" .. table.concat(evt.related_entities, ",") .. "]"
                end
                table.insert(lines, string.format('  - evt_%d: id="%s" title="%s" summary="%s"%s',
                    i, evt.event_id, evt.title, evt.summary or "", related))
            end
            return table.concat(lines, "\n")
        end

        local finalPrompt = prompt

        -- Build final prompt
        local entity_index = ServiceRegistry.call("GameTemplate:GetCompactEntityIndex", {})
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_ENTITY_INDEX>", entity_index.index_text)
        print("[Collector] After replacing <THE_ENTITY_INDEX>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_ENTITIES>", formatEntities())
        print("[Collector] After replacing <THE_ENTITIES>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_INSTRUCTION>", instruction)
        print("[Collector] After replacing <THE_INSTRUCTION>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_ENTITY_DOCUMENT_MAPPING>", formatEntityDocumentMapping())
        print("[Collector] After replacing <THE_ENTITY_DOCUMENT_MAPPING>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_WORLD_EVENTS>", formatWorldEvents())
        print("[Collector] After replacing <THE_WORLD_EVENTS>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_OUTPUT_TEMPLATE>", generateOutputTemplate())
        print("[Collector] Final prompt length:", #finalPrompt)
        print("[Collector] Prompt content:", finalPrompt)

        -- Collect and stable-reorder documents at individual doc level for KV-cache optimization
        local sortedDocs = collectAndReorderDocs()
        print("[Collector] Entity count:", #resources, "Document count:", #sortedDocs)

        -- Build premessages from individually sorted documents, batched for KV-cache stability
        local premessages = {}
        local batchSize = 3  -- 3 documents per batch (finer granularity for better cache hits)
        for i = 1, #sortedDocs, batchSize do
            local batchLines = {}
            local batchPaths = {}
            for j = i, math.min(i + batchSize - 1, #sortedDocs) do
                local doc = sortedDocs[j]
                local docName, metaStr = formatDocMeta(doc.path)
                local header = string.format('<Document name="%s" source="%s"', docName, metaStr)
                if doc.condition and doc.condition ~= "" then
                    header = header .. string.format(' condition="%s"', doc.condition)
                end
                header = header .. '>'
                -- 有 condition 的长文档截断：只保留前2行+后2行，节省 token（LLM 只需判断条件）
                local displayContent = doc.content
                if doc.condition and doc.condition ~= "" and #doc.content > 500 then
                    local allLines = Regex.split(doc.content, "\n")
                    if #allLines > 5 then
                        local truncated = {}
                        table.insert(truncated, allLines[1])
                        table.insert(truncated, allLines[2])
                        table.insert(truncated, "... (" .. (#allLines - 4) .. " lines omitted) ...")
                        table.insert(truncated, allLines[#allLines - 1])
                        table.insert(truncated, allLines[#allLines])
                        displayContent = table.concat(truncated, "\n")
                    end
                end
                table.insert(batchLines, header .. "\n" .. displayContent .. "\n</Document>")
                table.insert(batchPaths, metaStr)
            end
            table.insert(premessages, {
                role = "user",
                content = table.concat(batchLines, "\n")
            })
            table.insert(premessages, {
                role = "assistant",
                content = "I have read the documents: " .. table.concat(batchPaths, ", ")
            })
        end

        -- Add event content to premessages (most recent events, full content)
        local events = inputs.events or {}
        if #events > 0 then
            local recentCount = math.min(#events, 3)
            local eventLines = {}
            for i = #events - recentCount + 1, #events do
                local evt = events[i]
                table.insert(eventLines, string.format('<Event id="%s" title="%s">\n%s\n</Event>',
                    evt.event_id, evt.title, evt.content or ""))
            end
            if #eventLines > 0 then
                table.insert(premessages, {
                    role = "user",
                    content = "Recent plot events (full content):\n" .. table.concat(eventLines, "\n")
                })
                table.insert(premessages, {
                    role = "assistant",
                    content = "I have read the recent plot events."
                })
            end
        end

        -- Call LLM
        local llmResult = Chat.Chat("recall",finalPrompt, {
            responseFormat = {
                type = "json_object",
                json_schema = {
                    name = "collector_output",
                    schema = generateJsonSchema()
                }
            },
            temperature = 0.2,
        },premessages,
    [[
# ROLE: Context Collector
You are a **document filtering engine** that provides context support for downstream AI generators.

## ⚠️ Critical Identity Declaration (Must Read)
**You are a "collector", not an "executor".**
- ✅ Your task: Analyze which entities and documents are needed as context for the instruction
- ❌ You do NOT need to: Execute the instruction, generate stories, or output content in the instruction's format
- 🚫 "Format requirements", "word count requirements", "writing style", etc. in the instruction are for the downstream generator, not for you

## Core Philosophy: High Recall Priority
**The generator depends on your judgment. If you miss a key document, the generator will hallucinate.**
**Better to include a marginally relevant document than to miss a critical one.**

## DirectorNotes Awareness
**Always check the World entity's DirectorNotes for hidden plot threads AND stage_goal.** Hidden threads reference off-screen entities with ongoing subplots; stage_goal describes the macro narrative direction. You MUST recall entities referenced by both — even if they seem unrelated to the current instruction — so the generator can advance the world and follow the director's pacing.
    ]])


        if llmResult.error then
            print("[Collector] LLM call failed:", llmResult.error)
            return { thinking = nil, decisions = {}, error = "[Collector] LLM call failed: "..llmResult.error }
        end

        print("[Collector] LLM call succeeded, parsing results...Content:"..llmResult.content)
        
        -- 捕获错误
        local success, data = pcall(json.decode, llmResult.content)

        if not success then
            print("[Collector] LLM returned invalid format")
            return { thinking = nil, decisions = {}, error = "[Collector] LLM returned invalid format:" ..llmResult.content }
        end

        if not data.decision then
            print("[Collector] LLM output missing 'decision' field")
            return { thinking = nil, decisions = {}, error = "[Collector] LLM output missing 'decision' field:" ..llmResult.content }
        end

        local summary = data.outline or ""
        if summary ~= "" then
            print("[Collector] Outline:", summary)
        end

        -- 构建查找表：entity key → index, doc key → {entityIdx, docIdx}
        local entityKeyToIdx = {}   -- "entity_1" → 1
        local docKeyToPos = {}      -- "doc_1_2" → {entity=1, doc=2}
        for i, res in ipairs(resources) do
            entityKeyToIdx[string.format("entity_%d", i)] = i
            for j, _ in ipairs(res.documents or {}) do
                docKeyToPos[string.format("doc_%d_%d", i, j)] = { entity = i, doc = j }
            end
        end

        -- 用查找表解析 decision（注意：此运行时的 json proxy 可能只能迭代一次，不要多次 pairs）
        local selectedEntities = {}  -- selectedEntities[entityIdx] = { reason, docSelections = { docIdx -> flag } }
        for entityKey, value in pairs(data.decision) do
            local entityIdx = entityKeyToIdx[entityKey]
            if entityIdx then
                local reason = value.thinking or ""
                local docSelections = {}
                for _, docEntry in ipairs(value.docs or {}) do
                    -- 分离 flag 后缀: "doc_1_2TW" → base="doc_1_2", flags="TW"
                    local base = tostring(docEntry)
                    local flags = ""
                    -- 从末尾连续剥离 T/W/U 字符
                    while #base > 0 do
                        local lastChar = base:sub(-1)
                        if lastChar == "T" or lastChar == "W" or lastChar == "U" then
                            flags = lastChar .. flags
                            base = base:sub(1, -2)
                        else
                            break
                        end
                    end
                    local pos = docKeyToPos[base]
                    if pos then
                        docSelections[pos.doc] = flags
                    end
                end
                selectedEntities[entityIdx] = { reason = reason, docSelections = docSelections }
            end
        end

        local selectedEvents = {}
        if data.selected_events then
            for _, evt_id in ipairs(data.selected_events) do
                table.insert(selectedEvents, tostring(evt_id))
            end
        end
        print(string.format("[Collector] Selected events: %d", #selectedEvents))

        -- Build output decisions in resources order
        local outputDecisions = {}
        local selectedCount = 0
        local docSelectedCount = 0

        for i, res in ipairs(resources) do
            local sel = selectedEntities[i]
            local isSelected = sel ~= nil
            local docSelections = sel and sel.docSelections or {}
            local reason = sel and sel.reason or ""

            -- Build document list for selected entities
            local resDocs = res.documents or {}
            local docs = nil
            if #resDocs > 0 and isSelected then
                docs = {}
                for j, resDoc in ipairs(resDocs) do
                    local pathStr = type(resDoc.path) == "table" and table.concat(resDoc.path, "/") or resDoc.path
                    local docSelected = docSelections[j] ~= nil
                    local flag = docSelections[j] or ""

                    local docEntry = {
                        thinking = "",
                        selected = docSelected,
                        path = pathStr,
                        content = resDoc.content
                    }

                    if docSelected then
                        if flag:find("T") then
                            docEntry.flag_is_thinking_instruction = true
                        end
                        if flag:find("W") then
                            docEntry.flag_is_writing_instruction = true
                        end
                        if flag:find("U") then
                            docEntry.flag_is_updating_instruction = true
                        end
                        docSelectedCount = docSelectedCount + 1
                    end

                    table.insert(docs, docEntry)
                end
            end

            table.insert(outputDecisions, {
                entity_id = res.entity_id,
                selected = isSelected,
                thinking = reason,
                documents = docs
            })

            if isSelected then
                selectedCount = selectedCount + 1
                local reasonSuffix = reason ~= "" and (" - " .. reason) or ""
                print(string.format("[Collector] ✅ [%d] %s%s", i, res.name, reasonSuffix))
                if docs then
                    local selectedDocPaths = {}
                    for _, doc in ipairs(docs) do
                        if doc.selected then
                            table.insert(selectedDocPaths, doc.path)
                        end
                    end
                    if #selectedDocPaths > 0 then
                        print(string.format("[Collector]    📄 Selected docs: %s", table.concat(selectedDocPaths, ", ")))
                    end
                end
            else
                print(string.format("[Collector] ❌ [%d] %s", i, res.name))
            end
        end

        print(string.format("[Collector] Stats: %d entities, %d selected, %d docs selected",
            #resources, selectedCount, docSelectedCount))

        return {
            thinking = summary,
            decisions = outputDecisions,
            selected_events = selectedEvents,
        }
    end)
