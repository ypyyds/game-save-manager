# 🎮 游戏存档管理器

一款开源的 Steam 游戏存档桌面管理工具，基于 Electron 开发。

## ✨ 功能

- 🔍 自动扫描 Steam 云存档（`userdata/<id>/<appid>/remote`）和本地存档（Documents/AppData）
- 🎮 卡片式展示游戏封面，自动从 Steam CDN 拉取封面图
- 🌐 联网自动识别游戏名称（Steam Store API）
- 📂 一键打开存档文件夹
- 💾 备份存档到任意目录
- 🗑 删除存档，支持回收站恢复
- 🖼 自定义背景图片/视频，支持从 Wallpaper Engine 导入
- 🔍 实时搜索游戏
- 🏪 一键跳转 Steam 商店页面
- ✏️ 自定义游戏名称
- 🎨 毛玻璃半透明卡片风格

## 📦 技术栈

- Electron
- Node.js (fs, path, shell)
- 原生 HTML/CSS/JS（无框架）

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/你的用户名/game-save-manager.git
cd game-save-manager

# 安装依赖
npm install

# 运行
npm start
```

## 📁 项目结构

```
├── main.js        # Electron 主进程（扫描存档/文件操作/IPC）
├── index.html     # 前端界面（卡片网格/设置/背景）
├── package.json   # 项目配置
└── README.md      # 说明文档
```

## ⚙️ 工作原理

1. **扫描存档**：读取 Steam 注册表获取安装路径 → 解析 `appmanifest_*.acf` 获取游戏列表 → 扫描 `userdata` 云存档目录 → 扫描 Documents/AppData 本地存档
2. **游戏封面**：从 Steam CDN `https://cdn.cloudflare.steamstatic.com/steam/apps/{appId}/header.jpg` 加载
3. **游戏名识别**：先读 `localconfig.vdf`，再查内置映射，最后联网请求 Steam Store API

## 📝 License

[MIT](LICENSE)
