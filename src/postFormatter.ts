import { chaoticMonkPosts } from "./data/chaoticmonk.ts";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

console.log(chaoticMonkPosts.length);

function formatObject(obj: any): string {
  return `URL: ${obj.url}\nContent: ${obj.content}\nContent Type: ${obj.main_content_focus}\nTimestamp: ${obj.timestamp}`;
}

const separator = "\n\n##$$$##\n\n";
const formattedText = chaoticMonkPosts.map(formatObject).join(separator);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.join(__dirname, "output.txt");

fs.writeFile(outputPath, formattedText, "utf-8", (err) => {
  if (err) {
    console.error("Error writing to the file:", err);
    return;
  }
  console.log("File has been written successfully.");
});
