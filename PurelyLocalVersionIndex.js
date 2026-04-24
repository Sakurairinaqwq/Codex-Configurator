#!/usr/bin/env node
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

function updateTomlConfig(currentContent, baseUrl, selectedModels, enableNotify, notifyCmd) {
    let text = currentContent || "";
    const setKey = (k, v) => {
        const regex = new RegExp(`^${k}\\s*=.*$`, "m");
        if (regex.test(text)) {
            text = text.replace(regex, `${k} = ${v}`);
        } else {
            text = `${k} = ${v}\n` + text;
        }
    };
    
    setKey("model_provider", '"custom"');
    
    // 根据单选或多选动态生成 TOML 语法
    const modelValue = selectedModels.length > 1 ? JSON.stringify(selectedModels) : `"${selectedModels[0]}"`;
    setKey("model", modelValue);
    
    setKey("model_reasoning_effort", '"xhigh"');
    setKey("disable_response_storage", "true");
    setKey("preferred_auth_method", '"apikey"');
    
    if (enableNotify && notifyCmd) {
        setKey("notify", notifyCmd);
    } else {
        text = text.replace(/^notify\s*=.*$\n?/m, "");
    }
    
    text = text.replace(/\[model_providers\.custom\][\s\S]*?(?=\n\[|$)/, "");
    text += `\n[model_providers.custom]\nname = "Custom-Node"\nbase_url = "${baseUrl}"\nwire_api = "responses"\nrequires_openai_auth = true\n`;
    return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function fetchAvailableModels(baseUrl, apiKey) {
    try {
        const url = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data.data || !Array.isArray(data.data)) return null;

        return data.data
            .map(m => m.id)
            .filter(id => !id.includes("embedding") && !id.includes("tts") && !id.includes("dall-e") && !id.includes("whisper"));
    } catch (e) {
        return null;
    }
}

function categorizeModels(models) {
    const categories = {};
    const knownFamilies = {
        "gpt": "GPT",
        "o1": "OpenAI-O",
        "o3": "OpenAI-O",
        "qwen": "Qwen",
        "claude": "Claude",
        "gemini": "Gemini",
        "doubao": "Doubao",
        "ep": "Doubao", 
        "deepseek": "DeepSeek",
        "glm": "GLM",
        "yi": "Yi",
        "moonshot": "Moonshot",
        "ernie": "Ernie"
    };

    models.forEach(id => {
        let family = "Other";
        if (id.includes("-")) {
            const prefix = id.split("-")[0].toLowerCase();
            family = knownFamilies[prefix] || (prefix.charAt(0).toUpperCase() + prefix.slice(1));
        } else {
            family = knownFamilies[id.toLowerCase()] || id;
        }

        if (!categories[family]) {
            categories[family] = [];
        }
        categories[family].push(id);
    });

    return categories;
}

async function configureCodex() {
    console.log("=== Codex 配置工具 ===");
    const defaultUrl = "https://api.openai.com/v1";
    const inputUrl = await ask(`[1/5] 请输入 API 地址 (默认 ${defaultUrl}):\n> `);
    const baseUrl = inputUrl.trim() || defaultUrl;
    
    const apiKey = await ask("[2/5] 请输入您的 API 密钥:\n> ");
    if (!apiKey.trim()) process.exit(1);

    console.log("正在从 API 获取可用模型...");
    const models = await fetchAvailableModels(baseUrl, apiKey.trim());
    let finalModels = ["gpt-4o"];

    if (models && models.length > 0) {
        const categories = categorizeModels(models);
        const groupNames = Object.keys(categories);
        
        console.log("\n获取到以下模型分组：");
        groupNames.forEach((name, i) => {
            console.log(`  [${i + 1}] ${name} (${categories[name].length} 个)`);
        });

        const groupIdxStr = await ask(`\n[3/5] 请选择模型分组序号 (默认 1):\n> `);
        const groupIdx = parseInt(groupIdxStr.trim()) - 1;
        const selectedGroup = (!isNaN(groupIdx) && groupNames[groupIdx]) ? groupNames[groupIdx] : groupNames[0];

        const targetModels = categories[selectedGroup];
        console.log(`\n=== ${selectedGroup} 可用模型 ===`);
        targetModels.forEach((m, i) => {
            console.log(`  [${i + 1}] ${m}`);
        });

        // 核心改动：支持逗号分隔的多选逻辑
        const modelIdxStr = await ask(`\n[4/5] 请选择具体模型序号 (支持多选，用逗号隔开，如 1,3。默认 1):\n> `);
        const inputs = modelIdxStr.split(',').map(s => s.trim()).filter(Boolean);
        
        const selectedArr = [];
        inputs.forEach(input => {
            const idx = parseInt(input) - 1;
            if (!isNaN(idx) && targetModels[idx] && !selectedArr.includes(targetModels[idx])) {
                selectedArr.push(targetModels[idx]);
            }
        });

        finalModels = selectedArr.length > 0 ? selectedArr : [targetModels[0]];
        console.log(`已锁定模型: ${finalModels.join(", ")}\n`);
        
    } else {
        console.log("\n获取模型失败或列表为空，请手动输入。");
        const manualModel = await ask(`[3&4/5] 请输入模型名称 (支持多个，用逗号隔开，默认 gpt-4o):\n> `);
        const inputs = manualModel.split(',').map(s => s.trim()).filter(Boolean);
        finalModels = inputs.length > 0 ? inputs : ["gpt-4o"];
    }

    const notifyChoice = await ask("[5/5] 是否开启通知？(y/n):\n> ");
    const enableNotify = notifyChoice.trim().toLowerCase() === 'y';
    rl.close();

    const codexDir = path.join(os.homedir(), ".codex");
    await fs.mkdir(codexDir, { recursive: true }).catch(() => {});

    let notifyCmd = null;
    if (enableNotify) {
        const platform = process.platform;
        if (platform === "darwin") {
            const scriptPath = path.join(codexDir, "notify_on_finish.sh");
            const scriptContent = `#!/bin/bash\nosascript -e "display notification \\"$1\\" with title \\"Codex\\"" > /dev/null 2>&1\n`;
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8", mode: 0o755 });
            notifyCmd = `["/bin/sh", "${scriptPath}"]`;
        } else if (platform === "win32") {
            const scriptPath = path.join(codexDir, "notify_on_finish.ps1");
            const scriptContent = `
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$msg = if ($args[0]) { $args[0] } else { "任务已完成" }
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$Template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$RawXml = [xml]$Template.GetXml()
$RawXml.toast.visual.binding.text[0].AppendChild($RawXml.CreateTextNode('Codex')) | Out-Null
$RawXml.toast.visual.binding.text[1].AppendChild($RawXml.CreateTextNode($msg)) | Out-Null
$SerializedXml = New-Object Windows.Data.Xml.Dom.XmlDocument
$SerializedXml.LoadXml($RawXml.OuterXml) | Out-Null
$Toast = [Windows.UI.Notifications.ToastNotification]::new($SerializedXml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Codex').Show($Toast) | Out-Null
            `.trim();
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8" });
            const escapedPath = scriptPath.replace(/\\/g, '\\\\');
            notifyCmd = `["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "${escapedPath}", ">", "$null", "2>&1"]`;
        }
    }

    const configPath = path.join(codexDir, "config.toml");
    let currentConfig = "";
    try { currentConfig = await fs.readFile(configPath, "utf8"); } catch (e) {}
    await fs.writeFile(configPath, updateTomlConfig(currentConfig, baseUrl, finalModels, enableNotify, notifyCmd), "utf8");
    
    const authPath = path.join(codexDir, "auth.json");
    let auth = {};
    try { auth = JSON.parse(await fs.readFile(authPath, "utf8")); } catch(e) {}
    auth.OPENAI_API_KEY = apiKey.trim();
    await fs.writeFile(authPath, JSON.stringify(auth, null, 2));

    console.log("\n配置环境就绪，工具链已更新。");
}

configureCodex().catch(err => { 
    console.error("执行中断:", err.message);
    process.exit(1); 
});
