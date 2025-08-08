#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Redis Man PC 构建脚本');
console.log('========================\n');

// 检查操作系统
const platform = process.platform;
console.log(`当前操作系统: ${platform}`);

// 构建函数
function build(platform) {
  try {
    console.log(`\n📦 开始构建 ${platform} 版本...`);
    execSync(`npx electron-builder --${platform} --publish never`, { 
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: 'true' }
    });
    console.log(`✅ ${platform} 版本构建完成！`);
  } catch (error) {
    console.error(`❌ ${platform} 版本构建失败:`, error.message);
    process.exit(1);
  }
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('使用方法:');
    console.log('  node build.js win     # 构建 Windows 版本');
    console.log('  node build.js linux   # 构建 Linux 版本');
    console.log('  node build.js mac     # 构建 macOS 版本');
    console.log('  node build.js all     # 构建所有平台版本');
    console.log('');
    console.log('注意:');
    console.log('- macOS 版本只能在 macOS 系统上构建');
    console.log('- Linux 版本建议在 Linux 系统上构建');
    console.log('- Windows 版本可以在任何系统上构建');
    return;
  }

  const target = args[0].toLowerCase();
  
  switch (target) {
    case 'win':
      build('win');
      break;
    case 'linux':
      build('linux');
      break;
    case 'mac':
      build('mac');
      break;
    case 'all':
      console.log('🔄 构建所有平台版本...');
      build('win');
      build('linux');
      build('mac');
      break;
    default:
      console.error('❌ 无效的平台参数:', target);
      console.log('支持的平台: win, linux, mac, all');
      process.exit(1);
  }

  console.log('\n🎉 构建完成！');
  console.log('📁 安装包位于 dist/ 目录');
}

// 运行主函数
main();
