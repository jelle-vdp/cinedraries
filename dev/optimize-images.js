import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const INPUT_DIR = "./img";
const OUTPUT_DIR = "../src/assets/img/";
const SUPPORTED_FORMATS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".svg",
];
const WEBP_QUALITY = 85; // Adjust quality (1-100, higher = better quality)

/**
 * Recursively get all image files from a directory
 */
function getAllImageFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  console.log(`🔍 Scanning directory: ${dir}`);
  console.log(`   Found ${files.length} items: ${files.join(", ")}`);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      console.log(`📁 Entering subdirectory: ${file}`);
      getAllImageFiles(filePath, fileList);
    } else {
      const ext = path.extname(file).toLowerCase();
      console.log(`📄 File: ${file} (extension: ${ext})`);
      if (SUPPORTED_FORMATS.includes(ext)) {
        console.log(`   ✅ Supported format - adding to conversion list`);
        fileList.push(filePath);
      } else {
        console.log(`   ❌ Unsupported format - skipping`);
      }
    }
  });

  return fileList;
}

/**
 * Ensure directory exists, create if it doesn't
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

/**
 * Check if output file needs to be updated (doesn't exist or is older than input)
 */
function needsConversion(inputPath, outputPath) {
  if (!fs.existsSync(outputPath)) {
    return true; // Output doesn't exist, needs conversion
  }

  const inputStats = fs.statSync(inputPath);
  const outputStats = fs.statSync(outputPath);

  // Check if input file is newer than output file
  return inputStats.mtime > outputStats.mtime;
}

/**
 * Convert image to WebP format
 */
async function convertToWebP(inputPath, outputPath) {
  try {
    const inputBuffer = fs.readFileSync(inputPath);

    // Get image metadata to check if it has transparency
    const metadata = await sharp(inputBuffer).metadata();
    const hasAlpha = metadata.channels === 4 || metadata.hasAlpha;

    // Configure WebP options
    const webpOptions = {
      quality: WEBP_QUALITY,
      effort: 6, // Higher effort = better compression (0-6)
    };

    // If image has transparency, preserve it
    if (hasAlpha) {
      webpOptions.lossless = false; // Use lossy compression but preserve alpha
      webpOptions.nearLossless = false;
      webpOptions.alphaQuality = 90; // Quality for alpha channel
    }

    // Convert and save
    await sharp(inputBuffer).webp(webpOptions).toFile(outputPath);

    // Get file sizes for comparison
    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);
    const compressionRatio = (
      ((inputStats.size - outputStats.size) / inputStats.size) *
      100
    ).toFixed(1);

    console.log(`✓ ${path.basename(inputPath)} → ${path.basename(outputPath)}`);
    console.log(
      `  Size: ${(inputStats.size / 1024).toFixed(1)}KB → ${(
        outputStats.size / 1024
      ).toFixed(1)}KB (${compressionRatio}% smaller)`
    );

    return true;
  } catch (error) {
    console.error(`✗ Failed to convert ${inputPath}:`, error.message);
    return false;
  }
}

/**
 * Main conversion function
 */
async function convertImages() {
  console.log("🚀 Starting image conversion to WebP...\n");
  console.log(`📂 Looking for images in: ${path.resolve(INPUT_DIR)}`);
  console.log(`📤 Output directory will be: ${path.resolve(OUTPUT_DIR)}`);
  console.log(`🎯 Supported formats: ${SUPPORTED_FORMATS.join(", ")}\n`);

  // Check if input directory exists
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory "${INPUT_DIR}" does not exist!`);
    console.log(`   Full path: ${path.resolve(INPUT_DIR)}`);
    process.exit(1);
  }

  // Ensure output directory exists
  ensureDirectoryExists(OUTPUT_DIR);

  // Get all image files
  const imageFiles = getAllImageFiles(INPUT_DIR);

  if (imageFiles.length === 0) {
    console.log("📭 No supported image files found in the input directory.");
    return;
  }

  // Filter files that need conversion
  const filesToProcess = [];
  const skippedFiles = [];

  for (const inputPath of imageFiles) {
    // Calculate relative path from input directory
    const relativePath = path.relative(INPUT_DIR, inputPath);
    const parsedPath = path.parse(relativePath);

    // Create output path with .webp extension
    const outputRelativePath = path.join(
      parsedPath.dir,
      parsedPath.name + ".webp"
    );
    const outputPath = path.join(OUTPUT_DIR, outputRelativePath);

    if (needsConversion(inputPath, outputPath)) {
      filesToProcess.push({ inputPath, outputPath });
    } else {
      skippedFiles.push(inputPath);
    }
  }

  console.log(`📋 Found ${imageFiles.length} image(s) total:`);
  console.log(`📝 ${filesToProcess.length} file(s) need conversion`);
  console.log(
    `⏭️  ${skippedFiles.length} file(s) already up-to-date (skipped)\n`
  );

  if (skippedFiles.length > 0) {
    console.log("⏭️  Skipped files (already converted and up-to-date):");
    skippedFiles.forEach((file) => {
      console.log(`   • ${path.relative(INPUT_DIR, file)}`);
    });
    console.log("");
  }

  if (filesToProcess.length === 0) {
    console.log("✨ All images are already converted and up-to-date!");
    return;
  }

  console.log("🔄 Converting files:\n");

  let successCount = 0;
  let failureCount = 0;

  // Process each image that needs conversion
  for (const { inputPath, outputPath } of filesToProcess) {
    // Ensure output subdirectory exists
    const outputDir = path.dirname(outputPath);
    ensureDirectoryExists(outputDir);

    // Convert the image
    const success = await convertToWebP(inputPath, outputPath);

    if (success) {
      successCount++;
    } else {
      failureCount++;
    }

    console.log(""); // Add spacing between files
  }

  // Summary
  console.log("📊 Conversion Summary:");
  console.log(`✅ Successfully converted: ${successCount} files`);
  if (failureCount > 0) {
    console.log(`❌ Failed conversions: ${failureCount} files`);
  }
  console.log(`📁 Output directory: ${path.resolve(OUTPUT_DIR)}`);

  console.log("\n🎉 Image conversion completed!");
}

// Handle uncaught errors
process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});

// Check if sharp is installed
try {
  await import("sharp");
} catch (error) {
  console.error("❌ Sharp library not found!");
  console.log("📦 Please install it by running: npm install sharp");
  process.exit(1);
}

// Run the conversion
convertImages().catch((error) => {
  console.error("❌ Conversion failed:", error);
  process.exit(1);
});
