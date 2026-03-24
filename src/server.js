import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { runScraper } from "./services/scraper.js";
import ragRoutes from "./routes/rag.js";

const PORT = process.env.PORT || 3000;

const app = express();

app.use(express.json());

app.use("/api/rag", ragRoutes);

app.get("/", (req, res) => {
  res.send("graytor hooks api");
});

let isScraping = false;

app.post("/scrape", async (req, res) => {
  if (isScraping) {
    return res.status(409).json({ status: "scraper already running" });
  }

  isScraping = true;
  res.status(202).json({ status: "scraper started" });

  (async () => {
    try {
      await runScraper();
      console.log("Manual scrape completed.");
    } catch (err) {
      console.error("Manual scrape error:", err);
    } finally {
      isScraping = false;
    }
  })();
});

app.listen(PORT, () => {
  console.log(`Graytor Hooks API running on port ${PORT}`);

  // Run scraper every day at midnight
  cron.schedule("0 0 * * *", async () => {
    if (isScraping) {
      console.log("Scraper already running, skipping cron run.");
      return;
    }

    isScraping = true;
    console.log("Running daily scraper...");
    try {
      await runScraper();
      console.log("Daily scrape completed.");
    } catch (err) {
      console.error("Scraper error:", err);
    } finally {
      isScraping = false;
    }
  });
});
