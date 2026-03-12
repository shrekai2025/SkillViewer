import fs from "node:fs";
import path from "node:path";

const [bundleDir, targetTriple, outputDir] = process.argv.slice(2);

if (!bundleDir || !targetTriple || !outputDir) {
  console.error("Usage: node stage-release-assets.js <bundleDir> <targetTriple> <outputDir>");
  process.exit(1);
}

const allowedSuffixes = [
  ".app.tar.gz",
  ".dmg",
  ".msi",
  ".exe",
  ".AppImage",
  ".deb",
  ".rpm"
];

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

function isAsset(filePath) {
  return allowedSuffixes.some((suffix) => filePath.endsWith(suffix));
}

fs.mkdirSync(outputDir, { recursive: true });

const assets = walk(bundleDir).filter(isAsset);
if (assets.length === 0) {
  console.error(`No release assets found in ${bundleDir}`);
  process.exit(1);
}

for (const assetPath of assets) {
  const baseName = `${targetTriple}__${path.basename(assetPath)}`;
  const stagedAssetPath = path.join(outputDir, baseName);
  fs.copyFileSync(assetPath, stagedAssetPath);

  const signaturePath = `${assetPath}.sig`;
  if (fs.existsSync(signaturePath)) {
    fs.copyFileSync(signaturePath, `${stagedAssetPath}.sig`);
  }
}

console.log(`Staged ${assets.length} assets for ${targetTriple}`);
