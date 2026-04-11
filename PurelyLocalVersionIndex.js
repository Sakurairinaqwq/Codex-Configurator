#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import os from "os";
import readline from "readline";
import toml from "@iarna/toml";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function configureCodex() {
    console.log("=== Codex 自定义节点配置工具 ===");

    // 1. 交互式获取基础配置
    const defaultUrl = "https://api.openai.com/v1";
    const inputUrl = await ask(`请输入 API 代理地址 (留空则默认使用 ${defaultUrl}):\n> `);
    const baseUrl = inputUrl.trim() || defaultUrl;

    const apiKey = await ask("请输入您的 API 密钥:\n> ");
    if (!apiKey.trim()) {
        console.error("配置中断：API 密钥不能为空。");
        process.exit(1);
    }

    // 2. 交互式获取通知偏好
    const notifyChoice = await ask("是否开启任务完成的系统弹窗通知？(y/n，默认 n):\n> ");
    const enableNotify = notifyChoice.trim().toLowerCase() === 'y';

    rl.close();

    const codexDir = path.join(os.homedir(), ".codex");
    await fs.ensureDir(codexDir);

    const configPath = path.join(codexDir, "config.toml");
    let config = {};
    if (await fs.pathExists(configPath)) {
        const rawContent = await fs.readFile(configPath, "utf8");
        config = toml.parse(rawContent);
    }

    // --- 核心配置：适配 GPT-5.4 并拉满推理强度 ---
    config.model_provider = "custom";
    config.model = "gpt-5.4";
    config.model_reasoning_effort = "xhigh";
    config.disable_response_storage = true;
    config.preferred_auth_method = "apikey";
    
    config.model_providers = config.model_providers || {};
    config.model_providers.custom = {
        name: "Custom-Node",
        base_url: baseUrl,
        wire_api: "responses",
        requires_openai_auth: true
    };

    // 3. 处理系统通知逻辑 (完善版)
    if (enableNotify) {
        const platform = process.platform;
        
        if (platform === "darwin") {
            // macOS: 生成可执行的 shell 脚本来调用 AppleScript
            const scriptPath = path.join(codexDir, "notify_on_finish.sh");
            const scriptContent = `#!/bin/bash\nosascript -e 'display notification "Codex 任务已完成" with title "Codex"' > /dev/null 2>&1\n`;
            
            // 显式赋予 755 权限
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8", mode: 0o755 });
            config.notify = ["/bin/sh", scriptPath];
            console.log(`[+] macOS 通知脚本已生成: ${scriptPath}`);
        } else if (platform === "win32") {
            // Windows: 生成 Powershell 脚本来发送现代 Toast 通知
            const scriptPath = path.join(codexDir, "notify_on_finish.ps1");
            const scriptContent = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$Template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$RawXml = [xml]$Template.GetXml()
$RawXml.toast.visual.binding.text[0].AppendChild($RawXml.CreateTextNode('codex当前任务已完成'))
$RawXml.toast.visual.binding.text[1].AppendChild($RawXml.CreateTextNode('codex做了什么'))
$SerializedXml = New-Object Windows.Data.Xml.Dom.XmlDocument
$SerializedXml.LoadXml($RawXml.OuterXml)
$Toast = [Windows.UI.Notifications.ToastNotification]::new($SerializedXml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Codex').Show($Toast)
            `;
            
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8" });
            
            // 配置 Codex 使用 Powershell 运行该脚本，并绕过执行策略
            config.notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
            console.log(`[+] Windows 通知脚本已生成: ${scriptPath}`);
        } else {
            console.log("\n[!] 当前系统暂不支持自动配置弹窗通知，已跳过该项设置。");
        }
    } else {
        delete config.notify;
    }

    // 写入配置
    await fs.writeFile(configPath, toml.stringify(config), "utf8");
    console.log(`\n[+] 路由与通知配置已更新: ${configPath}`);

    const authPath = path.join(codexDir, "auth.json");
    let auth = await fs.readJSON(authPath).catch(() => ({}));
    auth.OPENAI_API_KEY = apiKey.trim();
    
    await fs.writeJSON(authPath, auth, { spaces: 2 });
    console.log(`[+] 密钥信息已写入: ${authPath}`);

    console.log("\n配置完成，现在可以正常启动 Codex。");
}

configureCodex().catch(err => {
    console.error("写入配置时发生错误:", err.message);
    process.exit(1);
});
