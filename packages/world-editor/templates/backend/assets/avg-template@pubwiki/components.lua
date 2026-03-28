-- components.lua
-- 数据类型定义（供 LLM 直接阅读作为提示 + 服务输入输出验证）。
--
-- 设计理念（Zod 风格自描述类型）：
--   - 类型携带描述：Type.Int:desc("当前生命值")
--   - 纯类型定义，不注册到 ECS

ComponentTypes = {}

-- ============ 可复用的子类型 ============

ComponentTypes.Attrs = Type.Record(Type.Or(Type.Int, Type.String)):desc("属性表，键为属性名，值为属性值(可以为数字、字符串)")

ComponentTypes.StatusEffectInstance = Type.Object({
	instance_id = Type.String:desc("状态效果实例唯一标识符"),
	display_name = Type.Optional(Type.String):desc("状态效果显示名称，用于在UI中展示"),
	remark = Type.Optional(Type.String):desc("状态备注，用于描述状态的来源、效果或持续条件等"),
	data = Type.Object({}):desc("状态效果数据，任意对象"),
	add_at = Type.Optional(Type.String):desc("添加时间，格式：YYYY年MM月DD日 HH:MM"),
	last_update_at = Type.Optional(Type.String):desc("最后更新时间，格式：YYYY年MM月DD日 HH:MM"),
})

ComponentTypes.Path = Type.Object({
	discovered = Type.Bool:desc("已发现"),
	to_region = Type.String:desc("目标地域ID"),
	to_location = Type.String:desc("目标地点ID"),
	description = Type.String:desc("路径描述"),
})

ComponentTypes.TerritoryRef = Type.Object({
	region_id = Type.String:desc("地域ID"),
	location_id = Type.String:desc("地点ID"),
})

-- ============ 通用输出类型 ============

ComponentTypes.BasicOutput = Type.Object({
	success = Type.Bool,
	entity_id = Type.Optional(Type.String),
	error = Type.Optional(Type.String),
})

ComponentTypes.SuccessOutput = Type.Object({
	success = Type.Bool,
	error = Type.Optional(Type.String),
})

ComponentTypes.ExistsOutput = Type.Object({
	success = Type.Bool,
	exists = Type.Bool,
	data = Type.Optional(Type.Any),
	error = Type.Optional(Type.String),
})

ComponentTypes.ItemQueryOutput = Type.Object({
	success = Type.Bool,
	has_item = Type.Bool,
	count = Type.Int,
	error = Type.Optional(Type.String),
})

ComponentTypes.AttrValueOutput = Type.Object({
	success = Type.Bool,
	value = Type.Optional(Type.Or(Type.Int, Type.String)),
	error = Type.Optional(Type.String),
})

ComponentTypes.LocationQueryOutput = Type.Object({
	success = Type.Bool,
	region_id = Type.Optional(Type.String),
	location_id = Type.Optional(Type.String),
	error = Type.Optional(Type.String),
})

-- ============ 实体数据类型 ============

ComponentTypes.Metadata = Type.Object({
	name = Type.String:desc("实体名称"),
	desc = Type.String:desc("实体描述"),
})

ComponentTypes.LogEntry = Type.Object({
	content = Type.String:desc("日志内容"),
	add_at = Type.String:desc("添加时间，格式：YYYY年MM月DD日 HH:MM"),
})

ComponentTypes.Log = Type.Object({
	entries = Type.Array(ComponentTypes.LogEntry):desc("日志条目列表"),
})

ComponentTypes.GameTime = Type.Object({
	year = Type.Int:desc("年"),
	month = Type.Int:desc("月"),
	day = Type.Int:desc("日"),
	hour = Type.Int:desc("小时"),
	minute = Type.Int:desc("分钟"),
})

ComponentTypes.DirectorNotes = Type.Object({
	notes = Type.Array(Type.String):desc("导演笔记列表，用于记录每次生成剧情后的简短总结和今后剧情走向的建议"),
	flags = Type.Record(Type.Object({
		id = Type.String:desc("标记ID"),
		value = Type.Bool:desc("标记状态"),
		remark = Type.Optional(Type.String):desc("标记备注"),
	})):desc("导演标记映射表，键为标记ID，值为标记对象"),
	stage_goal = Type.Optional(Type.String):desc("当前游戏阶段的叙事目标和节奏控制，供剧情生成参考"),
})

ComponentTypes.EventEntry = Type.Object({
	event_id = Type.String:desc("事件唯一标识，命名约定：YYYY_MM_DD_ShortDesc"),
	title = Type.String:desc("事件标题"),
	summary = Type.String:desc("事件摘要，简要描述事件的关键内容"),
	content = Type.String:desc("事件详细内容"),
	related_entities = Type.Optional(Type.Array(Type.String)):desc("相关实体ID列表"),
	created_at = Type.Optional(Type.String):desc("创建时间"),
	updated_at = Type.Optional(Type.String):desc("最后更新时间"),
})

ComponentTypes.Events = Type.Object({
	events = Type.Array(ComponentTypes.EventEntry):desc("剧情事件列表"),
})

ComponentTypes.Organization = Type.Object({
	organization_id = Type.String:desc("组织唯一标识符"),
	name = Type.String:desc("组织名称"),
	territories = Type.Array(ComponentTypes.TerritoryRef):desc("组织拥有的地块列表"),
	description = Type.String:desc("组织描述"),
})

ComponentTypes.LocationRef = Type.Object({
	region_id = Type.String:desc("所在地域ID"),
	location_id = Type.String:desc("所在地点ID"),
})

ComponentTypes.Location = Type.Object({
	id = Type.String:desc("地点ID"),
	name = Type.String:desc("地点名称"),
	description = Type.String:desc("地点描述"),
})

ComponentTypes.Region = Type.Object({
	region_id = Type.String:desc("地域ID"),
	region_name = Type.String:desc("地域名称"),
	description = Type.String:desc("地域描述"),
	locations = Type.Array(ComponentTypes.Location):desc("地点列表"),
	paths = Type.Array(ComponentTypes.Path):desc("可用路径"),
})

ComponentTypes.Creature = Type.Object({
	creature_id = Type.String:desc("生物唯一标识符"),
	name = Type.String:desc("生物名称"),
	appearance = Type.Object({
		body = Type.String:desc("身体，脸部等外貌描述"),
		clothing = Type.String:desc("服装描述"),
	}),
	gender = Type.Optional(Type.String):desc("性别描述，如男、女、其他"),
	race = Type.Optional(Type.String):desc("种族描述"),
	emotion = Type.Optional(Type.String):desc("当前情绪状态的描述"),
	organization_id = Type.Optional(Type.String):desc("所属组织ID"),
	titles = Type.Array(Type.String):desc("称号列表"),
	attrs = ComponentTypes.Attrs,
	known_infos = Type.Array(Type.String):desc("角色已知信息列表"),
	goal = Type.Optional(Type.String):desc("角色当前的目标或意图"),
})

ComponentTypes.SettingDoc = Type.Object({
	name = Type.String:desc("文档名称"),
	content = Type.String:desc("文档内容"),
	condition = Type.Optional(Type.String):desc("召回条件，满足条件才会被使用"),
	static_priority = Type.Optional(Type.Int):desc("静态优先级，数值越高越优先，提供此值则必定召回"),
	disable = Type.Optional(Type.Bool):desc("是否禁用此文档，禁用后永远不会被召回"),
})

ComponentTypes.BindSetting = Type.Object({
	documents = Type.Array(ComponentTypes.SettingDoc):desc("该实体的设定文档列表"),
})

ComponentTypes.StatusEffects = Type.Object({
	status_effects = Type.Array(ComponentTypes.StatusEffectInstance):desc("状态效果列表"),
})

ComponentTypes.CustomComponentRegistry = Type.Object({
	custom_components = Type.Array(Type.Object({
		component_key = Type.String:desc("组件的key"),
		component_name = Type.String:desc("组件和名字"),
		is_array = Type.Bool:desc("数据实例是否是数组"),
		data_registry = Type.Optional(Type.Array(Type.Object({
			item_id = Type.String:desc("注册项ID"),
			data = Type.Object({}):desc("注册项数据模板"),
		}))):desc("可选的数据实例可能值列表"),
		type_schema = Type.Optional(Type.Object({})):desc("组件数据类型的JSON Schema")
	})):desc("自定义组件定义列表"),
})

ComponentTypes.CustomComponents = Type.Object({
	custom_components = Type.Array(Type.Object({
		component_key = Type.String:desc("组件的key"),
		data = Type.Any:desc("组件数据实例，任意类型"),
	})):desc("自定义组件数据列表"),
})

ComponentTypes.Inventory = Type.Object({
	items = Type.Array(Type.Object({
		id = Type.String:desc("物品ID"),
		count = Type.Int:desc("物品数量"),
		name = Type.String:desc("物品名称"),
		description = Type.String:desc("物品描述"),
		details = Type.Array(Type.String):desc("物品详细说明列表"),
		equipped = Type.Optional(Type.Bool):desc("是否已装备"),
	})):desc("物品列表"),
})

ComponentTypes.IsPlayer = Type.Object({}):desc("玩家状态数据，永远为空")

ComponentTypes.Registry = Type.Object({
	creature_attr_fields = Type.Array(Type.Object({
		field_name = Type.String:desc("属性字段名(英文ID)"),
		hint = Type.String:desc("属性注解/显示名"),
		field_display_name = Type.Optional(Type.String):desc("属性在UI中的显示名称"),
	})):desc("生物属性字段定义列表"),
})

ComponentTypes.InteractionOption = Type.Object({
	id = Type.String:desc("交互选项唯一标识符"),
	title = Type.String:desc("交互选项标题，用于在UI中展示"),
	usage = Type.Optional(Type.String):desc("交互选项的使用说明"),
	instruction = Type.String:desc("交互选项的指令内容"),
	memo = Type.Optional(Type.String):desc("交互选项的备忘录，存储可变数据"),
})

ComponentTypes.Interaction = Type.Object({
	options = Type.Array(ComponentTypes.InteractionOption):desc("交互选项列表"),
})

ComponentTypes.BaseInteraction = Type.Object({
	creature_options = Type.Array(ComponentTypes.InteractionOption):desc("所有NPC生物实体默认拥有的基础交互选项（玩家角色除外）"),
	region_options = Type.Array(ComponentTypes.InteractionOption):desc("所有地域实体默认拥有的基础交互选项"),
	organization_options = Type.Array(ComponentTypes.InteractionOption):desc("所有组织实体默认拥有的基础交互选项"),
})

-- ============ 实体快照类型 ============

ComponentTypes.CreatureSnapshot = Type.Object({
	Creature = Type.Optional(ComponentTypes.Creature),
	LocationRef = Type.Optional(ComponentTypes.LocationRef),
	Inventory = Type.Optional(ComponentTypes.Inventory),
	StatusEffects = Type.Optional(ComponentTypes.StatusEffects),
	Log = Type.Optional(ComponentTypes.Log),
	IsPlayer = Type.Optional(ComponentTypes.IsPlayer),
	BindSetting = Type.Optional(ComponentTypes.BindSetting),
	CustomComponents = Type.Optional(ComponentTypes.CustomComponents),
	Interaction = Type.Optional(ComponentTypes.Interaction),
})

ComponentTypes.WorldSnapshot = Type.Object({
	GameTime = Type.Optional(ComponentTypes.GameTime),
	Registry = Type.Optional(ComponentTypes.Registry),
	DirectorNotes = Type.Optional(ComponentTypes.DirectorNotes),
	CustomComponentRegistry = Type.Optional(ComponentTypes.CustomComponentRegistry),
	Log = Type.Optional(ComponentTypes.Log),
	BindSetting = Type.Optional(ComponentTypes.BindSetting),
	Events = Type.Optional(ComponentTypes.Events),
	Interaction = Type.Optional(ComponentTypes.Interaction),
	BaseInteraction = Type.Optional(ComponentTypes.BaseInteraction),
})

ComponentTypes.RegionSnapshot = Type.Object({
	Metadata = Type.Optional(ComponentTypes.Metadata),
	Region = Type.Optional(ComponentTypes.Region),
	StatusEffects = Type.Optional(ComponentTypes.StatusEffects),
	Log = Type.Optional(ComponentTypes.Log),
	BindSetting = Type.Optional(ComponentTypes.BindSetting),
	Interaction = Type.Optional(ComponentTypes.Interaction),
})

ComponentTypes.OrganizationSnapshot = Type.Object({
	Organization = Type.Optional(ComponentTypes.Organization),
	Inventory = Type.Optional(ComponentTypes.Inventory),
	StatusEffects = Type.Optional(ComponentTypes.StatusEffects),
	Log = Type.Optional(ComponentTypes.Log),
	BindSetting = Type.Optional(ComponentTypes.BindSetting),
	Interaction = Type.Optional(ComponentTypes.Interaction),
})

-- ============ 查询输出类型 ============

ComponentTypes.PlayerEntityOutput = Type.Object({
	success = Type.Bool,
	found = Type.Bool,
	Creature = Type.Optional(ComponentTypes.Creature),
	LocationRef = Type.Optional(ComponentTypes.LocationRef),
	Inventory = Type.Optional(ComponentTypes.Inventory),
	StatusEffects = Type.Optional(ComponentTypes.StatusEffects),
	Log = Type.Optional(ComponentTypes.Log),
	IsPlayer = Type.Optional(ComponentTypes.IsPlayer),
	BindSetting = Type.Optional(ComponentTypes.BindSetting),
	CustomComponents = Type.Optional(ComponentTypes.CustomComponents),
	Interaction = Type.Optional(ComponentTypes.Interaction),
	error = Type.Optional(Type.String),
})

ComponentTypes.NPCEntitiesOutput = Type.Object({
	success = Type.Bool,
	entities = Type.Array(ComponentTypes.CreatureSnapshot),
	count = Type.Int,
	error = Type.Optional(Type.String),
})

ComponentTypes.WorldEntityOutput = Type.Object({
	success = Type.Bool,
	found = Type.Bool,
	GameTime = Type.Optional(ComponentTypes.GameTime),
	Registry = Type.Optional(ComponentTypes.Registry),
	DirectorNotes = Type.Optional(ComponentTypes.DirectorNotes),
	CustomComponentRegistry = Type.Optional(ComponentTypes.CustomComponentRegistry),
	Log = Type.Optional(ComponentTypes.Log),
	BindSetting = Type.Optional(ComponentTypes.BindSetting),
	Events = Type.Optional(ComponentTypes.Events),
	Interaction = Type.Optional(ComponentTypes.Interaction),
	error = Type.Optional(Type.String),
})

ComponentTypes.RegionEntitiesOutput = Type.Object({
	success = Type.Bool,
	regions = Type.Array(ComponentTypes.RegionSnapshot),
	count = Type.Int,
	error = Type.Optional(Type.String),
})

ComponentTypes.OrganizationEntitiesOutput = Type.Object({
	success = Type.Bool,
	organizations = Type.Array(ComponentTypes.OrganizationSnapshot),
	count = Type.Int,
	error = Type.Optional(Type.String),
})

ComponentTypes.AppInfo = Type.Object({
	publish_type = Type.Optional(Type.String):desc("发布类型，EDITOR|INK|TEST|CUSTOM, 不填则为EDITOR"),
})

-- ============ 开局选择类型 ============

ComponentTypes.GameInitChoiceItem = Type.Object({
	id = Type.String:desc("选项唯一标识符"),
	name = Type.String:desc("选项显示名称"),
	description = Type.String:desc("选项描述"),
	player_creature_id = Type.String:desc("选择后作为玩家角色的 creature_id"),
	exclude_creature_ids = Type.Optional(Type.Array(Type.String)):desc("选择后需要删除的角色 creature_id 列表"),
	exclude_region_ids = Type.Optional(Type.Array(Type.String)):desc("选择后需要删除的地域 region_id 列表"),
	exclude_organization_ids = Type.Optional(Type.Array(Type.String)):desc("选择后需要删除的组织 organization_id 列表"),
	background_story = Type.Optional(Type.String):desc("选择后覆盖的背景故事"),
	start_story = Type.Optional(Type.String):desc("选择后覆盖的开场故事"),
})

ComponentTypes.GameInitChoice = Type.Object({
	enable = Type.Bool:desc("是否启用开局选择，选择完成后自动置为 false"),
	choices = Type.Array(ComponentTypes.GameInitChoiceItem):desc("可选的开局角色/路线列表"),
})

-- ============ 存档数据类型 ============

ComponentTypes.StateDataType = Type.Object({
	World = ComponentTypes.WorldSnapshot:desc("世界实体快照"),
	Creatures = Type.Array(ComponentTypes.CreatureSnapshot):desc("所有角色实体"),
	Regions = Type.Array(ComponentTypes.RegionSnapshot):desc("所有地域实体"),
	Organizations = Type.Array(ComponentTypes.OrganizationSnapshot):desc("所有组织实体"),
	StoryHistory = Type.Optional(Type.Array(Type.Object({
		turn_id = Type.String:desc("回合ID"),
		checkpoint_id = Type.String:desc("存档ID"),
		story = Type.Any:desc("剧情历史内容"),
	}))):desc("剧情历史记录列表"),
	GameInitialStory = Type.Optional(Type.Object({
		background = Type.String:desc("玩家视角，看到的背景故事介绍"),
		start_story = Type.String:desc("游戏开始时的故事片段"),
	})):desc("游戏初始故事背景"),
	GameInitChoice = Type.Optional(ComponentTypes.GameInitChoice):desc("开局角色/路线选择配置"),
	SystemPrompts = Type.Optional(Type.Array(Type.Object({
		id = Type.String:desc("提示词ID"),
		content = Type.String:desc("提示词内容"),
	}))):desc("系统提示词"),
	GameWikiEntry = Type.Optional(Type.Array(Type.Object({
		title = Type.String:desc("词条标题"),
		content = Type.String:desc("词条内容"),
	}))):desc("游戏内置维基词条列表"),
	AppInfo = Type.Optional(ComponentTypes.AppInfo):desc("独立应用信息"),
})

return ComponentTypes
