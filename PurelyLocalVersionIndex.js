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

// 轻量级 TOML 覆写逻辑 (替代庞大的第三方解析库)
function updateTomlConfig(currentContent, baseUrl, enableNotify, notifyCmd) {
    let text = currentContent || "";

    const setKey = (k, v) => {
        const regex = new RegExp(`^${k}\\s*=.*$`, "m");
        if (regex.test(text)) {
            text = text.replace(regex, `${k} = ${v}`);
        } else {
            text = `${k} = ${v}\n` + text; // 如果不存在，置顶插入
        }
    };

    // 注入核心参数
    setKey("model_provider", '"custom"');
    setKey("model", '"gpt-5.4"');
    setKey("model_reasoning_effort", '"xhigh"');
    setKey("disable_response_storage", "true");
    setKey("preferred_auth_method", '"apikey"');

    // 处理通知数组
    if (enableNotify && notifyCmd) {
        setKey("notify", notifyCmd);
    } else {
        text = text.replace(/^notify\s*=.*$\n?/m, ""); // 清理旧配置
    }

    // 剔除旧的自定义节点块并重新追加，防止重复污染
    text = text.replace(/\[model_providers\.custom\][\s\S]*?(?=\n\[|$)/, "");
    text += `\n[model_providers.custom]\nname = "Custom-Node"\nbase_url = "${baseUrl}"\nwire_api = "responses"\nrequires_openai_auth = true\n`;

    return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function configureCodex() {
    console.log("=== Codex 自定义节点极速配置工具 (零依赖版) ===");
    console.log("-------------------------------------------------");

    const defaultUrl = "https://api.openai.com/v1";
    const inputUrl = await ask(`[1/3] 请输入 API 代理地址 (留空则默认 ${defaultUrl}):\n> `);
    const baseUrl = inputUrl.trim() || defaultUrl;

    const apiKey = await ask("[2/3] 请输入您的 API 密钥:\n> ");
    if (!apiKey.trim()) {
        console.error("\n[!] 配置中断：API 密钥不能为空。");
        process.exit(1);
    }

    const notifyChoice = await ask("[3/3] 是否开启任务完成的系统弹窗通知？(y/n，默认 n):\n> ");
    const enableNotify = notifyChoice.trim().toLowerCase() === 'y';

    rl.close();
    console.log("\n-------------------------------------------------");
    console.log("正在写入配置...");

    const codexDir = path.join(os.homedir(), ".codex");
    await fs.mkdir(codexDir, { recursive: true }).catch(() => {});

    let notifyCmd = null;
    if (enableNotify) {
        const platform = process.platform;
        const notifyTitle = "Codex";
        const notifyMsg = "Codex 任务完成!";
        
        if (platform === "darwin") {
            const scriptPath = path.join(codexDir, "notify_on_finish.sh");
            const scriptContent = `#!/bin/bash\nosascript -e 'display notification "${notifyMsg}" with title "${notifyTitle}"' > /dev/null 2>&1\n`;
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8", mode: 0o755 });
            notifyCmd = `["/bin/sh", "${scriptPath}"]`;
            console.log(`[+] macOS 通知脚本已就绪: ${scriptPath}`);
        } else if (platform === "win32") {
            const scriptPath = path.join(codexDir, "notify_on_finish.ps1");
            const scriptContent = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$Template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$RawXml = [xml]$Template.GetXml()
$RawXml.toast.visual.binding.text[0].AppendChild($RawXml.CreateTextNode('${notifyTitle}'))
$RawXml.toast.visual.binding.text[1].AppendChild($RawXml.CreateTextNode('${notifyMsg}'))
$SerializedXml = New-Object Windows.Data.Xml.Dom.XmlDocument
$SerializedXml.LoadXml($RawXml.OuterXml)
$Toast = [Windows.UI.Notifications.ToastNotification]::new($SerializedXml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Codex').Show($Toast)
            `;
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8" });
            // 注意：Windows 路径中的反斜杠需要转义，以便安全写入 TOML
            const escapedScriptPath = scriptPath.replace(/\\/g, '\\\\');
            notifyCmd = `["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "${escapedScriptPath}"]`;
            console.log(`[+] Windows 通知脚本已就绪: ${scriptPath}`);
        } else {
            console.log("[!] 当前系统暂不支持自动配置弹窗通知，已跳过该项。");
        }
    }

    // 更新 config.toml
    const configPath = path.join(codexDir, "config.toml");
    let currentConfig = "";
    try { currentConfig = await fs.readFile(configPath, "utf8"); } catch (e) {}
    
    const newConfig = updateTomlConfig(currentConfig, baseUrl, enableNotify, notifyCmd);
    await fs.writeFile(configPath, newConfig, "utf8");
    console.log(`[+] 路由配置已更新: config.toml`);

    // 更新 auth.json
    const authPath = path.join(codexDir, "auth.json");
    let auth = {};
    try { auth = JSON.parse(await fs.readFile(authPath, "utf8")); } catch(e) {}
    auth.OPENAI_API_KEY = apiKey.trim();
    await fs.writeFile(authPath, JSON.stringify(auth, null, 2));
    console.log(`[+] 密钥信息已更新: auth.json`);

    console.log("\n🎉 配置全部完成！请尽情享受高智商的 Codex 吧。");
}

configureCodex().catch(err => {
    console.error("\n[X] 写入配置时发生严重错误:", err.message);
    process.exit(1);
});
