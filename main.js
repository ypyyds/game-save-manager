const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let mainWindow;
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function findSteamPath() {
  try {
    const reg = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' });
    const match = reg.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (match) return match[1].trim().replace(/\//g, '\\');
  } catch (e) {}
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\SteamLibrary',
    'E:\\Steam'
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'steam.exe'))) return c;
  }
  return null;
}

// 获取所有Steam库文件夹
function getSteamLibraries(steamPath) {
  const libs = [steamPath];
  try {
    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
      const content = fs.readFileSync(vdfPath, 'utf8');
      const matches = content.matchAll(/"path"\s*"([^"]+)"/g);
      for (const m of matches) {
        const p = m[1].replace(/\\\\/g, '\\');
        if (fs.existsSync(p) && !libs.includes(p)) libs.push(p);
      }
    }
  } catch (e) {}
  return libs;
}

// 读取Steam游戏名
function loadSteamGameNames(steamPath) {
  const nameMap = {};
  const libs = getSteamLibraries(steamPath);

  for (const lib of libs) {
    try {
      const steamappsPath = path.join(lib, 'steamapps');
      if (!fs.existsSync(steamappsPath)) continue;
      const files = fs.readdirSync(steamappsPath).filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf'));
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(steamappsPath, f), 'utf8');
          const idMatch = content.match(/"appid"\s*"(\d+)"/);
          const nameMatch = content.match(/"name"\s*"([^"]+)"/);
          if (idMatch && nameMatch && !nameMap[idMatch[1]]) {
            nameMap[idMatch[1]] = nameMatch[1];
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // localconfig.vdf
  const userdataPath = path.join(steamPath, 'userdata');
  if (fs.existsSync(userdataPath)) {
    try {
      const users = fs.readdirSync(userdataPath);
      for (const userId of users) {
        const vdfPath = path.join(userdataPath, userId, 'config', 'localconfig.vdf');
        if (!fs.existsSync(vdfPath)) continue;
        const content = fs.readFileSync(vdfPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let currentAppId = null;
        let braceDepth = 0;
        let inApps = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '"apps"') { inApps = true; continue; }
          if (!inApps) continue;
          const appStart = trimmed.match(/^"(\d+)"\s*\{/);
          if (appStart) {
            currentAppId = appStart[1];
            braceDepth = 1;
            continue;
          }
          if (currentAppId && braceDepth > 0) {
            if (trimmed === '{') braceDepth++;
            if (trimmed === '}') { braceDepth--; if (braceDepth === 0) currentAppId = null; }
            const nameMatch = trimmed.match(/^"name"\s*"([^"]+)"/);
            if (nameMatch && currentAppId && !nameMap[currentAppId]) {
              nameMap[currentAppId] = nameMatch[1];
            }
          }
        }
      }
    } catch (e) {}
  }

  return nameMap;
}

// 扫描Wallpaper Engine壁纸
function scanWallpaperEngine(steamPath) {
  const wallpapers = [];
  const libs = getSteamLibraries(steamPath);

  for (const lib of libs) {
    // Workshop壁纸
    const workshopPath = path.join(lib, 'steamapps', 'workshop', 'content', '431960');
    if (fs.existsSync(workshopPath)) {
      try {
        const items = fs.readdirSync(workshopPath);
        for (const item of items) {
          const wpPath = path.join(workshopPath, item);
          if (!fs.statSync(wpPath).isDirectory()) continue;
          try {
            const projPath = path.join(wpPath, 'project.json');
            let name = item;
            let type = 'web';
            let preview = '';
            if (fs.existsSync(projPath)) {
              const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'));
              if (proj.title) name = proj.title;
              if (proj.type) type = proj.type;
              if (proj.preview) preview = path.join(wpPath, proj.preview);
            }
            // 找预览图
            if (!preview) {
              const files = fs.readdirSync(wpPath);
              const previewFile = files.find(f => f.endsWith('.jpg') || f.endsWith('.png') || f === 'preview.jpg');
              if (previewFile) preview = path.join(wpPath, previewFile);
            }
            // 找主视频/图片
            let mainFile = '';
            if (type === 'video') {
              const files = fs.readdirSync(wpPath);
              const videoFile = files.find(f => f.endsWith('.mp4') || f.endsWith('.webm'));
              if (videoFile) mainFile = path.join(wpPath, videoFile);
            } else if (type === 'web') {
              const files = fs.readdirSync(wpPath);
              const htmlFile = files.find(f => f.endsWith('.html'));
              if (htmlFile) mainFile = path.join(wpPath, htmlFile);
            } else {
              const files = fs.readdirSync(wpPath);
              const imgFile = files.find(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg'));
              if (imgFile) mainFile = path.join(wpPath, imgFile);
            }
            wallpapers.push({ id: item, name, type, preview, mainFile, folder: wpPath });
          } catch (e) {}
        }
      } catch (e) {}
    }
  }
  return wallpapers;
}

// 中文游戏名映射
const chineseNames = {
  'ELDEN RING': '艾尔登法环', 'Dark Souls': '黑暗之魂', 'DARK SOULS': '黑暗之魂',
  'Skyrim': '上古卷轴5', 'Fallout': '辐射', 'Cyberpunk': '赛博朋克2077',
  'The Witcher': '巫师', 'Red Dead': '荒野大镖客', 'GTA': 'GTA',
  'Minecraft': '我的世界', 'Terraria': '泰拉瑞亚', 'Stardew': '星露谷物语',
  'Hollow Knight': '空洞骑士', 'Hades': '哈迪斯', 'Resident Evil': '生化危机',
  'Monster Hunter': '怪物猎人', 'Final Fantasy': '最终幻想', 'Persona 5': '女神异闻录5',
  'Yakuza': '如龙', 'Like a Dragon': '如龙', 'Baldurs Gate': '博德之门',
  'Baldur': '博德之门', 'Euro Truck': '欧洲卡车模拟', 'American Truck': '美国卡车模拟',
  'Forza': '极限竞速', 'Dying Light': '消逝的光芒', 'The Forest': '森林',
  'Sons Of The Forest': '森林之子', 'Valheim': '英灵神殿', 'Subnautica': '深海迷航',
  'Raft': '木筏求生', 'CS2': 'CS2', 'Counter-Strike': 'CS2', 'Dota': 'DOTA',
  'Genshin': '原神', 'Star Rail': '崩坏：星穹铁道', 'Honkai': '崩坏',
  'Zenless': '绝区零', 'miHoYo': '米哈游', 'HoYoverse': '米哈游',
  'League of Legends': '英雄联盟', 'Valorant': '无畏契约', 'Overwatch': '守望先锋',
  'World of Warcraft': '魔兽世界', 'Diablo': '暗黑破坏神', 'Civilization': '文明',
  'Stellaris': '群星', 'The Sims': '模拟人生', 'Cities': '城市',
  'No Man': '无人深空', 'Rust': 'Rust', 'ARK': '方舟生存进化',
  'Atomic Heart': '原子之心', 'Disco Elysium': '极乐迪斯科', 'Divinity': '神界原罪',
  'Pathfinder': '开拓者', 'Need for Speed': '极品飞车', 'Dead Island': '死亡岛',
  'Left 4 Dead': '求生之路', 'Half-Life': '半条命', 'Portal': '传送门',
  'Mount & Blade': '骑马与砍杀', 'Elden Ring': '艾尔登法环', 'Sekiro': '只狼',
  'Nioh': '仁王', 'PUBG': '绝地求生', 'Apex': 'Apex英雄',
  'Call of Duty': '使命召唤', 'Battlefield': '战地', 'Warhammer': '战锤',
  'Total War': '全面战争', 'Europa Universalis': '欧陆风云', 'Crusader Kings': '十字军之王',
  'Hearts of Iron': '钢铁雄心', 'Dyson Sphere': '戴森球计划', 'Don\'t Starve': '饥荒',
  'Oxygen Not Included': '缺氧', 'Factorio': '异星工厂', 'RimWorld': '环世界',
  'Stardew Valley': '星露谷物语', 'Lethal Company': '致命公司', 'Phasmophobia': '恐鬼症',
  'Satisfactory': '满意', 'Deep Rock': '深岩银河', 'Grounded': '禁闭求生',
  'Sons Of': '森林之子', 'Dead Space': '死亡空间', 'Last of Us': '最后生还者',
  'God of War': '战神', 'Spider-Man': '蜘蛛侠', 'Horizon': '地平线',
  'Ghost of Tsushima': '对马岛之魂', 'Metal Gear': '合金装备', 'Silent Hill': '寂静岭'
};

function toChineseName(name) {
  for (const [key, val] of Object.entries(chineseNames)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return name;
}

function getDirSize(dir) {
  let size = 0;
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) size += getDirSize(full);
      else size += stat.size;
    }
  } catch (e) {}
  return size;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// 常见Steam AppID -> 游戏名
const knownAppIds = {
  '730': 'CS2', '440': '军团要塞2', '570': 'DOTA2', '8930': 'Left 4 Dead 2',
  '220': '半条命2', '320': '半条命2:消失', '380': '半条命2:第一章', '420': '半条命2:第二章',
  '500': '半条命:起源', '550': '半条命:失落的海岸线', '620': ' PORTAL', '400': '传送门2',
  '620': '传送门', '400': '半条命2死亡竞赛',
  '1172470': '艾尔登法环', '1245620': '艾尔登法环',
  '1245620': 'ELDEN RING',
  '236430': '黑暗之魂3', '331000': '黑暗之魂3',
  '374320': '只狼', '814540': '只狼',
  '1097140': '赛博朋克2077', '1091500': '赛博朋克2077',
  '292030': '巫师3', '1027820': '巫师3次世代版',
  '1174180': '荒野大镖客2',
  '271590': 'GTA5',
  '367520': '空洞骑士',
  '1145360': '哈迪斯',
  '1245620': '艾尔登法环',
  '252490': 'Rust',
  '304930': 'Unturned',
  '252490': 'Rust',
  '1086940': '博德之门3',
  '550650': '博德之门3',
  '2358720': '博德之门3',
  '1240440': '地平线:西之绝境',
  '1817070': '战神:诸神黄昏',
  '1593500': '战神',
  '1817070': '战神',
  '1462040': '孤岛惊魂6',
  '255300': '欧洲卡车模拟2',
  '270880': '美国卡车模拟',
  '413150': 'Stardew Valley',
  '105600': 'Terraria',
  '427520': 'Valheim',
  '294100': 'GTA4',
  '12210': '半条命',
  '12330': '半条命:蓝色沸点',
  '12340': '半条命:针锋相对',
  '300': '半条命:起源',
  '320': '半条命2:消失',
  '380': '半条命2:第一章',
  '420': '半条命2:第二章',
  '500': '半条命:起源',
  '550': '半条命:失落的海岸线',
  '220': '半条命2',
  '440': '军团要塞2',
  '550': '半条命:失落的海岸线',
  '620': '传送门',
  '400': '传送门2',
  '730': 'CS2',
  '1800': '反恐精英:起源',
  '10': '反恐精英',
  '240': '反恐精英:零点行动',
  '570': 'DOTA2',
  '329510': '边狱公司',
  '1974850': '装甲核心6',
  '2081470': '装甲核心6',
  '252490': 'Rust',
  '304930': 'Unturned',
  '252490': 'Rust',
  '1086940': '博德之门3',
  '550650': '博德之门3',
  '2358720': '博德之门3',
  '1240440': '地平线:西之绝境',
  '1817070': '战神:诸神黄昏',
  '1593500': '战神',
  '1817070': '战神',
  '1462040': '孤岛惊魂6',
  '255300': '欧洲卡车模拟2',
  '270880': '美国卡车模拟',
  '413150': 'Stardew Valley',
  '105600': 'Terraria',
  '427520': 'Valheim',
  '294100': 'GTA4',
  '12210': '半条命',
  '12330': '半条命:蓝色沸点',
  '12340': '半条命:针锋相对',
  '300': '半条命:起源',
  '320': '半条命2:消失',
  '380': '半条命2:第一章',
  '420': '半条命2:第二章',
  '500': '半条命:起源',
  '550': '半条命:失落的海岸线',
  '220': '半条命2',
  '440': '军团要塞2',
  '550': '半条命:失落的海岸线',
  '620': '传送门',
  '400': '传送门2',
  '730': 'CS2',
  '1800': '反恐精英:起源',
  '10': '反恐精英',
  '240': '反恐精英:零点行动',
  '570': 'DOTA2',
  '329510': '边狱公司',
  '1974850': '装甲核心6',
  '2081470': '装甲核心6',
  '252490': 'Rust',
  '304930': 'Unturned',
  '252490': 'Rust',
  '1086940': '博德之门3',
  '550650': '博德之门3',
  '2358720': '博德之门3',
  '1240440': '地平线:西之绝境',
  '1817070': '战神:诸神黄昏',
  '1593500': '战神',
  '1817070': '战神',
  '1462040': '孤岛惊魂6',
  '255300': '欧洲卡车模拟2',
  '270880': '美国卡车模拟',
  '413150': 'Stardew Valley',
  '105600': 'Terraria',
  '427520': 'Valheim',
  '294100': 'GTA4',
  '12210': '半条命',
  '12330': '半条命:蓝色沸点',
  '12340': '半条命:针锋相对',
  '300': '半条命:起源',
  '320': '半条命2:消失',
  '380': '半条命2:第一章',
  '420': '半条命2:第二章',
  '500': '半条命:起源',
  '550': '半条命:失落的海岸线',
  '220': '半条命2',
  '440': '军团要塞2',
  '550': '半条命:失落的海岸线',
  '620': '传送门',
  '400': '传送门2',
  '730': 'CS2',
  '1800': '反恐精英:起源',
  '10': '反恐精英',
  '240': '反恐精英:零点行动',
  '570': 'DOTA2',
  '329510': '边狱公司',
  '1974850': '装甲核心6',
  '2081470': '装甲核心6',
  '252490': 'Rust',
  '304930': 'Unturned',
  '1364780': '街头霸王6',
  '1868140': '潜水员戴夫',
  '366980': '消逝的光芒',
  '3008130': '消逝的光芒:困神',
  '431960': 'Wallpaper Engine',
  '2483190': '极限竞速:地平线6',
  '1938090': '使命召唤',
  '2358720': '黑神话:悟空',
  '239830': '方舟:生存飞升',
  '4001890': '渔力全开',
  '2868840': '杀戮尖塔2',
  '411300': '泰拉瑞亚',
  '588650': '无主之地3',
  '1281930': '生化危机4重制版',
  '550': '半条命:失落的海岸线'
};

// 扫描Steam云端存档（按AppID去重）
function scanSteamCloud(steamPath, nameMap) {
  const games = [];
  const seen = {};
  const userdataPath = path.join(steamPath, 'userdata');
  if (!fs.existsSync(userdataPath)) return games;
  const users = fs.readdirSync(userdataPath);
  for (const userId of users) {
    const userPath = path.join(userdataPath, userId);
    if (!fs.statSync(userPath).isDirectory()) continue;
    const appIds = fs.readdirSync(userPath);
    for (const appId of appIds) {
      if (appId === '0') continue;
      if (seen[appId]) continue;
      const savePath = path.join(userPath, appId, 'remote');
      if (fs.existsSync(savePath)) {
        const rawSize = getDirSize(savePath);
        if (rawSize < 100) continue;
        seen[appId] = true;
        let gameName = nameMap[appId] || knownAppIds[appId] || ('未知游戏 (AppID: ' + appId + ')');
        gameName = toChineseName(gameName);
        games.push({
          name: gameName,
          appId: appId,
          savePath,
          size: formatSize(rawSize),
          type: 'steam'
        });
      }
    }
  }
  return games;
}

function scanLocalSaves() {
  const games = [];
  const userHome = app.getPath('home');
  const documents = app.getPath('documents');
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local');
  const localLow = path.join(userHome, 'AppData', 'LocalLow');

  const scanRoots = [
    { dir: path.join(documents, 'My Games'), label: '我的文档' },
    { dir: appData, label: 'Roaming' },
    { dir: localAppData, label: 'Local' },
    { dir: localLow, label: 'LocalLow' }
  ];

  for (const root of scanRoots) {
    if (!fs.existsSync(root.dir)) continue;
    let subdirs;
    try { subdirs = fs.readdirSync(root.dir); } catch (e) { continue; }
    for (const sub of subdirs) {
      const fullPath = path.join(root.dir, sub);
      if (!fs.statSync(fullPath).isDirectory()) continue;
      const lower = sub.toLowerCase();
      const matched = Object.keys(chineseNames).some(k => lower.includes(k.toLowerCase()));
      if (matched) {
        const rawSize = getDirSize(fullPath);
        if (rawSize < 100) continue;
        games.push({
          name: toChineseName(sub),
          savePath: fullPath,
          size: formatSize(rawSize),
          type: 'local',
          location: root.label
        });
      }
    }
  }
  return games;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const { screen } = require('electron');
  const primarySize = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: primarySize.width,
    height: primarySize.height,
    x: 0,
    y: 0,
    title: '游戏存档管理器',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  mainWindow.loadFile('index.html');
}

ipcMain.handle('scan-games', async () => {
  let results = [];
  let messages = [];

  const steamPath = findSteamPath();
  if (steamPath) {
    const nameMap = loadSteamGameNames(steamPath);
    messages.push('Steam: ' + steamPath + '，已识别 ' + Object.keys(nameMap).length + ' 个游戏名');
    const steamGames = scanSteamCloud(steamPath, nameMap);
    results = results.concat(steamGames);
    messages.push('云存档: ' + steamGames.length + ' 个');
  } else {
    messages.push('未找到Steam');
  }

  try {
    const localGames = scanLocalSaves();
    results = results.concat(localGames);
    messages.push('本地存档: ' + localGames.length + ' 个');
  } catch (e) {
    messages.push('本地扫描出错: ' + e.message);
  }

  // 联网查询未知游戏的名字（并行+超时）
  const unknowns = results.filter(g => g.name.startsWith('未知游戏'));
  if (unknowns.length > 0) {
    messages.push('正在联网查询 ' + unknowns.length + ' 个游戏名...');
    await Promise.all(unknowns.map(async (g) => {
      const appId = g.appId;
      if (!appId) return;
      try {
        const https = require('https');
        const url = 'https://store.steampowered.com/api/appdetails?appids=' + appId + '&cc=cn&l=schinese';
        const name = await new Promise((resolve) => {
          const req = https.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try {
                const j = JSON.parse(data);
                if (j[appId] && j[appId].success && j[appId].data) {
                  resolve(j[appId].data.name);
                } else resolve(null);
              } catch(e) { resolve(null); }
            });
          });
          req.setTimeout(8000, () => { req.destroy(); resolve(null); });
          req.on('error', () => resolve(null));
        });
        if (name) g.name = name;
      } catch(e) {}
    }));
  }

  return { games: results, messages };
});

ipcMain.handle('open-url', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  const { shell } = require('electron');
  try {
    const result = await shell.openPath(folderPath);
    if (result) {
      const { exec } = require('child_process');
      exec('explorer "' + folderPath + '"');
      return { success: true };
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('backup-game', async (event, { savePath, name }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择备份保存位置',
    properties: ['openDirectory']
  });
  if (result.canceled) return { success: false, canceled: true };
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
  const backupDir = path.join(result.filePaths[0], safeName + '_' + new Date().toISOString().slice(0,10));
  fs.mkdirSync(backupDir, { recursive: true });
  copyDir(savePath, backupDir);
  return { success: true, backupDir };
});

ipcMain.handle('delete-game', async (event, { savePath, name }) => {
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '确认删除',
    message: `确定要删除 "${name}" 的存档吗？`,
    detail: `将移动文件夹:\n${savePath}\n\n移动到回收站，可以随时恢复。`,
    buttons: ['取消', '移入回收站'],
    defaultId: 0,
    cancelId: 0
  });
  if (confirm.response !== 1) return { success: false, canceled: true };
  try {
    const recycleDir = path.join(app.getPath('userData'), 'recyclebin');
    fs.mkdirSync(recycleDir, { recursive: true });
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    const itemId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dest = path.join(recycleDir, itemId);
    copyDir(savePath, dest);
    fs.rmSync(savePath, { recursive: true, force: true });
    const manifest = loadRecycleManifest();
    manifest.push({
      id: itemId,
      name: name,
      originalPath: savePath,
      deletedAt: new Date().toISOString(),
      size: getDirSize(dest)
    });
    saveRecycleManifest(manifest);
    return { success: true, id: itemId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function getRecycleDir() { return path.join(app.getPath('userData'), 'recyclebin'); }
function getRecycleManifestPath() { return path.join(app.getPath('userData'), 'recyclebin.json'); }

function loadRecycleManifest() {
  try {
    const raw = fs.readFileSync(getRecycleManifestPath(), 'utf8');
    return JSON.parse(raw) || [];
  } catch (e) { return []; }
}

function saveRecycleManifest(list) {
  fs.writeFileSync(getRecycleManifestPath(), JSON.stringify(list, null, 2));
}

ipcMain.handle('list-recyclebin', () => {
  const items = loadRecycleManifest();
  return { items: items.map(it => ({
    ...it,
    size: it.size !== undefined ? it.size : (fs.existsSync(path.join(getRecycleDir(), it.id)) ? getDirSize(path.join(getRecycleDir(), it.id)) : 0)
  })) };
});

ipcMain.handle('restore-save', async (event, id) => {
  try {
    const items = loadRecycleManifest();
    const item = items.find(it => it.id === id);
    if (!item) return { success: false, error: '未找到该记录' };
    const src = path.join(getRecycleDir(), item.id);
    if (!fs.existsSync(src)) return { success: false, error: '回收站文件不存在' };
    const destDir = path.dirname(item.originalPath);
    fs.mkdirSync(destDir, { recursive: true });
    copyDir(src, item.originalPath);
    fs.rmSync(src, { recursive: true, force: true });
    saveRecycleManifest(items.filter(it => it.id !== id));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('purge-save', async (event, id) => {
  try {
    const items = loadRecycleManifest();
    const item = items.find(it => it.id === id);
    const src = path.join(getRecycleDir(), item ? item.id : id);
    if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true });
    saveRecycleManifest(items.filter(it => it.id !== id));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const items = fs.readdirSync(src);
  for (const item of items) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 背景设置
ipcMain.handle('get-bg', () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { bgPath: cfg.bgPath || '', opacity: cfg.opacity || 80 };
  } catch { return { bgPath: '', opacity: 80 }; }
});

ipcMain.handle('save-bg', (event, { bgPath, opacity }) => {
  try {
    const cfg = fs.existsSync(configPath()) ? JSON.parse(fs.readFileSync(configPath(), 'utf8')) : {};
    if (bgPath !== undefined) cfg.bgPath = bgPath;
    if (opacity !== undefined) cfg.opacity = opacity;
    fs.writeFileSync(configPath(), JSON.stringify(cfg));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('pick-bg', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择背景图片',
    filters: [{ name: '图片/视频', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm'] }],
    properties: ['openFile']
  });
  return { canceled: result.canceled, filePath: result.canceled ? '' : result.filePaths[0] };
});

ipcMain.handle('scan-wallpapers', () => {
  const steamPath = findSteamPath();
  if (!steamPath) return { wallpapers: [], error: '未找到Steam' };
  const wallpapers = scanWallpaperEngine(steamPath);
  return { wallpapers };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
