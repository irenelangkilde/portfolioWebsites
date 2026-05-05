const { chromium } = require("playwright");
const path = require("path");

const filePath = path.resolve("input.html");
await page.goto(`file://${filePath}`);
