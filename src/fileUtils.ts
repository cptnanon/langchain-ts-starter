import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Function to get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to read the file content
export function readFileContent(filePath: string): string {
  try {
    const fullPath = path.join(__dirname, filePath);
    const data = fs.readFileSync(fullPath, "utf-8");
    return data;
  } catch (err) {
    console.error("Error reading the file:", err);
    return "";
  }
}
