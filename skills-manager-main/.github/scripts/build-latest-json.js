import fs from "node:fs";
import path from "node:path";

const [tagName, repoSlug, artifactsDir, outFile] = process.argv.slice(2);

if (!tagName || !repoSlug || !artifactsDir || !outFile) {
  console.error("Usage: node build-latest-json.js <tagName> <repoSlug> <artifactsDir> <outFile>");
  process.exit(1);
}

const version = tagName.replace(/^v/, "");

const targetMap = {
  "aarch64-apple-darwin": "darwin-aarch64",
  "x86_64-apple-darwin": "darwin-x86_64",
  "x86_64-pc-windows-msvc": "windows-x86_64",
  "x86_64-unknown-linux-gnu": "linux-x86_64"
};

const platformPreferences = {
  "darwin-aarch64": [".app.tar.gz", ".dmg"],
  "darwin-x86_64": [".app.tar.gz", ".dmg"],
  "windows-x86_64": [".msi", ".exe"],
  "linux-x86_64": [".AppImage", ".deb", ".rpm"]
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function matchesSuffix(filePath, suffix) {
  return filePath.endsWith(suffix);
}

const groupedFiles = new Map();

for (const filePath of walk(artifactsDir)) {
  const baseName = path.basename(filePath);
  const [targetTriple] = baseName.split("__");
  if (!targetTriple || !targetMap[targetTriple]) continue;

  if (!groupedFiles.has(targetTriple)) {
    groupedFiles.set(targetTriple, []);
  }
  groupedFiles.get(targetTriple).push(filePath);
}

const platforms = {};

for (const [targetTriple, files] of groupedFiles.entries()) {
  const platformKey = targetMap[targetTriple];
  const preferences = platformPreferences[platformKey] ?? [];

  const candidates = files.filter((filePath) => !filePath.endsWith(".sig"));
  let selectedAsset = null;

  for (const suffix of preferences) {
    selectedAsset = candidates.find((filePath) => matchesSuffix(filePath, suffix)) ?? null;
    if (selectedAsset) break;
  }

  if (!selectedAsset) {
    console.error(`No updater candidate found for ${targetTriple}`);
    process.exit(1);
  }

  const signaturePath = `${selectedAsset}.sig`;
  if (!fs.existsSync(signaturePath)) {
    console.error(`Missing signature for ${selectedAsset}`);
    process.exit(1);
  }

  platforms[platformKey] = {
    signature: fs.readFileSync(signaturePath, "utf8").trim(),
    url: `https://github.com/${repoSlug}/releases/download/${tagName}/${path.basename(selectedAsset)}`
  };
}

const latest = {
  version,
  notes: "Automated release.",
  pub_date: new Date().toISOString(),
  platforms
};

fs.writeFileSync(outFile, JSON.stringify(latest, null, 2) + "\n");
console.log(`Generated ${outFile}`);
