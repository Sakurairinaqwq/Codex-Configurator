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
    console.log("=== Codex 自定义节点极速配置工具 ===");
    console.log("---------------------------------------");

    // 1. 交互式获取基础配置
    const defaultUrl = "https://api.openai.com/v1";
    const inputUrl = await ask(`[1/3] 请输入 API 代理地址 (留空则默认 ${defaultUrl}):\n> `);
    const baseUrl = inputUrl.trim() || defaultUrl;

    const apiKey = await ask("[2/3] 请输入您的 API 密钥:\n> ");
    if (!apiKey.trim()) {
        console.error("\n[!] 配置中断：API 密钥不能为空。");
        process.exit(1);
    }

    // 2. 交互式获取通知偏好
    const notifyChoice = await ask("[3/3] 是否开启任务完成的系统弹窗通知？(y/n，默认 n):\n> ");
    const enableNotify = notifyChoice.trim().toLowerCase() === 'y';

    rl.close();
    console.log("\n---------------------------------------");
    console.log("正在写入配置...");

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

    // 3. 处理现代系统通知逻辑
    if (enableNotify) {
        const platform = process.platform;
        
        if (platform === "darwin") {
            // macOS: AppleScript 方案
            const scriptPath = path.join(codexDir, "notify_on_finish.sh");
            const scriptContent = `#!/bin/bash\nosascript -e 'display notification "Codex 做了什么" with title "Codex 当前任务已完成"' > /dev/null 2>&1\n`;
            
            // 显式赋予可执行权限
            await fs.writeFile(scriptPath, scriptContent, { encoding: "utf8", mode: 0o755 });
            config.notify = ["/bin/sh", scriptPath];
            console.log(`[+] macOS 通知脚本已就绪: ${scriptPath}`);
            
        } else if (platform === "win32") {
            // Windows: PowerShell Toast 方案 (大字标题 + 小字正文)
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
            
            // 绕过 PS 执行策略运行
            config.notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
            console.log(`[+] Windows 通知脚本已就绪: ${scriptPath}`);
        } else {
            console.log("[!] 当前系统暂不支持自动配置弹窗通知，已跳过该项。");
        }
    } else {
        // 用户选择关闭时，确保清理掉残留的 notify 字段
        delete config.notify;
    }

    // 4. 写入最终文件
    await fs.writeFile(configPath, toml.stringify(config), "utf8");
    console.log(`[+] 路由配置已更新: config.toml`);

    const authPath = path.join(codexDir, "auth.json");
    let auth = await fs.readJSON(authPath).catch(() => ({}));
    auth.OPENAI_API_KEY = apiKey.trim();
    
    await fs.writeJSON(authPath, auth, { spaces: 2 });
    console.log(`[+] 密钥信息已更新: auth.json`);

    console.log("\n🎉 配置全部完成！请尽情享受高智商的 Codex 吧。");
}

configureCodex().catch(err => {
    console.error("\n[X] 写入配置时发生严重错误:", err.message);
    process.exit(1);
});
