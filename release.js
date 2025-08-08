#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Redis Man PC 发布脚本');
console.log('========================\n');

// 读取当前版本
function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

// 更新版本
function updateVersion(newVersion) {
  const packageJsonPath = 'package.json';
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`✅ 版本已更新为 ${newVersion}`);
}

// 创建Git标签
function createGitTag(version) {
  try {
    execSync(`git add .`);
    execSync(`git commit -m "Release v${version}"`);
    execSync(`git tag v${version}`);
    console.log(`✅ Git标签 v${version} 已创建`);
  } catch (error) {
    console.error('❌ Git操作失败:', error.message);
    process.exit(1);
  }
}

// 推送到远程仓库
function pushToRemote() {
  try {
    execSync('git push origin main');
    execSync('git push --tags');
    console.log('✅ 代码和标签已推送到远程仓库');
  } catch (error) {
    console.error('❌ 推送失败:', error.message);
    process.exit(1);
  }
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('使用方法:');
    console.log('  node release.js patch    # 发布补丁版本 (1.0.0 -> 1.0.1)');
    console.log('  node release.js minor    # 发布次要版本 (1.0.0 -> 1.1.0)');
    console.log('  node release.js major    # 发布主要版本 (1.0.0 -> 2.0.0)');
    console.log('  node release.js <version> # 发布指定版本 (如 1.2.3)');
    console.log('');
    console.log('当前版本:', getCurrentVersion());
    return;
  }

  const versionArg = args[0];
  let newVersion;

  if (['patch', 'minor', 'major'].includes(versionArg)) {
    const currentVersion = getCurrentVersion();
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    
    switch (versionArg) {
      case 'patch':
        newVersion = `${major}.${minor}.${patch + 1}`;
        break;
      case 'minor':
        newVersion = `${major}.${minor + 1}.0`;
        break;
      case 'major':
        newVersion = `${major + 1}.0.0`;
        break;
    }
  } else {
    // 验证版本格式
    if (!/^\d+\.\d+\.\d+$/.test(versionArg)) {
      console.error('❌ 无效的版本格式，请使用 x.y.z 格式');
      process.exit(1);
    }
    newVersion = versionArg;
  }

  console.log(`📦 准备发布版本 ${newVersion}...`);
  
  // 更新版本
  updateVersion(newVersion);
  
  // 构建所有平台
  console.log('\n🔨 开始构建所有平台版本...');
  try {
    execSync('node build.js all', { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ 构建失败');
    process.exit(1);
  }
  
  // 创建Git标签
  createGitTag(newVersion);
  
  // 推送
  console.log('\n📤 推送到远程仓库...');
  pushToRemote();
  
  console.log('\n🎉 发布完成！');
  console.log(`📋 版本 ${newVersion} 已发布`);
  console.log('🔗 GitHub Actions 将自动创建 Release');
  console.log('📁 安装包位于 dist/ 目录');
}

// 运行主函数
main();
