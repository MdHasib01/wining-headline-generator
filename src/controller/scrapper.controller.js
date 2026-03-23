import "dotenv/config";
import { runScraper } from "../services/scraper.js";

runScraper()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
