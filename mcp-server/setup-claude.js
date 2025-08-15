#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function getClaudeConfigPath() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  let configPath;
  if (platform === 'darwin') {
    configPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'win32') {
    configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  } else {
    configPath = path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
  }
  
  return configPath;
}

async function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
  }
}

async function backupFile(filePath) {
  try {
    const backupPath = `${filePath}.backup.${Date.now()}`;
    await fs.copyFile(filePath, backupPath);
    log(`  📦 Backed up existing config to: ${path.basename(backupPath)}`, colors.cyan);
    return backupPath;
  } catch (error) {
    // File might not exist, that's fine
    return null;
  }
}

async function updateClaudeConfig() {
  const configPath = await getClaudeConfigPath();
  log(`\n📍 Claude config location: ${configPath}`, colors.blue);
  
  await ensureDirectoryExists(configPath);
  
  // Read existing config or create new one
  let config = {};
  try {
    const existing = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(existing);
    log('  ✅ Found existing Claude config', colors.green);
    await backupFile(configPath);
  } catch (error) {
    log('  📝 Creating new Claude config', colors.yellow);
  }
  
  // Ensure mcpServers exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  
  // Add or update video-scripter server
  const serverPath = path.join(__dirname, 'dist', 'index.js');
  const envPath = path.join(__dirname, '..', '.env');
  
  config.mcpServers['video-scripter'] = {
    command: 'node',
    args: [serverPath],
    env: {
      DOTENV_CONFIG_PATH: envPath
    }
  };
  
  // Write updated config
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  log('  ✅ Updated Claude config with video-scripter MCP server', colors.green);
  
  return configPath;
}

async function runHealthCheck() {
  log('\n🏥 Running health check...', colors.cyan);
  
  try {
    const { stdout, stderr } = await execAsync('node health-check.js', { cwd: __dirname });
    
    // Parse health check output
    const lines = stdout.split('\n');
    const summaryLine = lines.find(l => l.includes('Score:'));
    
    if (summaryLine) {
      log(`  ${summaryLine.trim()}`, colors.green);
    }
    
    if (stdout.includes('HEALTHY')) {
      log('  ✅ MCP server is healthy!', colors.green);
      return true;
    } else if (stdout.includes('MOSTLY HEALTHY')) {
      log('  🟡 MCP server is mostly healthy', colors.yellow);
      return true;
    } else {
      log('  ⚠️  MCP server has issues, but setup will continue', colors.yellow);
      return false;
    }
  } catch (error) {
    log('  ❌ Health check failed, but setup will continue', colors.red);
    console.error(error.message);
    return false;
  }
}

async function checkClaudeDesktop() {
  const platform = os.platform();
  
  if (platform === 'darwin') {
    try {
      await execAsync('pgrep -x "Claude"');
      return true;
    } catch {
      return false;
    }
  } else if (platform === 'win32') {
    try {
      const { stdout } = await execAsync('tasklist | findstr "Claude.exe"');
      return stdout.includes('Claude.exe');
    } catch {
      return false;
    }
  }
  
  return false;
}

async function main() {
  log('\n🚀 Video Scripter MCP Server Setup', colors.bright + colors.cyan);
  log('=' .repeat(60), colors.cyan);
  
  // Step 1: Check if build exists
  log('\n📦 Checking build status...', colors.blue);
  try {
    await fs.access(path.join(__dirname, 'dist', 'index.js'));
    log('  ✅ Build exists', colors.green);
  } catch {
    log('  ⚠️  Build not found, building now...', colors.yellow);
    const { stdout } = await execAsync('npm run build', { cwd: __dirname });
    log('  ✅ Build completed', colors.green);
  }
  
  // Step 2: Run health check
  const isHealthy = await runHealthCheck();
  
  // Step 3: Update Claude config
  const configPath = await updateClaudeConfig();
  
  // Step 4: Check if Claude is running
  log('\n🔍 Checking Claude Desktop...', colors.blue);
  const isClaudeRunning = await checkClaudeDesktop();
  
  if (isClaudeRunning) {
    log('  ⚠️  Claude Desktop is running', colors.yellow);
    log('  📌 You need to restart Claude Desktop for changes to take effect', colors.yellow);
  } else {
    log('  ✅ Claude Desktop is not running', colors.green);
  }
  
  // Step 5: Final instructions
  log('\n' + '=' .repeat(60), colors.cyan);
  log('✅ Setup Complete!', colors.bright + colors.green);
  log('=' .repeat(60), colors.cyan);
  
  log('\n📋 Next Steps:', colors.bright);
  log('1. Restart Claude Desktop (required)', colors.reset);
  log('2. Test the MCP tools with:', colors.reset);
  log('   "Use explore_patterns to find YouTube patterns about AI tools"', colors.cyan);
  
  if (!isHealthy) {
    log('\n⚠️  Note: Health check found some issues', colors.yellow);
    log('   Run "npm run health" to see details', colors.yellow);
  }
  
  log('\n🛠️  Useful Commands:', colors.bright);
  log('  npm run test      - Run basic test', colors.reset);
  log('  npm run test:full - Run comprehensive tests', colors.reset);
  log('  npm run health    - Check server health', colors.reset);
  log('  npm run dev       - Development mode with auto-reload', colors.reset);
  
  log('\n📖 Full documentation: SETUP.md', colors.cyan);
}

// Run the setup
main().catch(error => {
  log(`\n❌ Setup failed: ${error.message}`, colors.red);
  console.error(error);
  process.exit(1);
});