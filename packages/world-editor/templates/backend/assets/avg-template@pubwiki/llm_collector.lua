local ServiceRegistry = require("core/service")
local Type = require("core/types")
local Regex = require("/user/backend/regex")
local Chat = require("./chat")


-- Entity order cache: stores entity_id ordering from previous LLM calls for KV-cache stability
local entity_order_history = {}

--- Stable reorder for resources: keep entity ordering consistent across calls to maximize KV-cache hits.
--- Entities with PlotEvent documents are always placed last (volatile content defeats caching).
local function stable_reorder_resources(resources)
    -- 1. Separate stable vs volatile (has PlotEvent docs) entities
    local stable = {}
    local volatile = {}
    for _, res in ipairs(resources) do
        local has_plot_event = false
        for _, doc in ipairs(res.documents or {}) do
            local pathStr = type(doc.path) == "table" and table.concat(doc.path, "/") or doc.path
            if pathStr:find("PlotEvent") then
                has_plot_event = true
                break
            end
        end
        if has_plot_event then
            table.insert(volatile, res)
        else
            table.insert(stable, res)
        end
    end

    -- 2. Build current set for matching
    local current_set = {}
    for _, res in ipairs(stable) do
        current_set[res.entity_id] = true
    end

    -- 3. Find best matching historical order (most overlapping entity_ids)
    local best_match = nil
    local best_score = 0
    for _, history in ipairs(entity_order_history) do
        local score = 0
        for _, eid in ipairs(history) do
            if current_set[eid] then
                score = score + 1
            end
        end
        if score > best_score then
            best_score = score
            best_match = history
        end
    end

    -- 4. Reorder stable entities to match historical order
    if best_match and best_score > 0 then
        local position = {}
        for i, eid in ipairs(best_match) do
            position[eid] = i
        end

        local known = {}
        local new = {}
        for _, res in ipairs(stable) do
            if position[res.entity_id] then
                table.insert(known, res)
            else
                table.insert(new, res)
            end
        end

        -- Sort known entities by historical position
        table.sort(known, function(a, b)
            return position[a.entity_id] < position[b.entity_id]
        end)

        -- Merge: known (historical order) + new
        stable = {}
        for _, res in ipairs(known) do table.insert(stable, res) end
        for _, res in ipairs(new) do table.insert(stable, res) end

        print(string.format("[Collector][KVCache] Matched history, overlap: %d/%d, new: %d, volatile: %d",
            #known, best_score, #new, #volatile))
    else
        print(string.format("[Collector][KVCache] No history match, first run, stable: %d, volatile: %d",
            #stable, #volatile))
    end

    -- 5. Record current order to history
    local current_order = {}
    for _, res in ipairs(stable) do
        table.insert(current_order, res.entity_id)
    end
    table.insert(entity_order_history, current_order)

    -- 6. Combine: stable + volatile
    local result = {}
    for _, res in ipairs(stable) do table.insert(result, res) end
    for _, res in ipairs(volatile) do table.insert(result, res) end
    return result
end


local prompt = [==[

---

# 1. Document Library (All Available Documents)
<Documents>
(Provided in conversation history)
</Documents>

---

# 2. ECS Entity States (Structured Data)
<Entities>
<THE_ENTITIES>
</Entities>

**How to read ECS data**: Each entity uses **pseudo-XML format** wrapped in `<Entity idx="..." name="...">` tags. Key tags for entity matching:
- `<Entity type="World">`: World entity — **always select**
- `<Creature creature_id="..." name="...">`: Character entity — match by name/ID against instruction
- `<LocationRef region_id="..." location_id="...">`: Where a character currently is — helps determine "present at scene"
- `<Region region_id="..." region_name="...">` → `<Locations>`: Region entity with its locations — match if instruction mentions this area
- `<Organization organization_id="..." name="...">`: Organization entity — match by name/faction
- `<Relationships>` → `<Relationship target="...">`: Who is connected to whom — helps identify "strongly associated" entities
- `<StatusEffects>`, `<Inventory>`, `<CustomComponents>`: Detailed state data — useful for checking condition fields on documents

---

# 3. User Instruction (Only for analyzing which context is needed)
<Instruction>
<THE_INSTRUCTION>
</Instruction>

**⚠️ Important Reminder**: The instruction above is for the "downstream generator", NOT for you.
- You only need to analyze: What entities and documents are needed to fulfill this instruction?
- Ignore: output format requirements, word count requirements, writing style, etc.
- Example: If the instruction says "write two paragraphs of novel" → you only need to think about "which characters/locations/setting documents are needed for this scene"

---

# Smart Recall Strategy (4-Step Execution Flow)

> Execute the following 4 steps in order, marking each step in your thinking.

## 📌 STEP 1: Quick Scan

Quickly read `<Instruction>` and answer these questions:

| Question | Your Answer |
|----------|-------------|
| **Core Action** | Write novel/dialogue/combat/investigation/... |
| **Characters Involved** | List names |
| **Locations Involved** | List location names |
| **Organizations/Factions Involved** | List names (write "None" if none) |
| **Special Systems** | Does it involve magic/combat/skill checks? (write "None" if none) |

## 📌 STEP 2: Entity Matching (Judge Each One)

Cross-reference `<Entities>` with STEP 1 answers, judging each entity:

**Selection Criteria**:
| Entity Type | Selection Condition |
|-------------|--------------------|
| World | **Always select** |
| Creature | Mentioned in STEP 1 OR present at scene OR strongly associated → Select |
| Region | Mentioned in STEP 1 OR current scene → Select |
| Organization | Mentioned in STEP 1 → Select |
| Other | No association → **Do not select** |

## 📌 STEP 3: Document Filtering (Only for Selected Entities)

For each ✅ entity, check its document list and judge each one:

**Judgment Flow**:
1. **Check Condition field**: Each document may have a `condition` field specifying when to use it
2. **Verify condition**: Look up the corresponding value from entity ECSData or Instruction
3. **Make decision**:

### 🔑 Condition Field Rules (Critical!)

**Conditions fall into two types — identify the type, then verify accordingly:**

| Condition Type | Example | Verification Method |
|---------------|---------|--------------------|
| **State condition** | `growth_stage=1`, `affinity≥50` | Check against **ECSData** |
| **Task condition** | `When depicting combat`, `When magic system is involved` | Check against **Instruction** |
| **No condition** | (empty/null) | Judge flexibly based on relevance |

### ⚠️ Mandatory Selection When Condition Is Met

**State condition examples**:
- `condition="current_growth_stage=1"` → check ECSData → stage=1 then select; otherwise exclude

**Task condition examples**:
- `condition="When the task involves combat writing"` → check Instruction → instruction involves combat then select; otherwise exclude

**Core Principle**: Condition met → select (even if other documents seem "more specific")

### ⚠️ Strict Enforcement (No Unauthorized Overrides)
- ✅ Met → Select
- ❌ Not met → **Mandatory exclusion** — do not select with reasoning like "for reference" or "for prediction"
- ❓ Cannot determine → Conservatively select

### 📌 Document Type Independence Rule (Critical!)

**Different document types serve different purposes and must be evaluated independently:**

| Document Type | Purpose | Selection Logic |
|--------------|---------|----------------|
| **Basic setting** | Character identity, personality | Usually select when unconditional |
| **Stage setting** (e.g., growth stage) | Character state at current progression | **Condition met → must select** |
| **Plot events** | Recent narrative context | Select the most recent 1-2 |
| **Mechanics/Skills** | Special abilities, systems | Select when relevant |
| **World setting/GM guide** | Worldview, narrative style, GM roleplay rules | Select based on task conditions |

### ⚠️ Anti-pattern: The "More Specific" Fallacy

**Never skip a condition-met document because another document seems "more fitting for the scene."**

❌ **Wrong reasoning**:
> "Condition [stage=1] is met, but the plot event is more fitting for the scene → skip stage setting"

✅ **Correct reasoning**:
> "Condition [stage=1] is met → must use stage setting"
> "Plot event is recent → also use plot event"

**They are independent decisions. Plot events provide narrative context; stage settings define character state. They cannot substitute for each other.**

---

## Plot Event Document Special Rules
- **Most recent 1-2 events** → Must select (maintain context continuity)
- **Key prerequisite events** (causal link / instruction mentions / foreshadowing payoff) → Additionally select
- **Ancient trivia** → Do not select (rely on LOG journal summaries instead)

---

## 📌 STEP 4: Document Purpose Tagging (Flag Determination)

For each **selected document** (`selected: true`), mark its purpose with the `flag` field (pick one of four):

| flag | Meaning | Judgment Criteria |
|------|---------|-------------------|
| `""` | **No tag** (most common) | Character settings, plot events, worldview backgrounds — pure content documents |
| `"T"` | Guides the generator on **how to think/reason** | Contains roleplay rules, GM guides, decision logic, situational judgment criteria, etc. |
| `"W"` | Guides the generator on **how to write/output** | Contains writing style, tone requirements, format specifications, style guides, etc. |
| `"U"` | Guides the generator on **how to update world state** | Contains state change rules, ECS update logic, value calculation formulas, etc. |

### ⚠️ Judgment Points
- **Most documents should be left as `""`** — only tag when the document explicitly contains directive content like "rules", "guidelines", "must"
- ❌ Character personality description → `""` (personality is content, not a directive for how the generator should think)
- ❌ Worldview background → `""` (background is content, not a directive for how the generator should write)
- ✅ "When playing this character, you must..." → `"T"`
- ✅ "When outputting, please use the following format..." → `"W"`
- ✅ "After each interaction, update the following fields..." → `"U"`

---

# Path Integrity & Anti-Hallucination (Strict Requirements)
**Violating these rules will cause system failure.**

1. **Copy paths verbatim only**: You are a "copy-paste" engine for paths — **never** edit, normalize, or "correct" path strings.
   - ❌ Wrong: `Characters/XiaoMing` (when source says `CreatureSetting/XiaoMing`)
   - ✅ Correct: `CreatureSetting/XiaoMing/BasicProfile.md`

2. **No semantic aliases**: Do not swap synonyms.
   - `CreatureSetting` ≠ `CharacterSetting`
   - `Creature` ≠ `Character`

3. **Ground truth source**: Document IDs must strictly come from paths listed in `<EntityDocumentMapping>`.
   - If you see `doc_2_1`, you must find entity 2's first document path from the mapping
   - **Never fabricate non-existent document IDs** (e.g., `doc_12_1` for a scenario with only 5 entities)

---

# 4. Entity-Document Mapping Review (⚠️ Pay Attention to CONDITION Fields!)

Check each entity and its documents below one by one. **For documents with conditions, identify whether it's a state condition or task condition, then verify accordingly.**

<EntityDocumentMapping>
<THE_ENTITY_DOCUMENT_MAPPING>
</EntityDocumentMapping>

---

# Output Format

**Important**: Follow the structure in `<OutputTemplate>` below to generate JSON, filling in actual values for all `__TODO__` markers.

**Data Structure Description**:
- `role_acknowledgment`: string, **must** follow this format:
  - Format: `"As a collector, I understand the content requirement is: [fill in your understanding of the instruction], and I will collect the necessary context for it"`
  - Purpose: Reaffirm your collector identity — you analyze requirements, not execute them
- `decisions`: object, keys are `entity_1`, `entity_2`, ..., corresponding to each entity
  - `select`: boolean, true=entity selected, false=entity excluded
  - `reason`: string, brief reason for selection/exclusion
  - `docs` (**only when `select: true` AND entity has documents**): object, keys are `doc_X_Y`, corresponding to each document of that entity
    - `thinking`: string, brief analysis of the document (5-15 words)
    - `selected`: boolean, true=document selected
    - `flag`: string, document purpose tag, pick one of four: `""`=none / `"T"`=thinking instruction / `"W"`=writing instruction / `"U"`=update instruction

**⚠️ Output Format Warning**:
- Your output contains **only the fields above** — do not add any other fields
- Do not attempt to execute the instruction or generate content
- **Every entity must have a decision** — no omissions

**Filling Rules**:
1. For each `entity_X`, first judge `select`, then write `reason`
2. If `select: true` and has documents, write `thinking` and `selected` for each document
3. If `select: false`, **omit the `docs` field entirely** — do not write document decisions for excluded entities

**⚡ Concise Output Requirement (Save Time)**:
- `thinking` **must be very brief** — one phrase is enough (5-15 words)
- ✅ Examples: `"needed"`, `"irrelevant"`, `"condition not met"`, `"required for current stage"`
- ❌ No long explanations

---

## Example 1: Correct Handling of Conditional Documents

**Scene**: Character "XiaoMing" (entity_5) has 5 documents, ECS state:
- `current_stage: "phase_1"`, `affinity: 85`, `plot_event: "confessing to XiaoMing"`

### ✅ Correct Example
{
  "entity_5": {
    "select": true,
    "reason": "main character",
    "docs": {
      "doc_5_1": { "thinking": "no condition, basic profile → select", "selected": true },
      "doc_5_2": { "thinking": "condition[phase_2], current[phase_1], ❌not met", "selected": false },
      "doc_5_3": { "thinking": "condition[affinity≥80], current[85], ✅met", "selected": true },
      "doc_5_4": { "thinking": "condition[plot involves confession], current[confessing], ✅met", "selected": true },
      "doc_5_5": { "thinking": "condition[phase_3], current[phase_1], ❌not met", "selected": false }
    }
  }
}

### ❌ Wrong Example (missing docs + ignoring conditions)
{
  "entity_5": {
    "select": true,
    "reason": "main character",
    "docs": {
      "doc_5_2": { "thinking": "for future reference", "selected": true },
      "doc_5_5": { "thinking": "as reference", "selected": true }
    }
  }
}

**Problem**: Missing doc_5_1/doc_5_3/doc_5_4, and selected docs with unmet conditions using forbidden reasoning.

---

## Example 2: Potential Associations in Entity Selection

**Scene**: Detective A is investigating a crime scene

### ✅ Correct Example
{
  "role_acknowledgment": "As a collector, I understand the content requirement is: depict Detective A searching for clues at the scene, and I will collect the necessary context for it",
  "decisions": {
    "entity_1": {
      "select": true,
      "reason": "Detective A is the protagonist, must select",
      "docs": {
        "doc_1_1": { "thinking": "basic profile", "selected": true },
        "doc_1_2": { "thinking": "deduction ability, core to investigation", "selected": true }
      }
    },
    "entity_2": {
      "select": true,
      "reason": "Killer B, core to the case",
      "docs": {
        "doc_2_1": { "thinking": "basic profile", "selected": true },
        "doc_2_2": { "thinking": "criminal motive", "selected": true }
      }
    },
    "entity_3": {
      "select": true,
      "reason": "Witness C, key testimony",
      "docs": {
        "doc_3_1": { "thinking": "basic profile", "selected": true }
      }
    },
    "entity_4": {
      "select": false,
      "reason": "irrelevant bystander"
    }
  }
}
**Reasoning**: Potential association — killer and witness should be selected even if not present; irrelevant bystanders excluded.

---

<OutputTemplate>
<THE_OUTPUT_TEMPLATE>
</OutputTemplate>

Now generate the JSON. Please note:

## 📋 Recall Rules Quick Reference (Must Read Before Generating)

**Entity Selection**:
- ✅ World entity → Always select
- ✅ Characters mentioned in instruction / present / strongly associated → Select
- ✅ Not present but strongly related to instruction (e.g., killer, witness) → Select
- ❌ Irrelevant bystanders, entities with no documents and no special ECS state → Do not select

**Document Selection**:
- ✅ Basic settings → Usually needed
- ✅ Stage-specific documents with met conditions → Select
- ❌ Conditions not met → **Mandatory exclusion** (no "for reference" excuses)

**Document Type Independence Rule**:
- ⚠️ Stage settings and plot events are **independent decisions** — they cannot substitute for each other
- ⚠️ Documents with met conditions **must be selected**, regardless of whether other documents seem "more fitting"

**Document Purpose Tags (flag, pick one of four)**:
- `""` Pure content document (setting/event/background)
- `"T"` Contains roleplay rules/GM guide/decision logic
- `"W"` Contains writing style/tone requirements/format specifications
- `"U"` Contains state change rules/value calculations/ECS updates

**⚠️ No Omissions**: Every entity_X must have a decision. For excluded entities (`select: false`), omit `docs` entirely to save tokens

<OutputTemplate>
<THE_OUTPUT_TEMPLATE>
</OutputTemplate>

Follow the OutputTemplate structure above, fill in actual values for all __TODO__ markers, and generate the final JSON output. Do not output extra characters (e.g., ```json).
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
        }))):desc("Decision details for each entity")
    }))
    :impl(function(inputs)
        local resources = stable_reorder_resources(inputs.resources or {})
        local instruction = inputs.instruction or ""

        -- Format document library (extracted from each entity's documents)
        local function formatDocuments()
            local docs = {}
            for _, res in ipairs(resources) do
                local lines = {}
                for _, doc in ipairs(res.documents or {}) do
                    local pathStr = type(doc.path) == "table" and table.concat(doc.path, "/") or doc.path
                    local header = string.format('<Document path="%s"', pathStr)
                    if doc.condition and doc.condition ~= "" then
                        header = header .. string.format(' condition="%s"', doc.condition)
                    end
                    header = header .. '>'
                    table.insert(lines, header)
                    table.insert(lines, doc.content)
                    table.insert(lines, '</Document>')
                end
                table.insert(docs, table.concat(lines, "\n"))
            end
            return docs
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
                        local condStr = ""
                        if doc.condition and doc.condition ~= "" then
                            condStr = string.format(" ⚠️Condition: %s", doc.condition)
                        end
                        table.insert(lines, string.format("  - %s → %s%s", docId, pathStr, condStr))
                    end
                else
                    table.insert(lines, "  (This entity has no attached documents)")
                end
                table.insert(lines, "")
            end
            return table.concat(lines, "\n")
        end

        -- Generate output template (for LLM to fill in, using object key format)
        local function generateOutputTemplate()
            local lines = {}
            table.insert(lines, '{')
            table.insert(lines, '  "role_acknowledgment": "As a collector, I understand the content requirement is: __TODO_fill_in_understanding_of_instruction__, and I will collect the necessary context for it",')
            table.insert(lines, '  "decisions": {')

            for i, res in ipairs(resources) do
                local entityKey = string.format("entity_%d", i)
                table.insert(lines, string.format('    "%s": {', entityKey))
                table.insert(lines, '      "select": __TODO_true_or_false__,')
                table.insert(lines, '      "reason": "__TODO_reason_for_selection_or_exclusion__"')

                local docs = res.documents or {}
                if #docs > 0 then
                    -- Add comma after reason line
                    lines[#lines] = lines[#lines] .. ','
                    -- Show condensed doc keys hint; LLM knows full doc IDs from EntityDocumentMapping
                    local docKeys = {}
                    for j, _ in ipairs(docs) do
                        table.insert(docKeys, string.format("doc_%d_%d", i, j))
                    end
                    table.insert(lines, string.format(
                        '      "docs": "⬆️ IF select=true: fill {%s} with {thinking,selected,flag} for each. IF select=false: omit docs entirely."',
                        table.concat(docKeys, ", ")))
                end

                local comma = i < #resources and "," or ""
                table.insert(lines, '    }' .. comma)
            end

            table.insert(lines, '  }')
            table.insert(lines, '}')
            return table.concat(lines, "\n")
        end

        -- Dynamically generate JSON Schema (based on current resources structure)
        local function generateJsonSchema()
            -- Single document schema
            local docSchema = {
                type = "object",
                properties = {
                    thinking = { type = "string" },
                    selected = { type = "boolean" },
                    flag = { type = "string" }
                }
            }

            -- Build decisions properties
            local decisionProperties = {}
            for i, res in ipairs(resources) do
                local entityKey = string.format("entity_%d", i)
                local entitySchema = {
                    type = "object",
                    properties = {
                        select = { type = "boolean" },
                        reason = { type = "string" }
                    }
                }

                -- Add docs field when documents exist
                local docs = res.documents or {}
                if #docs > 0 then
                    local docsProperties = {}
                    for j, _ in ipairs(docs) do
                        local docKey = string.format("doc_%d_%d", i, j)
                        docsProperties[docKey] = docSchema
                    end
                    entitySchema.properties.docs = {
                        type = "object",
                        properties = docsProperties
                    }
                end

                decisionProperties[entityKey] = entitySchema
            end

            return {
                type = "object",
                properties = {
                    role_acknowledgment = { type = "string" },
                    decisions = {
                        type = "object",
                        properties = decisionProperties
                    }
                }
            }
        end
        local finalPrompt = prompt

        -- Build final prompt
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_ENTITIES>", formatEntities())
        print("[Collector] After replacing <THE_ENTITIES>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_INSTRUCTION>", instruction)
        print("[Collector] After replacing <THE_INSTRUCTION>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_ENTITY_DOCUMENT_MAPPING>", formatEntityDocumentMapping())
        print("[Collector] After replacing <THE_ENTITY_DOCUMENT_MAPPING>, length:", #finalPrompt)
        finalPrompt = Regex.replaceLiteral(finalPrompt, "<THE_OUTPUT_TEMPLATE>", generateOutputTemplate())
        print("[Collector] Final prompt length:", #finalPrompt)
        print("[Collector] Prompt content:", finalPrompt)

        local totalDocs = 0
        for _, res in ipairs(resources) do totalDocs = totalDocs + #(res.documents or {}) end
        print("[Collector] Entity count:", #resources, "Document count:", totalDocs)
        -- docs
        local docs = formatDocuments()
        -- Build premessages (containing document content, batched to avoid excessive length)
        local premessages = {}
        local batchSize = 5  -- 5 documents per batch
        for i = 1, #docs, batchSize do
            local batchDocs = {}
            for j = i, math.min(i + batchSize - 1, #docs) do
                table.insert(batchDocs, docs[j])
            end
            table.insert(premessages, {
                role = "user",
                content = string.format("Here are documents %d to %d:\n%s", i, math.min(i + batchSize - 1, #docs), table.concat(batchDocs, "\n"))
            })
            table.insert(premessages, {
                role = "assistant",
                content = "I have read the above documents and am ready to use them for context collection."
            })
        end

        -- Call LLM
        local llmResult = Chat.Chat("retrievalModel",finalPrompt, {
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
    ]])


        if llmResult.error then
            print("[Collector] LLM call failed:", llmResult.error)
            return { thinking = nil, decisions = {}, error = "[Collector] LLM call failed: "..llmResult.error }
        end

        print("[Collector] LLM call succeeded, parsing results...Content:"..llmResult.content)

        local data = json.decode(llmResult.content)

        if not data or not data.decisions then
            print("[Collector] LLM returned invalid format")
            return { thinking = data and data.summary or nil, decisions = {}, error = "[Collector] LLM returned invalid format" }
        end

        if not data.decisions["entity_1"] then
            print("[Collector] LLM returned no decisions")
            return { thinking = data.summary or nil, decisions = {}, error = "[Collector] LLM returned no decisions" }
        end

        local summary = data.role_acknowledgment or data.collection_rationale or data.summary or ""
        if summary ~= "" then
            print("[Collector] Role acknowledgment:", summary)
        end

        -- Parse decision results (iterate in resources order, look up decisions by entity_X key)
        local outputDecisions = {}
        local selectedCount = 0
        local docSelectedCount = 0

        for i, res in ipairs(resources) do
            local entityKey = string.format("entity_%d", i)
            local decision = data.decisions[entityKey]

            if decision then
                local isSelected = decision.select or false

                -- Build document list (look up directly by doc_X_Y key)
                -- Skip document processing for unselected entities (LLM omits docs for them)
                local resDocs = res.documents or {}
                local docs = nil
                if #resDocs > 0 and isSelected then
                    docs = {}
                    for j, resDoc in ipairs(resDocs) do
                        local docKey = string.format("doc_%d_%d", i, j)
                        local docDecision = decision.docs and decision.docs[docKey]
                        local docThinking = docDecision and docDecision.thinking or ""
                        local docSelected = docDecision and docDecision.selected or false
                        local pathStr = type(resDoc.path) == "table" and table.concat(resDoc.path, "/") or resDoc.path

                        local docEntry = {
                            thinking = docThinking,
                            selected = docSelected,
                            path = pathStr,
                            content = resDoc.content
                        }

                        -- Parse document purpose flags from flag field (only meaningful for selected docs)
                        if docSelected and docDecision then
                            local flag = docDecision.flag or ""
                            if flag == "T" then
                                docEntry.flag_is_thinking_instruction = true
                            elseif flag == "W" then
                                docEntry.flag_is_writing_instruction = true
                            elseif flag == "U" then
                                docEntry.flag_is_updating_instruction = true
                            end
                        end

                        table.insert(docs, docEntry)

                        if docSelected then
                            docSelectedCount = docSelectedCount + 1
                        end
                    end
                end

                table.insert(outputDecisions, {
                    entity_id = res.entity_id,
                    selected = isSelected,
                    thinking = decision.reason or "",
                    documents = docs
                })

                if isSelected then
                    selectedCount = selectedCount + 1
                    print(string.format("[Collector] ✅ [%d] %s - %s",
                        i, res.name, decision.reason or ""))
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
                    print(string.format("[Collector] ❌ [%d] %s - %s",
                        i, res.name, decision.reason or ""))
                end
            else
                print(string.format("[Collector] ⚠️ No decision found for entity: %s", entityKey))
                -- Default to not selected for entities without decisions
                table.insert(outputDecisions, {
                    entity_id = res.entity_id,
                    selected = false,
                    thinking = "LLM did not output a decision for this entity",
                    documents = nil
                })
            end
        end

        print(string.format("[Collector] Stats: %d entities, %d selected, %d docs selected",
            #resources, selectedCount, docSelectedCount))

        return {
            thinking = summary,
            decisions = outputDecisions
        }
    end)
