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

function updateTomlConfig(currentContent, baseUrl, enableNotify, notifyCmd) {
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
    setKey("model", '"gpt-5.4"');
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

async function configureCodex() {
    console.log("=== Codex 极速配置工具 ===");
    const defaultUrl = "https://api.openai.com/v1";
    const inputUrl = await ask(`[1/3] 请输入 API 地址 (默认 ${defaultUrl}):\n> `);
    const baseUrl = inputUrl.trim() || defaultUrl;
    const apiKey = await ask("[2/3] 请输入您的 API 密钥:\n> ");
    if (!apiKey.trim()) process.exit(1);
    const notifyChoice = await ask("[3/3] 是否开启通知？(y/n):\n> ");
    const enableNotify = notifyChoice.trim().toLowerCase() === 'y';
    rl.close();

    const codexDir = path.join(os.homedir(), ".codex");
    await fs.mkdir(codexDir, { recursive: true }).catch(() => {});

    let notifyCmd = null;
    if (enableNotify) {
        const platform = process.platform;
        
        if (platform === "darwin") {
            const scriptPath = path.join(codexDir, "notify_on_finish.sh");
            // macOS 同样改为接收第一个参数 $1
            const scriptContent = `#!/bin/bash\nosascript -e "display notification \\"$1\\" with title \\"Codex\\"" > /dev/null 2>&1\n`;
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8", mode: 0o755 });
            notifyCmd = `["/bin/sh", "${scriptPath}"]`;
        } else if (platform === "win32") {
            const scriptPath = path.join(codexDir, "notify_on_finish.ps1");
            // 核心修改：使用 $args[0] 接收 Codex 传来的原始任务描述
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
    await fs.writeFile(configPath, updateTomlConfig(currentConfig, baseUrl, enableNotify, notifyCmd), "utf8");
    
    const authPath = path.join(codexDir, "auth.json");
    let auth = {};
    try { auth = JSON.parse(await fs.readFile(authPath, "utf8")); } catch(e) {}
    auth.OPENAI_API_KEY = apiKey.trim();
    await fs.writeFile(authPath, JSON.stringify(auth, null, 2));

    console.log("\n🎉 配置完成！超高智商的Codex已配置完成喵！");
}

configureCodex().catch(err => { process.exit(1); });
