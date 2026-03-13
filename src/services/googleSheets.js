const { google } = require('googleapis');
const fs = require('fs').promises;
const supabase = require('../lib/supabase-admin');
const { generateEmbedding } = require('./embeddings');

const SPREADSHEET_ID = '1hdzFosH2FlouVSEcNa8skjjsAGGPQtwtyVfgYZMSjMg';
const CREDENTIALS_PATH = './credentials.json';

async function loadCredentials() {
  try {
    const credentialsFile = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(credentialsFile);
  } catch (error) {
    console.error('Error loading credentials:', error.message);
    throw new Error('Failed to load Google Sheets credentials');
  }
}

async function getAuthenticatedSheetsClient() {
  const credentials = await loadCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

async function readHeadlinesFromSheet() {
  try {
    const sheets = await getAuthenticatedSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'CreatorHooksData!A2:D',
    });

    const rows = response.data.values || [];

    const headlines = rows.map((row) => ({
      title: row[0] || '',
      framework: row[1] || '',
      hookScore: row[2] ? parseInt(row[2]) : null,
      why: row[3] || '',
    }));

    return headlines;
  } catch (error) {
    console.error('Error reading from Google Sheets:', error.message);
    throw error;
  }
}

async function syncHeadlinesToSupabase() {
  try {
    console.log('Reading headlines from Google Sheets...');
    const headlines = await readHeadlinesFromSheet();

    if (headlines.length === 0) {
      console.log('No headlines found in Google Sheets');
      return { synced: 0, failed: 0 };
    }

    console.log(`Found ${headlines.length} headlines. Generating embeddings...`);

    let synced = 0;
    let failed = 0;

    for (const headline of headlines) {
      const combinedText = `${headline.title} ${headline.framework} ${headline.why}`;

      const embedding = await generateEmbedding(combinedText);

      const { error } = await supabase.from('headlines').insert({
        title: headline.title,
        framework: headline.framework,
        hook_score: headline.hookScore,
        why: headline.why,
        embedding,
      });

      if (error) {
        console.error(`Failed to sync headline "${headline.title}":`, error.message);
        failed++;
      } else {
        synced++;
        console.log(`Synced: ${synced}/${headlines.length}`);
      }
    }

    console.log(`\nSync complete! Synced: ${synced}, Failed: ${failed}`);
    return { synced, failed };
  } catch (error) {
    console.error('Error syncing headlines:', error.message);
    throw error;
  }
}

module.exports = {
  readHeadlinesFromSheet,
  syncHeadlinesToSupabase,
};
