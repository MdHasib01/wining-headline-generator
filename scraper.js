const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const fs = require("fs").promises;

// Google Sheets configuration
const SPREADSHEET_ID = "1hdzFosH2FlouVSEcNa8skjjsAGGPQtwtyVfgYZMSjMg"; // Replace with your Google Sheet ID
const CREDENTIALS_PATH = "./credentials.json"; // Path to your service account credentials

class CreatorHooksScraper {
  constructor() {
    this.baseUrl = "https://creatorhooks.com/past-creator-hooks-newsletters/";
    this.allHooks = [];
    this.browser = null;
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  async scrapeListingPage(pageNumber = 1) {
    const page = await this.browser.newPage();
    const url =
      pageNumber === 1 ? this.baseUrl : `${this.baseUrl}page/${pageNumber}/`;

    console.log(`Scraping listing page ${pageNumber}: ${url}`);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      // Extract post URLs
      const postUrls = await page.evaluate(() => {
        const articles = document.querySelectorAll("article h2.entry-title a");
        return Array.from(articles).map((a) => a.href);
      });

      console.log(`Found ${postUrls.length} posts on page ${pageNumber}`);

      // Check if there's a next page
      const hasNextPage = await page.evaluate(() => {
        const nextLink = document.querySelector(".nav-previous a");
        if (nextLink) return true;

        // Fallback: look for any link with "Next" text
        const allLinks = Array.from(document.querySelectorAll("a"));
        return allLinks.some((link) => link.textContent.includes("Next"));
      });

      await page.close();
      return { postUrls, hasNextPage };
    } catch (error) {
      console.error(
        `Error scraping listing page ${pageNumber}:`,
        error.message,
      );
      await page.close();
      return { postUrls: [], hasNextPage: false };
    }
  }

  async scrapePost(url) {
    const page = await this.browser.newPage();
    console.log(`Scraping post: ${url}`);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      const postData = await page.evaluate(() => {
        const hooks = [];

        // Find all sections with titles and frameworks
        const content = document.querySelector(".entry-content");
        if (!content) {
          console.log("No .entry-content found!");
          return hooks;
        }

        // Look for patterns in the content
        const headings = content.querySelectorAll("h1, h2");
        console.log(`Found ${headings.length} headings`);

        headings.forEach((heading, index) => {
          // Skip the main title and look for hook sections
          if (index === 0) return;

          const hookTitle = heading.textContent.trim();

          // Skip advertisement sections
          if (hookTitle.includes("Creator Hooks Pro")) {
            return;
          }

          // Get all content until next heading
          let nextElement = heading.nextElementSibling;
          let framework = "";
          let hookScore = "";
          let analysis = "";
          let collectingWhy = false;
          let extractedTitle = "";

          while (nextElement && !["H1", "H2"].includes(nextElement.tagName)) {
            const text = nextElement.textContent.trim();

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

            // Extract Why this works or Why this flopped
            if (text.startsWith("Why this works:")) {
              collectingWhy = true;
              analysis = text.replace("Why this works:", "").trim();
            } else if (text.startsWith("Why this flopped:")) {
              collectingWhy = true;
              analysis = text.replace("Why this flopped:", "").trim();
            } else if (collectingWhy && text.startsWith("How you can use")) {
              collectingWhy = false;
            } else if (
              collectingWhy &&
              text.length > 0 &&
              !text.startsWith("Examples of")
            ) {
              analysis += " " + text;
            }

            nextElement = nextElement.nextElementSibling;
          }

          if (framework || hookScore || analysis) {
            hooks.push({
              title: extractedTitle || hookTitle,
              sectionTitle: hookTitle,
              framework: framework,
              hookScore: hookScore,
              why: analysis.trim(),
            });
          }
        });

        return hooks;
      });

      await page.close();
      return postData;
    } catch (error) {
      console.error(`Error scraping post ${url}:`, error.message);
      await page.close();
      return [];
    }
  }

  async scrapeAllPages() {
    let currentPage = 1;
    let hasMorePages = true;
    const allPostUrls = [];

    // Enable console logging from inside page.evaluate
    this.browser.on("targetcreated", async (target) => {
      const page = await target.page();
      if (page) {
        page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
      }
    });

    while (hasMorePages) {
      const { postUrls, hasNextPage } =
        await this.scrapeListingPage(currentPage);

      if (postUrls.length === 0) {
        console.log(`No posts found on page ${currentPage}. Stopping.`);
        break;
      }

      allPostUrls.push(...postUrls);
      hasMorePages = hasNextPage;

      if (!hasMorePages) {
        console.log(
          `No next page detected after page ${currentPage}. Stopping.`,
        );
      }

      currentPage++;

      // Be respectful with rate limiting
      await this.delay(1000);
    }

    console.log(`\nTotal posts found: ${allPostUrls.length}`);

    // Now scrape each post
    for (let i = 0; i < allPostUrls.length; i++) {
      console.log(`\nProcessing post ${i + 1}/${allPostUrls.length}`);
      const hooks = await this.scrapePost(allPostUrls[i]);

      hooks.forEach((hook) => {
        this.allHooks.push({
          postUrl: allPostUrls[i],
          ...hook,
        });
      });

      // Rate limiting
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
      const headers = ["Title", "Framework", "Hook Score", "Why"];
      const rows = this.allHooks.map((hook) => [
        hook.title,
        hook.framework,
        hook.hookScore,
        hook.why,
      ]);

      // Clear existing data and write new data
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:D`,
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
      console.log(
        `View your sheet here: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
      );

      // Also save to CSV
      await this.saveToCSV();
    } catch (error) {
      console.error("Error saving to Google Sheet:", error.message);
      // Fallback: save to CSV
      await this.saveToCSV();
    }
  }

  async saveToCSV() {
    try {
      const headers = "Title,Framework,Hook Score,Why\n";
      const rows = this.allHooks
        .map(
          (hook) =>
            `"${hook.title}","${hook.framework}","${hook.hookScore}","${hook.why}"`,
        )
        .join("\n");

      await fs.writeFile("creator-hooks-data-v2.csv", headers + rows);
      console.log("\n✓ Saved data to creator-hooks-data-v2.csv");
    } catch (error) {
      if (error.code === "EBUSY") {
        console.warn(
          "\n⚠️  Warning: Could not save CSV file because it is open in another program.",
        );
        console.warn(
          "Please close 'creator-hooks-data-v2.csv' and try again if you need the CSV output.",
        );
      } else {
        console.error("\n❌ Error saving CSV:", error.message);
      }
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Main execution
async function main() {
  const scraper = new CreatorHooksScraper();

  try {
    await scraper.initialize();
    console.log("Starting scraper...\n");

    const hooks = await scraper.scrapeAllPages();
    console.log(`\nTotal hooks collected: ${hooks.length}`);

    await scraper.saveToGoogleSheet();
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await scraper.close();
  }
}

main();
