#!/usr/bin/env tsx

import { execSync } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

console.log(chalk.blue.bold('📊 Generating Test Coverage Report'));
console.log(chalk.blue('═'.repeat(50)));

try {
  // Run tests with coverage
  console.log(chalk.yellow('\n🧪 Running tests with coverage...'));
  execSync('npm run test:coverage', {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' }
  });

  // Check if coverage report exists
  const coverageFile = path.join(process.cwd(), 'coverage', 'lcov-report', 'index.html');
  if (fs.existsSync(coverageFile)) {
    console.log(chalk.green('\n✅ Coverage report generated successfully!'));
    console.log(chalk.blue(`📁 Report location: ${coverageFile}`));
    
    // Try to open in browser (macOS)
    if (process.platform === 'darwin') {
      try {
        execSync(`open ${coverageFile}`);
        console.log(chalk.green('🌐 Opening coverage report in browser...'));
      } catch {
        console.log(chalk.yellow('⚠️  Could not open browser automatically'));
      }
    }
  } else {
    console.log(chalk.red('\n❌ Coverage report not found'));
  }

  // Read coverage summary if available
  const summaryFile = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
  if (fs.existsSync(summaryFile)) {
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    const total = summary.total;
    
    console.log(chalk.blue('\n📈 Coverage Summary:'));
    console.log(chalk.blue('─'.repeat(30)));
    
    const metrics = ['lines', 'statements', 'functions', 'branches'];
    metrics.forEach(metric => {
      const data = total[metric];
      const percentage = data.pct;
      const color = percentage >= 80 ? chalk.green : percentage >= 60 ? chalk.yellow : chalk.red;
      console.log(`${metric.padEnd(12)}: ${color(`${percentage.toFixed(2)}%`)} (${data.covered}/${data.total})`);
    });
  }

} catch (error) {
  console.error(chalk.red('\n💥 Failed to generate coverage report:'), error);
  process.exit(1);
}