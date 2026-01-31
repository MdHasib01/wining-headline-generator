const axios = require("axios");
const cheerio = require("cheerio");

// Test script to verify scraping logic on a single post
async function testSinglePost() {
  const testUrl =
    "https://creatorhooks.com/5-minutes-only-read-this-before-you-publish-your-next-video/";

  console.log("Testing scraper on single post...");
  console.log(`URL: ${testUrl}\n`);

  try {
    const response = await axios.get(testUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const $ = cheerio.load(response.data);
    const hooks = [];
    const content = $(".entry-content");

    if (!content.length) {
      console.error("❌ Could not find .entry-content");
      return;
    }

    console.log("✓ Found content section\n");

    content.find("h1, h2").each((index, heading) => {
      if (index === 0) return; // Skip main title

      const $heading = $(heading);
      const sectionTitle = $heading.text().trim();

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

      let $next = $heading.next();

      while ($next.length && !["H1", "H2"].includes($next.prop("tagName"))) {
        const text = $next.text().trim();

        if (text.match(/^Title:/i)) {
          extractedTitle = text.replace(/^Title:/i, "").trim();
        }

        if (text.match(/^Framework:/i)) {
          framework = text.replace(/^Framework:/i, "").trim();
        }

        if (text.match(/Hook score/i)) {
          const scoreMatch = text.match(/[+\-]?\d+/);
          if (scoreMatch) {
            hookScore = scoreMatch[0];
          }
        }

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
          sectionTitle,
          framework,
          hookScore,
          whyThisWorks: whyThisWorks.trim(),
        });
      }
    });

    console.log(`Found ${hooks.length} hooks:\n`);

    hooks.forEach((hook, i) => {
      console.log(`--- Hook ${i + 1} ---`);
      console.log(`Title: ${hook.title}`);
      console.log(`Section: ${hook.sectionTitle}`);
      console.log(`Framework: ${hook.framework}`);
      console.log(`Hook Score: ${hook.hookScore}`);
      console.log(`Why This Works: ${hook.whyThisWorks.substring(0, 100)}...`);
      console.log("");
    });

    console.log("✓ Test completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

testSinglePost();
