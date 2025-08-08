const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const Redis = require('redis');

// 连接池，key为host:port
const redisClients = {};

// 简单日志存储（内存）
const redisLogs = [];

function addLog(entry) {
  const log = {
    time: new Date().toISOString(),
    ...entry,
  };
  // 限制日志长度，避免无限增长
  redisLogs.push(log);
  if (redisLogs.length > 5000) {
    redisLogs.shift();
  }
}

// 获取Redis客户端
function getRedisClient(connection) {
  const key = `${connection.host}:${connection.port}`;
  if (!redisClients[key]) {
    const config = {
      socket: { 
        host: connection.host, 
        port: parseInt(connection.port) 
      }
    };
    
    // 如果有密码，添加密码配置
    if (connection.password) {
      config.password = connection.password;
    }
    
    redisClients[key] = Redis.createClient(config);
    redisClients[key].connect().catch(() => {});
  }
  return redisClients[key];
}

// 连接到Redis
ipcMain.handle('redis-connect', async (event, { connection }) => {
  try {
    const client = getRedisClient(connection);
    await client.ping();
    addLog({ op: 'connect', connection, success: true });
    return { success: true };
  } catch (err) {
    addLog({ op: 'connect', connection, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 获取Redis信息
ipcMain.handle('redis-info', async (event, { connection, database }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    const info = await client.info();
    const infoLines = info.split('\r\n');
    const infoData = {};
    
    infoLines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        infoData[key] = value;
      }
    });
    
    const response = { 
      success: true, 
      data: {
        redis_version: infoData['redis_version'],
        os: infoData['os'],
        process_id: infoData['process_id'],
        used_memory: parseInt(infoData['used_memory'] || '0'),
        used_memory_peak: parseInt(infoData['used_memory_peak'] || '0'),
        used_memory_lua: parseInt(infoData['used_memory_lua'] || '0'),
        connected_clients: parseInt(infoData['connected_clients'] || '0'),
        total_connections_received: parseInt(infoData['total_connections_received'] || '0'),
        total_commands_processed: parseInt(infoData['total_commands_processed'] || '0')
      }
    };
    addLog({ op: 'info', connection, database, success: true });
    return response;
  } catch (err) {
    addLog({ op: 'info', connection, database, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 获取键列表
ipcMain.handle('redis-keys', async (event, { connection, database, pattern }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    const keys = await client.keys(pattern || '*');
    const keyData = [];
    
    // 获取每个键的类型
    for (const key of keys) {
      try {
        const type = await client.type(key);
        keyData.push({
          name: key,
          type: type
        });
      } catch (error) {
        keyData.push({
          name: key,
          type: 'unknown'
        });
      }
    }
    
    const res = { success: true, data: keyData };
    addLog({ op: 'keys', connection, database, success: true, count: keyData.length });
    return res;
  } catch (err) {
    addLog({ op: 'keys', connection, database, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 获取键值
ipcMain.handle('redis-get', async (event, { connection, database, key }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    // 先获取键类型
    const type = await client.type(key);
    let result = null;
    
    switch (type) {
      case 'string':
        result = await client.get(key);
        break;
      case 'hash':
        result = await client.hGetAll(key);
        break;
      case 'list':
        result = await client.lRange(key, 0, -1);
        break;
      case 'set':
        result = await client.sMembers(key);
        break;
      case 'zset':
        result = await client.zRangeWithScores(key, 0, -1);
        break;
      default:
        result = await client.get(key);
    }
    
    addLog({ op: 'get', connection, database, key, type, success: true });
    return { success: true, data: result, type: type };
  } catch (err) {
    addLog({ op: 'get', connection, database, key, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 设置键值
ipcMain.handle('redis-set', async (event, { connection, database, key, value, type }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    // 如果指定了类型，按类型设置；否则先检查现有类型
    if (type) {
      await setValueByType(client, key, value, type);
    } else {
      // 检查现有键类型
      const existingType = await client.type(key);
      if (existingType === 'none') {
        // 新键，默认设为string
        await client.set(key, value);
      } else {
        // 现有键，按原类型设置
        await setValueByType(client, key, value, existingType);
      }
    }
    
    addLog({ op: 'set', connection, database, key, type: type || 'auto', success: true });
    return { success: true };
  } catch (err) {
    addLog({ op: 'set', connection, database, key, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 按类型设置值的辅助函数
async function setValueByType(client, key, value, type) {
  const trimmed = (value ?? '').trim();
  
  switch (type) {
    case 'string':
      await client.set(key, trimmed);
      break;
    case 'hash': {
      let hashEntries = [];
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          hashEntries = Object.entries(parsed);
        }
      } catch (_) {}
      if (hashEntries.length === 0) {
        hashEntries = trimmed
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .map(line => {
            const m = line.match(/^(.*?)[=: ]\s*(.*)$/);
            return m ? [m[1], m[2]] : null;
          })
          .filter(Boolean);
      }
      if (hashEntries.length === 0) {
        await client.hSet(key, 'value', trimmed);
      } else {
        for (const [field, fieldValue] of hashEntries) {
          await client.hSet(key, field, String(fieldValue));
        }
      }
      break;
    }
    case 'list': {
      let elements = [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) elements = parsed.map(v => String(v));
      } catch (_) {}
      if (elements.length === 0) {
        elements = trimmed
          ? trimmed.split(/\r?\n|,/) .map(s => s.trim()).filter(Boolean)
          : [];
      }
      // 先清空列表，再添加新元素
      await client.del(key);
      if (elements.length > 0) {
        await client.lPush(key, elements);
      }
      break;
    }
    case 'set': {
      let members = [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) members = parsed.map(v => String(v));
      } catch (_) {}
      if (members.length === 0) {
        members = trimmed
          ? trimmed.split(/\r?\n|,/) .map(s => s.trim()).filter(Boolean)
          : [];
      }
      // 先清空集合，再添加新元素
      await client.del(key);
      if (members.length > 0) {
        await client.sAdd(key, members);
      }
      break;
    }
    case 'zset': {
      let entries = [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          entries = parsed
            .map(it => {
              if (it && typeof it === 'object' && 'score' in it && 'value' in it) {
                const scoreNum = Number(it.score);
                if (!Number.isNaN(scoreNum)) return { score: scoreNum, value: String(it.value) };
              }
              return null;
            })
            .filter(Boolean);
        }
      } catch (_) {}
      if (entries.length === 0) {
        entries = trimmed
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .map(line => {
            let m = line.match(/^(-?\d+(?:\.\d+)?)\s+(.*)$/);
            if (m) return { score: Number(m[1]), value: m[2] };
            m = line.match(/^(.*?)[|:\s]\s*(-?\d+(?:\.\d+)?)$/);
            if (m) return { score: Number(m[2]), value: m[1] };
            return null;
          })
          .filter(Boolean);
      }
      // 先清空有序集合，再添加新元素
      await client.del(key);
      if (entries.length > 0) {
        await client.zAdd(key, entries);
      }
      break;
    }
    default:
      await client.set(key, trimmed);
  }
}

// 删除键
ipcMain.handle('redis-del', async (event, { connection, database, key }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    const result = await client.del(key);
    addLog({ op: 'del', connection, database, key, success: true });
    return { success: true, data: result };
  } catch (err) {
    addLog({ op: 'del', connection, database, key, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 删除所有键
ipcMain.handle('redis-delete-all', async (event, { connection, database }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    // 获取所有键
    const keys = await client.keys('*');
    if (keys.length === 0) {
      return { success: true, data: 0 };
    }
    
    // 删除所有键
    const result = await client.del(keys);
    addLog({ op: 'delete-all', connection, database, success: true, count: keys.length });
    return { success: true, data: result };
  } catch (err) {
    addLog({ op: 'delete-all', connection, database, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 创建键
ipcMain.handle('redis-create-key', async (event, { connection, database, key, type, value }) => {
  try {
    const client = getRedisClient(connection);
    
    // 选择数据库
    if (database !== undefined) {
      await client.select(database);
    }
    
    const trimmed = (value ?? '').trim();

    switch (type) {
      case 'string': {
        await client.set(key, trimmed);
        break;
      }
      case 'hash': {
        let hashEntries = null;
        // 支持 JSON 对象 或 每行 field=value / field: value
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            hashEntries = Object.entries(parsed);
          }
        } catch (_) {}
        if (!hashEntries) {
          hashEntries = trimmed
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean)
            .map(line => {
              const m = line.match(/^(.*?)[=: ]\s*(.*)$/);
              return m ? [m[1], m[2]] : null;
            })
            .filter(Boolean);
        }
        if (!hashEntries || hashEntries.length === 0) {
          await client.hSet(key, 'value', trimmed);
        } else {
          // node-redis 支持对象，也支持多对 field-value；为兼容性我们逐条设置
          for (const [field, fieldValue] of hashEntries) {
            await client.hSet(key, field, String(fieldValue));
          }
        }
        break;
      }
      case 'list': {
        // 支持 JSON 数组 或 换行/逗号分隔
        let elements = [];
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) elements = parsed.map(v => String(v));
        } catch (_) {}
        if (elements.length === 0) {
          elements = trimmed
            ? trimmed.split(/\r?\n|,/) .map(s => s.trim()).filter(Boolean)
            : [];
        }
        if (elements.length === 0) {
          // 空则仍创建空标记
          await client.lPush(key, '');
        } else {
          await client.lPush(key, elements);
        }
        break;
      }
      case 'set': {
        let members = [];
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) members = parsed.map(v => String(v));
        } catch (_) {}
        if (members.length === 0) {
          members = trimmed
            ? trimmed.split(/\r?\n|,/) .map(s => s.trim()).filter(Boolean)
            : [];
        }
        if (members.length === 0) {
          await client.sAdd(key, '');
        } else {
          await client.sAdd(key, members);
        }
        break;
      }
      case 'zset': {
        // 支持 JSON 数组: [{score, value}] 或 每行 "score value" / "value|score"
        let entries = [];
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            entries = parsed
              .map(it => {
                if (it && typeof it === 'object' && 'score' in it && 'value' in it) {
                  const scoreNum = Number(it.score);
                  if (!Number.isNaN(scoreNum)) return { score: scoreNum, value: String(it.value) };
                }
                return null;
              })
              .filter(Boolean);
          }
        } catch (_) {}
        if (entries.length === 0) {
          entries = trimmed
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean)
            .map(line => {
              // 尝试 "score value" 或 "value|score" 或 "value:score"
              let m = line.match(/^(-?\d+(?:\.\d+)?)\s+(.*)$/);
              if (m) return { score: Number(m[1]), value: m[2] };
              m = line.match(/^(.*?)[|:\s]\s*(-?\d+(?:\.\d+)?)$/);
              if (m) return { score: Number(m[2]), value: m[1] };
              return null;
            })
            .filter(Boolean);
        }
        if (entries.length === 0) {
          await client.zAdd(key, [{ score: 1, value: trimmed }]);
        } else {
          await client.zAdd(key, entries);
        }
        break;
      }
      default: {
        await client.set(key, trimmed);
      }
    }
    
    addLog({ op: 'create-key', connection, database, key, type, success: true });
    return { success: true };
  } catch (err) {
    addLog({ op: 'create-key', connection, database, key, type, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 获取键统计
ipcMain.handle('redis-stats', async (event, { connection }) => {
  try {
    const client = getRedisClient(connection);
    const stats = [];

    // 获取数据库数量（失败则默认16）
    let databasesCount = 16;
    try {
      const cfg = await client.configGet('databases');
      const cfgValue = cfg && (cfg.databases || cfg.DATABASES);
      const parsed = parseInt(cfgValue);
      if (!Number.isNaN(parsed) && parsed > 0) {
        databasesCount = parsed;
      }
    } catch (_) {
      // ignore and use default 16
    }

    // 获取 keyspace 信息
    const info = await client.info('keyspace');
    const infoLines = info.split('\r\n');

    const keyspaceMap = {};
    infoLines.forEach(line => {
      if (line.startsWith('db')) {
        const dbMatch = line.match(/db(\d+):keys=(\d+),expires=(\d+),avg_ttl=(\d+)/);
        if (dbMatch) {
          const dbIndex = parseInt(dbMatch[1]);
          keyspaceMap[dbIndex] = {
            keys: parseInt(dbMatch[2]),
            expires: parseInt(dbMatch[3]),
            avgTtl: parseInt(dbMatch[4])
          };
        }
      }
    });

    for (let i = 0; i < databasesCount; i++) {
      const dbStats = keyspaceMap[i] || { keys: 0, expires: 0, avgTtl: 0 };
      stats.push({
        dbIndex: i,
        database: `DB ${i}`,
        keys: dbStats.keys,
        expires: dbStats.expires,
        avgTtl: dbStats.avgTtl
      });
    }

    addLog({ op: 'stats', connection, success: true });
    return { success: true, data: stats };
  } catch (err) {
    addLog({ op: 'stats', connection, success: false, error: err.message });
    return { success: false, error: err.message };
  }
});

// 获取数据库数量
ipcMain.handle('redis-databases', async (event, { connection }) => {
  try {
    const client = getRedisClient(connection);
    let databasesCount = 16;
    try {
      const cfg = await client.configGet('databases');
      const cfgValue = cfg && (cfg.databases || cfg.DATABASES);
      const parsed = parseInt(cfgValue);
      if (!Number.isNaN(parsed) && parsed > 0) {
        databasesCount = parsed;
      }
    } catch (_) {
      // ignore and use default 16
    }
    return { success: true, data: databasesCount };
  } catch (err) {
    return { success: true, data: 16 };
  }
});

// 兼容旧的API
ipcMain.handle('redis-op', async (event, { op, server, key, value }) => {
  try {
    const client = getRedisClient(server);
    if (op === 'get') {
      const result = await client.get(key);
      return { success: true, result };
    } else if (op === 'set') {
      await client.set(key, value);
      return { success: true };
    } else if (op === 'del') {
      await client.del(key);
      return { success: true };
    }
    return { success: false, error: '未知操作' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取日志
ipcMain.handle('get-logs', async () => {
  return { success: true, data: redisLogs.slice().reverse() };
});

// 清空日志
ipcMain.handle('clear-logs', async () => {
  redisLogs.length = 0;
  return { success: true };
});

// 应用版本
ipcMain.handle('app-version', async () => {
  return { success: true, data: app.getVersion() };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'default',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png')
  });

  win.loadFile('renderer/index.html');
  // 隐藏菜单栏
  win.setMenuBarVisibility(false);
  
  // 窗口准备好后显示
  win.once('ready-to-show', () => {
    win.show();
  });
}

app.whenReady().then(() => {
  // 关闭默认应用菜单
  Menu.setApplicationMenu(null);
  createWindow();
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// 清理连接池
app.on('before-quit', () => {
  Object.values(redisClients).forEach(client => {
    client.quit().catch(() => {});
  });
});