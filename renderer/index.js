// 全局变量
let connections = JSON.parse(localStorage.getItem('connections') || '[]');
let currentConnection = null;
let currentDatabase = 0;
let keys = [];
let autoRefreshInterval = null;

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
  initializeApp();
  setupEventListeners();
  renderConnections();
  updateUI();
});

// 初始化应用
function initializeApp() {
  // 加载保存的连接
  if (connections.length > 0) {
    currentConnection = connections[0];
    connectToRedis(currentConnection);
  }
}

// 设置事件监听器
function setupEventListeners() {
  // 新建连接
  document.getElementById('new-connection').addEventListener('click', showConnectionModal);
  
  // 设置按钮
  document.getElementById('settings').addEventListener('click', showSettings);
  
  // 历史按钮
  document.getElementById('history').addEventListener('click', showHistory);
  
  // 新建键
  document.getElementById('new-key').addEventListener('click', showKeyModal);
  
  // 数据库选择
  document.getElementById('database-select').addEventListener('change', function(e) {
    currentDatabase = parseInt(e.target.value);
    loadKeys();
  });
  
  // 键搜索
  document.getElementById('key-search').addEventListener('input', function(e) {
    filterKeys(e.target.value);
  });
  
  // 键值操作
  document.getElementById('get-btn').addEventListener('click', getKey);
  document.getElementById('set-btn').addEventListener('click', setKey);
  document.getElementById('del-btn').addEventListener('click', deleteKey);
  
  document.getElementById('load-all').addEventListener('click', loadAllKeys);
  
  // 删除所有键
  document.getElementById('delete-all').addEventListener('click', deleteAllKeys);
  
  // 清除结果
  document.getElementById('clear-result').addEventListener('click', clearResult);
  
  // 自动刷新
  document.getElementById('auto-refresh-toggle').addEventListener('change', function(e) {
    toggleAutoRefresh(e.target.checked);
  });
  
  // 模态框事件
  setupModalEvents();
}

// 设置模态框事件
function setupModalEvents() {
  // 连接模态框
  document.getElementById('modal-close').addEventListener('click', hideConnectionModal);
  document.getElementById('modal-cancel').addEventListener('click', hideConnectionModal);
  document.getElementById('modal-ok').addEventListener('click', createConnection);
  
  // 键模态框
  document.getElementById('key-modal-close').addEventListener('click', hideKeyModal);
  document.getElementById('key-modal-cancel').addEventListener('click', hideKeyModal);
  document.getElementById('key-modal-ok').addEventListener('click', createKey);
  
  // 历史模态框
  const historyModal = document.getElementById('history-modal');
  if (historyModal) {
    document.getElementById('history-modal-close').addEventListener('click', hideHistoryModal);
    historyModal.addEventListener('click', function(e) {
      if (e.target === this) hideHistoryModal();
    });
    const refreshBtn = document.getElementById('refresh-logs');
    const clearBtn = document.getElementById('clear-logs');
    if (refreshBtn) refreshBtn.addEventListener('click', loadLogs);
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      await window.electronAPI.invoke('clear-logs');
      await loadLogs();
    });
  }

  // 设置模态框
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal) {
    document.getElementById('settings-modal-close').addEventListener('click', hideSettingsModal);
    settingsModal.addEventListener('click', function(e) {
      if (e.target === this) hideSettingsModal();
    });
  }

  // 点击模态框背景关闭
  document.getElementById('connection-modal').addEventListener('click', function(e) {
    if (e.target === this) hideConnectionModal();
  });
  
  document.getElementById('key-modal').addEventListener('click', function(e) {
    if (e.target === this) hideKeyModal();
  });
}

// 渲染连接列表
function renderConnections() {
  const tabsContainer = document.getElementById('connection-tabs');
  tabsContainer.innerHTML = '';
  
  connections.forEach((conn, index) => {
    const tab = document.createElement('div');
    tab.className = `connection-tab ${conn === currentConnection ? 'active' : ''}`;
    tab.innerHTML = `
      <i class="fas fa-database"></i>
      <span>${conn.name || `${conn.host}:${conn.port}`}</span>
      <button class="tab-close" onclick="closeConnection(${index})">
        <i class="fas fa-times"></i>
      </button>
    `;
    tab.addEventListener('click', () => selectConnection(index));
    tabsContainer.appendChild(tab);
  });
}

// 选择连接
function selectConnection(index) {
  currentConnection = connections[index];
  renderConnections();
  connectToRedis(currentConnection);
  updateUI();
}

// 关闭连接
function closeConnection(index) {
  connections.splice(index, 1);
  localStorage.setItem('connections', JSON.stringify(connections));
  
  if (currentConnection === connections[index]) {
    currentConnection = connections.length > 0 ? connections[0] : null;
  }
  
  renderConnections();
  updateUI();
}

// 连接到Redis
async function connectToRedis(connection) {
  if (!connection) return;
  
  try {
    showResult('正在连接...', 'info');
    
    const result = await window.electronAPI.invoke('redis-connect', { connection });
    
    if (result.success) {
      showResult('连接成功', 'success');
      await populateDatabases();
      loadServerInfo();
      loadKeys();
      loadKeyStats();
    } else {
      showResult(`连接失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showResult(`连接错误: ${error.message}`, 'error');
  }
}

// 加载服务器信息
async function loadServerInfo() {
  if (!currentConnection) return;
  
  try {
    const info = await window.electronAPI.invoke('redis-info', { 
      connection: currentConnection,
      database: currentDatabase 
    });
    
    if (info.success) {
      updateServerInfo(info.data);
    }
  } catch (error) {
    console.error('加载服务器信息失败:', error);
  }
}

// 更新服务器信息
function updateServerInfo(data) {
  // 服务器信息
  document.getElementById('redis-version').textContent = data.redis_version || '-';
  document.getElementById('redis-os').textContent = data.os || '-';
  document.getElementById('redis-pid').textContent = data.process_id || '-';
  
  // 内存信息
  document.getElementById('used-memory').textContent = formatBytes(data.used_memory || 0);
  document.getElementById('used-memory-peak').textContent = formatBytes(data.used_memory_peak || 0);
  document.getElementById('used-memory-lua').textContent = formatBytes(data.used_memory_lua || 0);
  
  // 统计信息
  document.getElementById('connected-clients').textContent = data.connected_clients || '-';
  document.getElementById('total-connections').textContent = data.total_connections_received || '-';
  document.getElementById('total-commands').textContent = data.total_commands_processed || '-';
}

// 加载键列表
async function loadKeys() {
  if (!currentConnection) return;
  
  try {
    const result = await window.electronAPI.invoke('redis-keys', {
      connection: currentConnection,
      database: currentDatabase,
      pattern: '*'
    });
    
    if (result.success) {
      keys = result.data || [];
      renderKeys();
    }
  } catch (error) {
    console.error('加载键列表失败:', error);
  }
}

// 渲染键列表
function renderKeys() {
  const keysList = document.getElementById('keys-list');
  keysList.innerHTML = '';
  
  keys.forEach(key => {
    const keyItem = document.createElement('div');
    keyItem.className = 'key-item';
    keyItem.innerHTML = `
      <i class="fas fa-key"></i>
      <span class="key-name">${key.name}</span>
      <span class="key-type">${key.type}</span>
    `;
    keyItem.addEventListener('click', () => selectKey(key.name));
    keysList.appendChild(keyItem);
  });
}

// 选择键
function selectKey(keyName) {
  document.getElementById('key-input').value = keyName;
  getKey();
  
  // 更新选中状态
  document.querySelectorAll('.key-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // 找到对应的key-item并添加active类
  const keyItems = document.querySelectorAll('.key-item');
  keyItems.forEach(item => {
    const itemKeyName = item.querySelector('.key-name').textContent;
    if (itemKeyName === keyName) {
      item.classList.add('active');
    }
  });
}

// 过滤键
function filterKeys(searchTerm) {
  const keyItems = document.querySelectorAll('.key-item');
  keyItems.forEach(item => {
    const keyName = item.querySelector('.key-name').textContent;
    if (keyName.toLowerCase().includes(searchTerm.toLowerCase())) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

// 获取键值
async function getKey() {
  const key = document.getElementById('key-input').value.trim();
  if (!key) {
    showResult('请输入键名', 'warning');
    return;
  }
  
  if (!currentConnection) {
    showResult('请先选择连接', 'warning');
    return;
  }
  
  try {
    const result = await window.electronAPI.invoke('redis-get', {
      connection: currentConnection,
      database: currentDatabase,
      key: key
    });
    
    if (result.success) {
      let displayValue = '';
      const data = result.data;
      const type = result.type;
      
      // 根据类型格式化显示
      switch (type) {
        case 'string':
          displayValue = data || '';
          break;
        case 'hash':
          displayValue = JSON.stringify(data, null, 2);
          break;
        case 'list':
          displayValue = JSON.stringify(data, null, 2);
          break;
        case 'set':
          displayValue = JSON.stringify(data, null, 2);
          break;
        case 'zset':
          // ZSet返回的是数组，每个元素是{score, value}对象
          displayValue = JSON.stringify(data, null, 2);
          break;
        default:
          displayValue = data || '';
      }
      
      document.getElementById('value-input').value = displayValue;
      showResult(`获取成功 (${type})`, 'success');
    } else {
      showResult(`获取失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showResult(`获取错误: ${error.message}`, 'error');
  }
}

// 设置键值
async function setKey() {
  const key = document.getElementById('key-input').value.trim();
  const value = document.getElementById('value-input').value;
  
  if (!key) {
    showResult('请输入键名', 'warning');
    return;
  }
  
  if (!currentConnection) {
    showResult('请先选择连接', 'warning');
    return;
  }
  
  try {
    const result = await window.electronAPI.invoke('redis-set', {
      connection: currentConnection,
      database: currentDatabase,
      key: key,
      value: value
    });
    
    if (result.success) {
      showResult('设置成功', 'success');
      loadKeys(); // 刷新键列表
    } else {
      showResult(`设置失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showResult(`设置错误: ${error.message}`, 'error');
  }
}

// 删除键
async function deleteKey() {
  const key = document.getElementById('key-input').value.trim();
  
  if (!key) {
    showResult('请输入键名', 'warning');
    return;
  }
  
  if (!currentConnection) {
    showResult('请先选择连接', 'warning');
    return;
  }
  
  if (!confirm(`确定要删除键 "${key}" 吗？`)) {
    return;
  }
  
  try {
    const result = await window.electronAPI.invoke('redis-del', {
      connection: currentConnection,
      database: currentDatabase,
      key: key
    });
    
    if (result.success) {
      showResult('删除成功', 'success');
      document.getElementById('key-input').value = '';
      document.getElementById('value-input').value = '';
      loadKeys(); // 刷新键列表
    } else {
      showResult(`删除失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showResult(`删除错误: ${error.message}`, 'error');
  }
}

// （已移除“加载更多”按钮，保留“加载全部”）

// 加载所有键
function loadAllKeys() {
  loadKeys();
}

// 删除所有键
async function deleteAllKeys() {
  if (!currentConnection) {
    showResult('请先选择连接', 'warning');
    return;
  }
  
  if (!confirm(`确定要删除当前数据库(DB ${currentDatabase})的所有键吗？此操作不可恢复！`)) {
    return;
  }
  
  try {
    showResult('正在删除所有键...', 'info');
    
    const result = await window.electronAPI.invoke('redis-delete-all', {
      connection: currentConnection,
      database: currentDatabase
    });
    
    if (result.success) {
      showResult(`成功删除 ${result.data} 个键`, 'success');
      document.getElementById('key-input').value = '';
      document.getElementById('value-input').value = '';
      loadKeys(); // 刷新键列表
      loadKeyStats(); // 刷新统计
    } else {
      showResult(`删除失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showResult(`删除错误: ${error.message}`, 'error');
  }
}

// 加载键统计
async function loadKeyStats() {
  if (!currentConnection) return;
  
  try {
    const result = await window.electronAPI.invoke('redis-stats', {
      connection: currentConnection
    });
    
    if (result.success) {
      renderKeyStats(result.data);
    }
  } catch (error) {
    console.error('加载键统计失败:', error);
  }
}

// 渲染键统计
function renderKeyStats(stats) {
  const tbody = document.getElementById('stats-table-body');
  tbody.innerHTML = '';
  
  stats.forEach(stat => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${stat.database}</td>
      <td>${stat.keys}</td>
      <td>${stat.expires}</td>
      <td>${stat.avgTtl || '0'}</td>
    `;
    row.style.cursor = 'pointer';
    row.title = '点击切换到该数据库';
    row.addEventListener('click', () => selectDatabase(stat.dbIndex));
    tbody.appendChild(row);
  });
}

// 选择数据库（来自下拉或统计表点击）
function selectDatabase(dbIndex) {
  const select = document.getElementById('database-select');
  if (!select) return;
  currentDatabase = parseInt(dbIndex);
  select.value = String(currentDatabase);
  loadKeys();
}

// 动态填充数据库下拉
async function populateDatabases() {
  if (!currentConnection) return;
  try {
    const result = await window.electronAPI.invoke('redis-databases', {
      connection: currentConnection
    });
    const count = (result && result.success && typeof result.data === 'number') ? result.data : 16;
    const select = document.getElementById('database-select');
    if (!select) return;
    select.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `DB ${i}`;
      select.appendChild(opt);
    }
    // 确保当前数据库有效
    if (currentDatabase < 0 || currentDatabase >= count) {
      currentDatabase = 0;
    }
    select.value = String(currentDatabase);
  } catch (_) {
    // 忽略错误，保持默认
  }
}

// 显示结果
function showResult(message, type = 'info') {
  const resultContent = document.getElementById('result-content');
  const className = `result-${type}`;
  
  resultContent.textContent = message;
  resultContent.className = `result-content ${className}`;
}

// 清除结果
function clearResult() {
  document.getElementById('result-content').textContent = '请选择连接并执行操作';
  document.getElementById('result-content').className = 'result-content';
}

// 切换自动刷新
function toggleAutoRefresh(enabled) {
  if (enabled) {
    autoRefreshInterval = setInterval(() => {
      if (currentConnection) {
        loadServerInfo();
        loadKeyStats();
      }
    }, 5000); // 每5秒刷新一次
  } else {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
}

// 更新UI
function updateUI() {
  const currentConnectionElement = document.getElementById('current-connection');
  
  if (currentConnection) {
    currentConnectionElement.innerHTML = `
      <i class="fas fa-database"></i>
      <span>${currentConnection.name || `${currentConnection.host}:${currentConnection.port}`}</span>
    `;
  } else {
    currentConnectionElement.innerHTML = `
      <i class="fas fa-database"></i>
      <span>未连接</span>
    `;
  }
}

// 显示连接模态框
function showConnectionModal() {
  document.getElementById('connection-modal').classList.add('show');
  document.getElementById('modal-name').value = '';
  document.getElementById('modal-host').value = 'localhost';
  document.getElementById('modal-port').value = '6379';
  document.getElementById('modal-password').value = '';
}

// 隐藏连接模态框
function hideConnectionModal() {
  document.getElementById('connection-modal').classList.remove('show');
}

// 创建连接
async function createConnection() {
  const name = document.getElementById('modal-name').value.trim();
  const host = document.getElementById('modal-host').value.trim();
  const port = document.getElementById('modal-port').value.trim();
  const password = document.getElementById('modal-password').value.trim();
  
  if (!host) {
    showResult('请输入主机地址', 'warning');
    return;
  }
  
  if (!port) {
    showResult('请输入端口', 'warning');
    return;
  }
  
  const connection = {
    name: name || `${host}:${port}`,
    host: host,
    port: parseInt(port),
    password: password || null
  };
  
  connections.push(connection);
  localStorage.setItem('connections', JSON.stringify(connections));
  
  currentConnection = connection;
  renderConnections();
  hideConnectionModal();
  connectToRedis(connection);
  updateUI();
}

// 显示键模态框
function showKeyModal() {
  document.getElementById('key-modal').classList.add('show');
  document.getElementById('new-key-name').value = '';
  document.getElementById('new-key-type').value = 'string';
  document.getElementById('new-key-value').value = '';
}

// 隐藏键模态框
function hideKeyModal() {
  document.getElementById('key-modal').classList.remove('show');
}

// 创建键
async function createKey() {
  const name = document.getElementById('new-key-name').value.trim();
  const type = document.getElementById('new-key-type').value;
  const value = document.getElementById('new-key-value').value;
  
  if (!name) {
    showResult('请输入键名', 'warning');
    return;
  }
  
  if (!currentConnection) {
    showResult('请先选择连接', 'warning');
    return;
  }
  
  try {
    const result = await window.electronAPI.invoke('redis-create-key', {
      connection: currentConnection,
      database: currentDatabase,
      key: name,
      type: type,
      value: value
    });
    
    if (result.success) {
      showResult('创建成功', 'success');
      hideKeyModal();
      loadKeys();
    } else {
      showResult(`创建失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showResult(`创建错误: ${error.message}`, 'error');
  }
}

// 工具函数
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 显示设置
async function showSettings() {
  try {
    const res = await window.electronAPI.invoke('app-version');
    if (res && res.success) {
      const versionInput = document.getElementById('app-version');
      if (versionInput) versionInput.value = `v${res.data}`;
    }
  } catch (_) {}
  document.getElementById('settings-modal').classList.add('show');
}

function hideSettingsModal() {
  document.getElementById('settings-modal').classList.remove('show');
}

// 显示历史
async function showHistory() {
  await loadLogs();
  document.getElementById('history-modal').classList.add('show');
}

function hideHistoryModal() {
  document.getElementById('history-modal').classList.remove('show');
}

async function loadLogs() {
  try {
    const res = await window.electronAPI.invoke('get-logs');
    if (res && res.success) {
      renderLogs(res.data || []);
    }
  } catch (error) {
    // 忽略渲染错误
  }
}

function renderLogs(logs) {
  const container = document.getElementById('history-list');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(logs) || logs.length === 0) {
    container.innerHTML = '<div style="padding:12px;color:#6c757d;">暂无日志</div>';
    return;
  }
  for (const log of logs) {
    const item = document.createElement('div');
    item.className = 'list-item';
    const conn = log.connection ? `${log.connection.host}:${log.connection.port}` : '';
    const details = [];
    if (conn) details.push(conn);
    if (typeof log.database === 'number') details.push(`db=${log.database}`);
    if (log.key) details.push(`key=${log.key}`);
    if (log.count != null) details.push(`count=${log.count}`);
    if (log.type) details.push(`type=${log.type}`);
    const extra = details.join('  ');
    const errorText = log.success ? '' : `<span class="error">${log.error || 'error'}</span>`;
    item.innerHTML = `
      <div class="time">${log.time || ''}</div>
      <div class="op">${log.op || ''}</div>
      <div>${extra} ${errorText}</div>
    `;
    container.appendChild(item);
  }
}

// 导出全局函数供HTML调用
window.closeConnection = closeConnection;
window.selectConnection = selectConnection;