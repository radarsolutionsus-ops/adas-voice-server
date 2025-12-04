#!/usr/bin/env node
/**
 * Gmail OAuth Setup Script for radarsolutionsus@gmail.com
 *
 * This script helps you authorize the email listener to access Gmail.
 *
 * Prerequisites:
 * 1. Create OAuth 2.0 credentials in Google Cloud Console
 * 2. Download the credentials JSON and save to:
 *    ./google-oauth-client.json
 * 3. Run this script: node scripts/gmail-auth.js
 * 4. Login as radarsolutionsus@gmail.com and authorize
 * 5. Copy the authorization code from the browser and paste it here
 *
 * The token will be saved to ./gmail_oauth_token.json
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GMAIL_USER = 'radarsolutionsus@gmail.com';
const CREDENTIALS_PATH = path.join(__dirname, '../credentials/google-oauth-client.json');
const TOKEN_PATH = path.join(__dirname, '../credentials/gmail_oauth_token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive.file',      // Required for PDF uploads to Drive
  'https://www.googleapis.com/auth/spreadsheets'     // Required for Sheets read/write
];

async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('Gmail OAuth Setup for ADAS First Email Pipeline');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Target Gmail Account: ${GMAIL_USER}`);
  console.log('');

  // Check for credentials file
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('ERROR: OAuth credentials file not found!');
    console.error('');
    console.error('Please follow these steps:');
    console.error('1. Go to Google Cloud Console: https://console.cloud.google.com');
    console.error('2. Create or select a project');
    console.error('3. Enable the Gmail API');
    console.error('4. Go to Credentials > Create Credentials > OAuth Client ID');
    console.error('5. Select "Desktop app" as the application type');
    console.error('6. Download the JSON file');
    console.error(`7. Save it to: ${CREDENTIALS_PATH}`);
    console.error('8. Run this script again');
    process.exit(1);
  }

  // Load credentials
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed || credentials.web;

  // Use redirect URI that shows the code directly in the browser
  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  // Check if token already exists
  if (fs.existsSync(TOKEN_PATH)) {
    console.log('Existing token found. Testing...');
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log(`✅ Token is valid for: ${profile.data.emailAddress}`);

      if (profile.data.emailAddress !== GMAIL_USER) {
        console.warn(`⚠️  WARNING: Token is for ${profile.data.emailAddress}, not ${GMAIL_USER}`);
        console.log('   You may want to delete the token and re-authenticate.');
      }

      console.log('');
      console.log('Token file:', TOKEN_PATH);
      console.log('');
      console.log('You can now start the email listener:');
      console.log('  curl -X POST http://localhost:8080/email/start');
      process.exit(0);
    } catch (err) {
      console.log('Token expired or invalid. Generating new authorization URL...');
    }
  }

  // Generate authorization URL - use OOB flow so code appears in browser
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
  });

  console.log('');
  console.log('STEP 1: Open this URL in your browser:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log(`STEP 2: Login as ${GMAIL_USER} and click "Allow"`);
  console.log('');
  console.log('STEP 3: Google will show you an authorization code on the screen.');
  console.log('        Copy that code and paste it below.');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the authorization code: ', async (code) => {
    rl.close();

    if (!code || !code.trim()) {
      console.error('No code provided. Exiting.');
      process.exit(1);
    }

    try {
      const { tokens } = await oauth2Client.getToken({
        code: code.trim(),
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
      });

      // Save the token
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

      console.log('');
      console.log('✅ Token saved successfully!');
      console.log(`   File: ${TOKEN_PATH}`);
      console.log('');

      // Verify the token
      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log(`✅ Authenticated as: ${profile.data.emailAddress}`);

      // List labels to verify "ADAS FIRST" exists
      const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
      const labels = labelsResponse.data.labels || [];
      const adasLabel = labels.find(l => l.name === 'ADAS FIRST');

      if (adasLabel) {
        console.log('✅ Found label: "ADAS FIRST"');
      } else {
        console.log('⚠️  Label "ADAS FIRST" not found. Please create it in Gmail.');
      }

      console.log('');
      console.log('You can now start the email listener:');
      console.log('  curl -X POST http://localhost:8080/email/start');

    } catch (err) {
      console.error('');
      console.error('ERROR: Failed to exchange code for token');
      console.error(err.message);
      if (err.message.includes('invalid_grant')) {
        console.error('');
        console.error('The authorization code may have expired or already been used.');
        console.error('Please run this script again to get a new code.');
      }
      process.exit(1);
    }
  });
}

main();
