之前的游戏设计偏向于galgame，现在新版游戏设计偏向于更像是对话界面的“视觉小说”
预期修改如下：
将CreativeWriting输出的格式改为
```typescript
{
    story:{
        idx: number // 从0开始，通过这个可以约束模型要生成多少段，并在思考时规划每几段需要讲什么
        type:string // "narrative" or "dialogue" 叙事文本或者是对白文本
        speaker_creature_id?:string|null // 如果是对白文本则需要说话者的creature_id，就和galgame一样，玩家也会说话
        content: string[] // 具体的内容
        emotion?: string // 情绪，九种情绪之一 
    },
    cg?:{
        creature_ids:string[] // 这个插画用到了哪些角色
        prompt:string //这个插画的生成提示词，需要描述各个角色的状态（穿的衣物，姿势）和环境以及正在做的事，里面所有的生物都必须使用creature_id而非角色名，比如 kuiyu 穿着一套办公室制服，正愤恨地撑在桌子上，狠狠地望着镜头。 然后具体的生成环节，我们会将各个creature id 替换为 【图一的角色】，这样的字样，使用edit模型来生成CG，来保证角色一致性
    } //如果此次生成需要cg图片，cg插画是以玩家视角的插画
    choice:{
       name:string
       description:string 
    }[] // 玩家可用的选项
}
```
然后具体的渲染上，我们将每次生成的结果称作一幕，总的来说，在渲染端，对话列表类似于下面这样的风格，经供参考。
然后需要将头像替换为具体的资源，另外还需要：点开头像后，要在旁边显示立绘和角色信息，类似于我们已经做好的CreaturePannel，但是我们需要重新造一个轮子，因为我们要实现更好的美感和样式。

<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>寂色锐影 - Wabi-sabi x P5 Style</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;900&display=swap');

        :root {
            --ws-bg: #e5e2d9;      /* 灰砂色 */
            --ws-text: #3d3d3d;    /* 炭灰色 */
            --ws-sage: #8b9a8b;    /* 苔藓绿 */
            --ws-clay: #b59a8d;    /* 陶土色 */
            --ws-stone: #a9a9a9;   /* 石板灰 */
            --ws-accent: #6b705c;  /* 冷杉绿 */
        }

        body {
            background-color: var(--ws-bg);
            font-family: 'Noto Serif SC', serif;
            color: var(--ws-text);
            overflow: hidden;
            height: 100vh;
            margin: 0;
            /* 噪点纹理 */
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
            background-blend-mode: overlay;
            opacity: 0.95;
        }

        .main-container {
            max-width: 850px;
            margin: 0 auto;
            height: 100vh;
            display: flex;
            flex-direction: column;
            padding: 20px;
            position: relative;
            z-index: 10;
        }

        .chat-messages {
            flex-grow: 1;
            overflow-y: auto;
            padding: 40px 10px;
            display: flex;
            flex-direction: column;
            gap: 45px;
            scrollbar-width: none;
        }

        .chat-messages::-webkit-scrollbar { display: none; }

        /* 消息基础结构 */
        .message {
            position: relative;
            display: flex;
            align-items: flex-end;
            max-width: 85%;
            animation: sharp-slide 0.5s cubic-bezier(0.23, 1, 0.32, 1);
        }

        @keyframes sharp-slide {
            0% { transform: translateX(-30px) skewX(5deg); opacity: 0; }
            100% { transform: translateX(0) skewX(0deg); opacity: 1; }
        }

        .message.left { flex-direction: row; align-self: flex-start; }
        .message.right { flex-direction: row-reverse; align-self: flex-end; }

        /* 正方形头像：带切角边框 */
        .avatar-container {
            position: relative;
            width: 70px;
            height: 70px;
            flex-shrink: 0;
            z-index: 30;
            background: var(--ws-text);
            clip-path: polygon(0 0, 100% 0, 100% 85%, 85% 100%, 0 100%);
            margin-bottom: -5px;
        }

        .message.left .avatar-container { margin-right: -10px; transform: rotate(-2deg); }
        .message.right .avatar-container { margin-left: -10px; transform: rotate(2deg); }

        .avatar-inner {
            position: absolute;
            inset: 3px;
            background: var(--ws-stone);
            clip-path: polygon(0 0, 100% 0, 100% 85%, 85% 100%, 0 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--ws-bg);
            font-size: 1.5rem;
            font-weight: 900;
        }

        /* 锐利对话框 */
        .bubble-wrapper {
            position: relative;
            filter: drop-shadow(4px 4px 0px rgba(0,0,0,0.1));
        }

        .bubble {
            background: #fff;
            padding: 20px 30px;
            font-size: 1.05rem;
            font-weight: 600;
            position: relative;
            /* P5风格锐利切角 */
            clip-path: polygon(2% 0%, 100% 3%, 98% 100%, 0% 95%);
            min-width: 180px;
            border: 1px solid rgba(0,0,0,0.05);
        }

        .message.left .bubble { color: var(--ws-text); }
        .message.right .bubble {
            background: var(--ws-clay);
            color: #fff;
            clip-path: polygon(0% 3%, 98% 0%, 100% 95%, 2% 100%);
        }

        /* 名字标签 */
        .name-tag {
            position: absolute;
            top: -20px;
            background: var(--ws-text);
            color: var(--ws-bg);
            padding: 2px 15px;
            font-size: 0.8rem;
            font-weight: 900;
            letter-spacing: 1px;
            z-index: 40;
            clip-path: polygon(5% 0, 100% 0, 95% 100%, 0% 100%);
        }

        .message.left .name-tag { left: 15px; transform: rotate(-1deg); }
        .message.right .name-tag { right: 15px; transform: rotate(1deg); background: var(--ws-sage); }

        /* 叙事消息：极简但锐利 */
        .narrative {
            width: 100%;
            margin: 20px 0;
            display: flex;
            justify-content: center;
            animation: narrative-sweep 0.6s ease-out;
        }

        @keyframes narrative-sweep {
            0% { transform: scaleX(0); opacity: 0; }
            100% { transform: scaleX(1); opacity: 1; }
        }

        .narrative-box {
            background: rgba(61, 61, 61, 0.05);
            border-left: 4px solid var(--ws-stone);
            padding: 10px 40px;
            font-size: 0.95rem;
            font-style: italic;
            color: var(--ws-text);
            clip-path: polygon(2% 0, 100% 0, 98% 100%, 0 100%);
        }

        /* 输入区域 */
        .input-area {
            padding: 30px;
            position: relative;
        }

        .input-container {
            background: #fff;
            padding: 5px;
            clip-path: polygon(0% 10%, 100% 0%, 99% 90%, 1% 100%);
            display: flex;
            align-items: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.05);
        }

        input {
            flex-grow: 1;
            background: transparent;
            border: none;
            padding: 12px 20px;
            font-size: 1rem;
            outline: none;
            color: var(--ws-text);
            font-family: inherit;
        }

        .send-btn {
            background: var(--ws-text);
            color: var(--ws-bg);
            border: none;
            padding: 10px 25px;
            font-weight: 900;
            cursor: pointer;
            clip-path: polygon(10% 0, 100% 0, 90% 100%, 0 100%);
            transition: all 0.2s;
        }

        .send-btn:hover {
            background: var(--ws-accent);
            transform: scale(1.05);
        }

        /* 装饰元素 */
        .deco-line {
            position: fixed;
            background: var(--ws-stone);
            height: 1px;
            width: 150vw;
            z-index: 0;
            opacity: 0.2;
            pointer-events: none;
        }
    </style>
</head>
<body>

    <div class="deco-line" style="top: 20%; left: -25%; transform: rotate(15deg);"></div>
    <div class="deco-line" style="bottom: 30%; left: -25%; transform: rotate(-10deg);"></div>
    
    <div class="main-container">
        <div id="chat-messages" class="chat-messages">
            <!-- 初始内容 -->
        </div>

        <div class="input-area">
            <div class="input-container">
                <input type="text" id="user-input" placeholder="于此地，留下你的残响..." autocomplete="off">
                <button id="send-btn" class="send-btn">刻印</button>
            </div>
        </div>
    </div>

    <script>
        const chatMessages = document.getElementById('chat-messages');
        const userInput = document.getElementById('user-input');
        const sendBtn = document.getElementById('send-btn');

        const characterData = {
            "守松": { color: "#6b705c", initial: "松" },
            "千岁": { color: "#b59a8d", initial: "千" },
            "你": { color: "#4a4e69", initial: "我" }
        };

        function createNarrative(text) {
            const div = document.createElement('div');
            div.className = 'narrative';
            div.innerHTML = `<div class="narrative-box">${text}</div>`;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function createMessage(text, side = 'right', name = '你') {
            const char = characterData[name] || { color: "#3d3d3d", initial: name[0] };
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${side}`;
            
            // 头像
            const avatar = document.createElement('div');
            avatar.className = 'avatar-container';
            avatar.innerHTML = `
                <div class="avatar-inner" style="background-color: ${char.color}">
                    <span>${char.initial}</span>
                </div>
            `;
            
            // 对话
            const wrapper = document.createElement('div');
            wrapper.className = 'bubble-wrapper';
            wrapper.innerHTML = `
                <div class="name-tag">${name}</div>
                <div class="bubble">
                    <span class="text"></span>
                </div>
            `;
            
            msgDiv.appendChild(avatar);
            msgDiv.appendChild(wrapper);
            chatMessages.appendChild(msgDiv);
            
            const textSpan = wrapper.querySelector('.text');
            let i = 0;
            const typeWriter = setInterval(() => {
                if (i < text.length) {
                    textSpan.textContent += text.charAt(i);
                    i++;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else {
                    clearInterval(typeWriter);
                }
            }, 30);
        }

        function handleSend() {
            const val = userInput.value.trim();
            if (!val) return;

            if (val.startsWith('/')) {
                createNarrative(val.substring(1));
            } else {
                createMessage(val, 'right', '你');
                
                // 模拟应答
                setTimeout(() => {
                    const responses = [
                        "虽是无心之言，却也有几分真意。",
                        "这便是你所见到的风景吗？",
                        "在那之后，我们就没再见过了。",
                        "寂静之中，似乎能听见心跳的声音。"
                    ];
                    createMessage(responses[Math.floor(Math.random()*responses.length)], 'left', '千岁');
                }, 1200);
            }
            userInput.value = '';
        }

        sendBtn.addEventListener('click', handleSend);
        userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSend(); });

        // 初始对话
        createNarrative("残阳如血，将一切的影子拉得很长。");
        setTimeout(() => createMessage("这种安静，反而让人觉得有些刺耳。", "left", "千岁"), 1000);
    </script>
</body>
</html>