require('dotenv').config();
const { syncHeadlinesToSupabase } = require('../services/googleSheets');

async function main() {
  console.log('Starting Google Sheets to Supabase sync...\n');

  try {
    const result = await syncHeadlinesToSupabase();

    console.log('\n========== SYNC COMPLETE ==========');
    console.log(`Headlines synced: ${result.synced}`);
    console.log(`Headlines failed: ${result.failed}`);
    console.log('===================================\n');

    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error during sync:', error.message);
    process.exit(1);
  }
}

main();
