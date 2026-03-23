import "dotenv/config";
import puppeteer from "puppeteer";
import { google } from "googleapis";

const SPREADSHEET_ID =
  process.env.GOOGLE_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_ID;

// Keep the same tab name used by this scraper. You can override explicitly.
const SHEET_NAME = process.env.GOOGLE_HOOKS_SHEET_NAME || "CreatorHooksData";

// Configure global options for the googleapis client
// This helps with timeouts and retries on both auth and data requests
google.options({
  timeout: 60000, // 60 seconds
  retry: true,
  retryConfig: {
    retry: 3,
    retryDelay: 2000,
    httpMethodsToRetry: ["GET", "POST", "PUT", "HEAD", "OPTIONS", "DELETE"],
    statusCodesToRetry: [
      [100, 199],
      [408, 408],
      [429, 429],
      [500, 599],
    ],
    onRetryAttempt: (err) => {
      console.log(`Retry attempt for Google API... ${err.message}`);
    },
  },
});

function getGoogleCredentialsFromEnv() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const privateKeyId = process.env.GOOGLE_PRIVATE_KEY_ID;
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!privateKey || !clientEmail || !projectId || !privateKeyId || !clientId) {
    throw new Error(
      "Missing Google service account env vars. Required: GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_PRIVATE_KEY_ID, GOOGLE_PRIVATE_KEY",
    );
  }

  // dotenv loads `\n` as two characters by default; convert to real newlines.
  const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");

  return {
    type: "service_account",
    project_id: projectId,
    client_email: clientEmail,
    client_id: clientId,
    private_key_id: privateKeyId,
    private_key: normalizedPrivateKey,
  };
}

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

      const postUrls = await page.evaluate(() => {
        const articles = document.querySelectorAll("article h2.entry-title a");
        return Array.from(articles).map((a) => a.href);
      });

      console.log(`Found ${postUrls.length} posts on page ${pageNumber}`);

      const hasNextPage = await page.evaluate(() => {
        const nextLink = document.querySelector(".nav-previous a");
        if (nextLink) return true;
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
        const content = document.querySelector(".entry-content");
        if (!content) return hooks;

        const headings = content.querySelectorAll("h1, h2");

        headings.forEach((heading, index) => {
          if (index === 0) return;

          const hookTitle = heading.textContent.trim();
          if (hookTitle.includes("Creator Hooks Pro")) return;

          let nextElement = heading.nextElementSibling;
          let framework = "";
          let hookScore = "";
          let analysis = "";
          let collectingWhy = false;
          let extractedTitle = "";

          while (nextElement && !["H1", "H2"].includes(nextElement.tagName)) {
            const text = nextElement.textContent.trim();

            if (text.match(/^Title:/i)) {
              extractedTitle = text.replace(/^Title:/i, "").trim();
            }
            if (text.match(/^Framework:/i)) {
              framework = text.replace(/^Framework:/i, "").trim();
            }
            if (text.match(/Hook score/i)) {
              const scoreMatch = text.match(/[+\-]?\d+/);
              if (scoreMatch) hookScore = scoreMatch[0];
            }
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

    this.browser.on("targetcreated", async (target) => {
      const page = await target.page();
      if (page) {
        page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
      }
    });

    while (hasMorePages) {
      const { postUrls, hasNextPage } =
        await this.scrapeListingPage(currentPage);

      if (postUrls.length === 0) break;

      allPostUrls.push(...postUrls);
      hasMorePages = hasNextPage;
      currentPage++;
      await this.delay(1000);
    }

    for (let i = 0; i < allPostUrls.length; i++) {
      console.log(`Processing post ${i + 1}/${allPostUrls.length}`);
      const hooks = await this.scrapePost(allPostUrls[i]);
      hooks.forEach((hook) => {
        this.allHooks.push({ postUrl: allPostUrls[i], ...hook });
      });
      await this.delay(1500);
    }

    return this.allHooks;
  }

  async ensureSheetExists(sheets, title) {
    let retries = 3;
    while (retries > 0) {
      try {
        console.log(`Checking if sheet "${title}" exists...`);
        const response = await sheets.spreadsheets.get({
          spreadsheetId: SPREADSHEET_ID,
        });
        const sheetExists = response.data.sheets.some(
          (sheet) => sheet.properties.title === title,
        );

        if (!sheetExists) {
          console.log(`Sheet "${title}" not found, creating it...`);
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
              requests: [{ addSheet: { properties: { title } } }],
            },
          });
          console.log(`Sheet "${title}" created successfully.`);
        } else {
          console.log(`Sheet "${title}" already exists.`);
        }
        return; // Success, exit retry loop
      } catch (error) {
        retries--;
        console.error(
          `Error checking/creating sheet (Retries left: ${retries}):`,
          error.message,
        );
        if (retries === 0) throw error;
        await this.delay(2000); // Wait before retrying
      }
    }
  }

  async getSheetsClient() {
    try {
      const credentials = getGoogleCredentialsFromEnv();
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });

      return google.sheets({ version: "v4", auth });
    } catch (error) {
      console.error("Error initializing Google Sheets client:", error.message);
      throw error;
    }
  }

  async getExistingRows(sheets) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A2:D`,
      });
      return res.data.values || [];
    } catch {
      return [];
    }
  }

  async saveToGoogleSheet() {
    if (!SPREADSHEET_ID) {
      throw new Error(
        "GOOGLE_SPREADSHEET_ID (or GOOGLE_SHEETS_ID) is not set in .env",
      );
    }

    const sheets = await this.getSheetsClient();
    await this.ensureSheetExists(sheets, SHEET_NAME);

    const existingRows = await this.getExistingRows(sheets);
    const existingKeys = new Set(
      existingRows.map(
        (row) => `${row[0] || ""}|${row[1] || ""}|${row[3] || ""}`,
      ),
    );

    const headers = ["Title", "Framework", "Hook Score", "Why"];
    const newRows = this.allHooks.filter((hook) => {
      const key = `${hook.title}|${hook.framework}|${hook.why}`;
      return !existingKeys.has(key);
    });

    if (newRows.length === 0) {
      console.log("No new hooks to add.");
      return;
    }

    if (existingRows.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A1`,
        valueInputOption: "RAW",
        resource: {
          values: [
            headers,
            ...newRows.map((h) => [h.title, h.framework, h.hookScore, h.why]),
          ],
        },
      });
    } else {
      const nextRow = existingRows.length + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A${nextRow}`,
        valueInputOption: "RAW",
        resource: {
          values: newRows.map((h) => [
            h.title,
            h.framework,
            h.hookScore,
            h.why,
          ]),
        },
      });
    }

    console.log(`Added ${newRows.length} new hooks to Google Sheet.`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}

async function runScraper() {
  const scraper = new CreatorHooksScraper();
  try {
    await scraper.initialize();
    await scraper.scrapeAllPages();
    await scraper.saveToGoogleSheet();
  } finally {
    await scraper.close();
  }
}

export { CreatorHooksScraper, runScraper };
