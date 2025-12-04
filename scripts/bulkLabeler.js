#!/usr/bin/env node
/**
 * bulkLabeler.js - Bulk label old calibration emails for processing
 *
 * This script searches for historical calibration-related emails and applies
 * the "ADAS FIRST" label so they can be processed by the emailListener pipeline.
 *
 * Usage:
 *   node scripts/bulkLabeler.js [options]
 *
 * Options:
 *   --days <n>       Search emails from the last N days (default: 30)
 *   --after <date>   Search emails after this date (YYYY/MM/DD format)
 *   --before <date>  Search emails before this date (YYYY/MM/DD format)
 *   --dry-run        Preview matches without applying labels
 *   --limit <n>      Maximum number of emails to process (default: 100)
 *
 * Examples:
 *   node scripts/bulkLabeler.js --days 60
 *   node scripts/bulkLabeler.js --after 2024/01/01 --before 2024/06/01
 *   node scripts/bulkLabeler.js --dry-run --days 7
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[BULK_LABELER]';

// Gmail configuration - MUST use radarsolutionsus@gmail.com
const GMAIL_USER = 'radarsolutionsus@gmail.com';
const LABEL_NAME = 'ADAS FIRST';

// OAuth paths (shared with emailListener)
const TOKEN_PATH = path.join(__dirname, '../config/gmail-token.json');
const CREDENTIALS_PATH = path.join(__dirname, '../config/gmail-credentials.json');

// Subject patterns that indicate calibration-related emails
const SUBJECT_PATTERNS = [
  'RO',
  'PO',
  'Calibration',
  'ADAS',
  'calibration',
  'Pre-Scan',
  'Post-Scan',
  'Pre Scan',
  'Post Scan',
  'Invoice',
  'RevvADAS'
];

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    days: 30,
    after: null,
    before: null,
    dryRun: false,
    limit: 100
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--days':
        options.days = parseInt(args[++i], 10);
        break;
      case '--after':
        options.after = args[++i];
        break;
      case '--before':
        options.before = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Bulk Labeler - Apply "ADAS FIRST" label to historical calibration emails

Usage:
  node scripts/bulkLabeler.js [options]

Options:
  --days <n>       Search emails from the last N days (default: 30)
  --after <date>   Search emails after this date (YYYY/MM/DD format)
  --before <date>  Search emails before this date (YYYY/MM/DD format)
  --dry-run        Preview matches without applying labels
  --limit <n>      Maximum number of emails to process (default: 100)
  --help, -h       Show this help message

Examples:
  node scripts/bulkLabeler.js --days 60
  node scripts/bulkLabeler.js --after 2024/01/01 --before 2024/06/01
  node scripts/bulkLabeler.js --dry-run --days 7
`);
}

/**
 * Load OAuth2 credentials and create authorized client
 */
async function getAuthenticatedClient() {
  // Check for credentials file
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`${LOG_TAG} Missing credentials file: ${CREDENTIALS_PATH}`);
    console.error(`${LOG_TAG} Please download OAuth credentials from Google Cloud Console`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
  );

  // Check for existing token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    // Check if token needs refresh
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log(`${LOG_TAG} Refreshing expired token...`);
      try {
        const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(newCredentials);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(newCredentials, null, 2));
        console.log(`${LOG_TAG} Token refreshed successfully`);
      } catch (err) {
        console.error(`${LOG_TAG} Failed to refresh token:`, err.message);
        console.log(`${LOG_TAG} Please re-authenticate using: node scripts/gmail-auth.js`);
        process.exit(1);
      }
    }

    return oauth2Client;
  }

  // No token - need to authenticate
  console.error(`${LOG_TAG} No OAuth token found at: ${TOKEN_PATH}`);
  console.error(`${LOG_TAG} Please run: node scripts/gmail-auth.js`);
  process.exit(1);
}

/**
 * Get or create the "ADAS FIRST" label
 */
async function getOrCreateLabel(gmail) {
  console.log(`${LOG_TAG} Looking up label: ${LABEL_NAME}`);

  try {
    // List all labels
    const response = await gmail.users.labels.list({ userId: 'me' });
    const labels = response.data.labels || [];

    // Find existing label
    const existingLabel = labels.find(
      l => l.name.toLowerCase() === LABEL_NAME.toLowerCase()
    );

    if (existingLabel) {
      console.log(`${LOG_TAG} Found existing label: ${existingLabel.id}`);
      return existingLabel.id;
    }

    // Create new label
    console.log(`${LOG_TAG} Creating new label: ${LABEL_NAME}`);
    const createResponse = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });

    console.log(`${LOG_TAG} Created label: ${createResponse.data.id}`);
    return createResponse.data.id;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get/create label:`, err.message);
    throw err;
  }
}

/**
 * Build the Gmail search query
 */
function buildSearchQuery(options) {
  const queryParts = [];

  // Must have attachments
  queryParts.push('has:attachment');

  // Subject patterns (OR condition)
  const subjectQuery = SUBJECT_PATTERNS.map(p => `subject:${p}`).join(' OR ');
  queryParts.push(`(${subjectQuery})`);

  // Date range
  if (options.after) {
    queryParts.push(`after:${options.after}`);
  } else if (options.days) {
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - options.days);
    const formattedDate = afterDate.toISOString().split('T')[0].replace(/-/g, '/');
    queryParts.push(`after:${formattedDate}`);
  }

  if (options.before) {
    queryParts.push(`before:${options.before}`);
  }

  // Exclude already labeled messages
  queryParts.push(`-label:${LABEL_NAME.replace(' ', '-')}`);

  return queryParts.join(' ');
}

/**
 * Search for matching emails
 */
async function searchEmails(gmail, query, limit) {
  console.log(`${LOG_TAG} Search query: ${query}`);

  const messages = [];
  let pageToken = null;

  try {
    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(limit - messages.length, 100),
        pageToken
      });

      if (response.data.messages) {
        messages.push(...response.data.messages);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken && messages.length < limit);

    console.log(`${LOG_TAG} Found ${messages.length} matching messages`);
    return messages.slice(0, limit);
  } catch (err) {
    console.error(`${LOG_TAG} Search failed:`, err.message);
    throw err;
  }
}

/**
 * Get email details for preview
 */
async function getEmailDetails(gmail, messageId) {
  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date']
    });

    const headers = response.data.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name === name)?.value || 'Unknown';

    return {
      id: messageId,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      date: getHeader('Date')
    };
  } catch (err) {
    return {
      id: messageId,
      subject: 'Error fetching details',
      from: '',
      date: ''
    };
  }
}

/**
 * Apply label to a message
 */
async function applyLabel(gmail, messageId, labelId) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });
    return true;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to label message ${messageId}:`, err.message);
    return false;
  }
}

/**
 * Prompt user for confirmation
 */
async function confirmContinue(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Main execution
 */
async function main() {
  console.log(`${LOG_TAG} Starting bulk labeler for ${GMAIL_USER}`);
  console.log(`${LOG_TAG} Target label: ${LABEL_NAME}`);

  const options = parseArgs();
  console.log(`${LOG_TAG} Options:`, options);

  // Authenticate
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Verify we're using the right account
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`${LOG_TAG} Authenticated as: ${profile.data.emailAddress}`);

    if (profile.data.emailAddress !== GMAIL_USER) {
      console.error(`${LOG_TAG} WARNING: Expected ${GMAIL_USER}, got ${profile.data.emailAddress}`);
      const proceed = await confirmContinue('Continue anyway?');
      if (!proceed) {
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get profile:`, err.message);
    process.exit(1);
  }

  // Get or create label
  const labelId = await getOrCreateLabel(gmail);

  // Build search query and find messages
  const query = buildSearchQuery(options);
  const messages = await searchEmails(gmail, query, options.limit);

  if (messages.length === 0) {
    console.log(`${LOG_TAG} No matching messages found`);
    process.exit(0);
  }

  // Preview messages
  console.log(`\n${LOG_TAG} Found ${messages.length} emails to label:\n`);

  const previewLimit = Math.min(messages.length, 10);
  for (let i = 0; i < previewLimit; i++) {
    const details = await getEmailDetails(gmail, messages[i].id);
    console.log(`  ${i + 1}. ${details.subject}`);
    console.log(`     From: ${details.from}`);
    console.log(`     Date: ${details.date}`);
    console.log('');
  }

  if (messages.length > previewLimit) {
    console.log(`  ... and ${messages.length - previewLimit} more\n`);
  }

  // Dry run - stop here
  if (options.dryRun) {
    console.log(`${LOG_TAG} DRY RUN - No labels applied`);
    process.exit(0);
  }

  // Confirm before applying labels
  const proceed = await confirmContinue(`Apply "${LABEL_NAME}" label to ${messages.length} emails?`);
  if (!proceed) {
    console.log(`${LOG_TAG} Cancelled by user`);
    process.exit(0);
  }

  // Apply labels
  console.log(`\n${LOG_TAG} Applying labels...`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const success = await applyLabel(gmail, messages[i].id, labelId);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Progress indicator
    if ((i + 1) % 10 === 0 || i === messages.length - 1) {
      console.log(`${LOG_TAG} Progress: ${i + 1}/${messages.length}`);
    }

    // Rate limiting - small delay between requests
    if (i < messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n${LOG_TAG} Complete!`);
  console.log(`${LOG_TAG} Labeled: ${successCount}`);
  console.log(`${LOG_TAG} Failed: ${failCount}`);

  if (successCount > 0) {
    console.log(`\n${LOG_TAG} These emails will now be picked up by the emailListener pipeline.`);
    console.log(`${LOG_TAG} Run 'node server.js' and the listener will process them automatically.`);
  }
}

main().catch(err => {
  console.error(`${LOG_TAG} Fatal error:`, err);
  process.exit(1);
});
