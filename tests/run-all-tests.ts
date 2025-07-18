#!/usr/bin/env tsx

import { execSync } from 'child_process';
import chalk from 'chalk';
import path from 'path';

interface TestSuite {
  name: string;
  command: string;
  pattern?: string;
}

const testSuites: TestSuite[] = [
  {
    name: 'Unit Tests - Pinecone Service',
    command: 'npm test',
    pattern: 'tests/unit/pinecone-service.test.ts'
  },
  {
    name: 'Unit Tests - Pool and Cluster',
    command: 'npm test',
    pattern: 'tests/unit/pool-and-cluster.test.ts'
  },
  {
    name: 'Unit Tests - DBSCAN',
    command: 'npm test',
    pattern: 'tests/unit/dbscan.test.ts'
  },
  {
    name: 'Integration Tests - API',
    command: 'npm test',
    pattern: 'tests/integration/api-title-generation.test.ts'
  },
  {
    name: 'System Health Check',
    command: 'npm run test:health'
  },
  {
    name: 'Pinecone Connection Test',
    command: 'npm run test:pinecone'
  }
];

async function runTests() {
  console.clear();
  console.log(chalk.blue.bold('🧪 Running Comprehensive Test Suite'));
  console.log(chalk.blue('═'.repeat(50)));
  console.log();

  const results: { suite: string; passed: boolean; duration: number; error?: string }[] = [];
  let totalTests = 0;
  let passedTests = 0;

  for (const suite of testSuites) {
    const startTime = Date.now();
    console.log(chalk.yellow(`\n📋 Running ${suite.name}...`));
    
    try {
      const command = suite.pattern 
        ? `${suite.command} -- ${suite.pattern}`
        : suite.command;
      
      const output = execSync(command, {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: { ...process.env, CI: 'true' }
      });

      const duration = Date.now() - startTime;
      
      // Extract test counts from Jest output
      const testMatch = output.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/);
      if (testMatch) {
        const passed = parseInt(testMatch[1]);
        const total = parseInt(testMatch[2]);
        totalTests += total;
        passedTests += passed;
      }

      console.log(chalk.green(`✅ ${suite.name} passed in ${duration}ms`));
      results.push({ suite: suite.name, passed: true, duration });
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.log(chalk.red(`❌ ${suite.name} failed in ${duration}ms`));
      
      // Try to extract test counts even from failed runs
      const output = error.stdout || error.message || '';
      const testMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
      if (testMatch) {
        const passed = parseInt(testMatch[2]);
        const total = parseInt(testMatch[3]);
        totalTests += total;
        passedTests += passed;
      }
      
      results.push({ 
        suite: suite.name, 
        passed: false, 
        duration,
        error: error.message 
      });
    }
  }

  // Summary
  console.log(chalk.blue('\n' + '═'.repeat(50)));
  console.log(chalk.blue.bold('📊 Test Summary'));
  console.log(chalk.blue('═'.repeat(50)));

  const passedSuites = results.filter(r => r.passed).length;
  const failedSuites = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\nSuites: ${chalk.green(`${passedSuites} passed`)}, ${chalk.red(`${failedSuites} failed`)}, ${results.length} total`);
  console.log(`Tests:  ${chalk.green(`${passedTests} passed`)}, ${chalk.red(`${totalTests - passedTests} failed`)}, ${totalTests} total`);
  console.log(`Time:   ${(totalDuration / 1000).toFixed(2)}s`);

  // Detailed results
  console.log(chalk.blue('\n📋 Detailed Results:'));
  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    const color = result.passed ? chalk.green : chalk.red;
    console.log(`${icon} ${color(result.suite)} (${result.duration}ms)`);
    if (result.error && process.env.VERBOSE) {
      console.log(chalk.gray(`   Error: ${result.error.slice(0, 100)}...`));
    }
  });

  // Exit code
  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    console.log(chalk.green.bold('\n🎉 All tests passed!'));
    process.exit(0);
  } else {
    console.log(chalk.red.bold('\n💥 Some tests failed!'));
    console.log(chalk.yellow('\nRun with VERBOSE=true for more details'));
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n💥 Unhandled error:'), error);
  process.exit(1);
});

// Run tests
runTests().catch(error => {
  console.error(chalk.red('\n💥 Failed to run tests:'), error);
  process.exit(1);
});