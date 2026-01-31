const axios = require("axios");
const cheerio = require("cheerio");
const { google } = require("googleapis");
const fs = require("fs").promises;

// Google Sheets configuration
const SPREADSHEET_ID = "1hdzFosH2FlouVSEcNa8skjjsAGGPQtwtyVfgYZMSjMg"; // Replace with your Google Sheet ID
const CREDENTIALS_PATH = "./credentials.json";

class CreatorHooksScraperLight {
  constructor() {
    this.baseUrl = "https://creatorhooks.com/past-creator-hooks-newsletters/";
    this.allHooks = [];
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
  }

  async scrapeListingPage(pageNumber = 1) {
    const url =
      pageNumber === 1 ? this.baseUrl : `${this.baseUrl}page/${pageNumber}/`;

    console.log(`Scraping listing page ${pageNumber}: ${url}`);

    try {
      const response = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(response.data);

      // Extract post URLs
      const postUrls = [];
      $("article h2.entry-title a").each((i, elem) => {
        postUrls.push($(elem).attr("href"));
      });

      console.log(`Found ${postUrls.length} posts on page ${pageNumber}`);

      // Check if there's a next page
      const hasNextPage =
        $(".nav-previous a").length > 0 ||
        $('a:contains("Next")').length > 0 ||
        $('a:contains("Older posts")').length > 0;

      return { postUrls, hasNextPage };
    } catch (error) {
      console.error(
        `Error scraping listing page ${pageNumber}:`,
        error.message,
      );
      return { postUrls: [], hasNextPage: false };
    }
  }

  async scrapePost(url) {
    console.log(`Scraping post: ${url}`);

    try {
      const response = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(response.data);

      const hooks = [];
      const content = $(".entry-content");

      if (!content.length) return hooks;

      // Process each heading (h1, h2) as a potential hook section
      content.find("h1, h2").each((index, heading) => {
        // Skip the first heading (main title)
        if (index === 0) return;

        const $heading = $(heading);
        const sectionTitle = $heading.text().trim();

        // Skip advertisement sections
        if (
          sectionTitle.includes("Creator Hooks Pro") ||
          sectionTitle === "Flop of the Week"
        ) {
          return;
        }

        let framework = "";
        let hookScore = "";
        let whyThisWorks = "";
        let collectingWhy = false;
        let extractedTitle = "";

        // Get all siblings until next heading
        let $next = $heading.next();

        while ($next.length && !["H1", "H2"].includes($next.prop("tagName"))) {
          const text = $next.text().trim();

          // Extract Title
          if (text.match(/^Title:/i)) {
            extractedTitle = text.replace(/^Title:/i, "").trim();
          }

          // Extract Framework
          if (text.match(/^Framework:/i)) {
            framework = text.replace(/^Framework:/i, "").trim();
          }

          // Extract Hook Score
          if (text.match(/Hook score/i)) {
            const scoreMatch = text.match(/[+\-]?\d+/);
            if (scoreMatch) {
              hookScore = scoreMatch[0];
            }
          }

          // Extract Why this works
          if (text.startsWith("Why this works:")) {
            collectingWhy = true;
            whyThisWorks = text.replace("Why this works:", "").trim();
          } else if (text.startsWith("Why this flopped:")) {
            collectingWhy = true;
            whyThisWorks = text.replace("Why this flopped:", "").trim();
          } else if (collectingWhy && text.startsWith("How you can use")) {
            collectingWhy = false;
          } else if (
            collectingWhy &&
            text.length > 0 &&
            !text.startsWith("Examples of") &&
            !text.startsWith("TLDR:")
          ) {
            whyThisWorks += " " + text;
          }

          $next = $next.next();
        }

        if (framework || hookScore) {
          hooks.push({
            title: extractedTitle || sectionTitle,
            framework: framework,
            hookScore: hookScore,
            whyThisWorks: whyThisWorks.trim(),
          });
        }
      });

      return hooks;
    } catch (error) {
      console.error(`Error scraping post ${url}:`, error.message);
      return [];
    }
  }

  async scrapeAllPages() {
    let currentPage = 1;
    let hasMorePages = true;
    const allPostUrls = [];

    while (hasMorePages && currentPage <= 1) {
      // LIMIT TO 1 PAGE FOR DEBUGGING
      const { postUrls, hasNextPage } =
        await this.scrapeListingPage(currentPage);
      allPostUrls.push(...postUrls);
      hasMorePages = hasNextPage;
      currentPage++;

      await this.delay(1000);
    }

    console.log(`\nTotal posts found: ${allPostUrls.length}`);

    // Scrape each post
    for (let i = 0; i < allPostUrls.length; i++) {
      console.log(`\nProcessing post ${i + 1}/${allPostUrls.length}`);
      const hooks = await this.scrapePost(allPostUrls[i]);

      hooks.forEach((hook) => {
        this.allHooks.push({
          postUrl: allPostUrls[i],
          ...hook,
        });
      });

      await this.delay(1500);
    }

    return this.allHooks;
  }

  async ensureSheetExists(sheets, title) {
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      const sheetExists = response.data.sheets.some(
        (sheet) => sheet.properties.title === title,
      );

      if (!sheetExists) {
        console.log(`Sheet '${title}' does not exist. Creating it...`);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: title,
                  },
                },
              },
            ],
          },
        });
        console.log(`Sheet '${title}' created successfully.`);
      }
    } catch (error) {
      console.error("Error checking/creating sheet:", error.message);
      throw error;
    }
  }

  async saveToGoogleSheet() {
    try {
      // Load credentials
      const credentials = JSON.parse(
        await fs.readFile(CREDENTIALS_PATH, "utf8"),
      );

      // Authenticate
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });

      const sheets = google.sheets({ version: "v4", auth });

      const SHEET_NAME = "CreatorHooksData";
      await this.ensureSheetExists(sheets, SHEET_NAME);

      // Prepare data for sheets
      const headers = [
        "Post URL",
        "Title",
        "Framework",
        "Hook Score",
        "Why This Works",
      ];
      const rows = this.allHooks.map((hook) => [
        hook.postUrl,
        hook.title,
        hook.framework,
        hook.hookScore,
        hook.whyThisWorks,
      ]);

      // Clear existing data and write new data
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:E`,
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A1`,
        valueInputOption: "RAW",
        resource: {
          values: [headers, ...rows],
        },
      });

      console.log(
        `\n✓ Successfully saved ${rows.length} hooks to Google Sheet!`,
      );

      // Also save to CSV
      await this.saveToCSV();
    } catch (error) {
      console.error("Error saving to Google Sheet:", error.message);
      await this.saveToCSV();
    }
  }

  async saveToCSV() {
    const headers = "Post URL,Title,Framework,Hook Score,Why This Works\n";
    const rows = this.allHooks
      .map(
        (hook) =>
          `"${hook.postUrl}","${hook.title}","${hook.framework}","${hook.hookScore}","${hook.whyThisWorks.replace(/"/g, '""')}"`,
      )
      .join("\n");

    await fs.writeFile("creator-hooks-data-v2.csv", headers + rows);
    console.log("\n✓ Saved data to creator-hooks-data-v2.csv");
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Main execution
async function main() {
  const scraper = new CreatorHooksScraperLight();

  try {
    console.log("Starting scraper (Cheerio version - lighter and faster)...\n");

    const hooks = await scraper.scrapeAllPages();
    console.log(`\nTotal hooks collected: ${hooks.length}`);

    await scraper.saveToGoogleSheet();
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

main();
