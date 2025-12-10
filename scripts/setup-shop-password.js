#!/usr/bin/env node
/**
 * setup-shop-password.js - Generate password hashes for shop credentials
 *
 * Usage:
 *   node scripts/setup-shop-password.js <password>
 *   node scripts/setup-shop-password.js demo123
 *
 * This will output a bcrypt hash that you can paste into config/shops.json
 */

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

async function main() {
  const password = process.argv[2];

  if (!password) {
    console.log('Usage: node scripts/setup-shop-password.js <password>');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/setup-shop-password.js mySecurePassword123');
    console.log('');
    console.log('This will generate a bcrypt hash to use in config/shops.json');
    process.exit(1);
  }

  console.log('Generating password hash...\n');

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  console.log('Password:', password);
  console.log('Hash:', hash);
  console.log('');
  console.log('Copy this hash to config/shops.json in the "passwordHash" field.');
  console.log('');
  console.log('Example shops.json entry:');
  console.log(`{
  "id": "myshop",
  "name": "My Shop Name",
  "sheetName": "My Shop Name",
  "username": "myshop",
  "passwordHash": "${hash}",
  "email": "shop@example.com",
  "phone": "305-555-1234"
}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
