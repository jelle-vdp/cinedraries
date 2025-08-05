import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const INPUT_DIR = "./vid";
const OUTPUT_DIR = "../src/assets/img/";
const OUTPUT_FILENAME = "firstframe.webp";
const SUPPORTED_FORMATS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".m4v",
  ".flv",
  ".wmv",
];
const WEBP_QUALITY = 85;
const TARGET_WIDTH = 1920;

/**
 * Check if FFmpeg is available
 */
function checkFFmpeg() {
  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", ["-version"]);
    ffmpeg.on("error", () => resolve(false));
    ffmpeg.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Get video information using FFprobe
 */
function getVideoInfo(inputPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      inputPath,
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(output);
          const videoStream = info.streams.find(
            (stream) => stream.codec_type === "video"
          );
          resolve({
            format: info.format,
            video: videoStream,
            duration: parseFloat(info.format.duration),
            size: parseInt(info.format.size),
            width: videoStream ? videoStream.width : 0,
            height: videoStream ? videoStream.height : 0,
            fps: videoStream ? eval(videoStream.r_frame_rate) : 30,
          });
        } catch (error) {
          reject(new Error(`Failed to parse video info: ${error.message}`));
        }
      } else {
        reject(new Error(`FFprobe failed with code ${code}`));
      }
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`FFprobe error: ${error.message}`));
    });
  });
}

/**
 * Find the first video file in the directory (recursively)
 */
function findFirstVideoFile(dir) {
  const files = fs.readdirSync(dir);

  // First, look for video files in current directory
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isFile()) {
      const ext = path.extname(file).toLowerCase();
      if (SUPPORTED_FORMATS.includes(ext)) {
        return filePath;
      }
    }
  }

  // If no video files found, check subdirectories
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const found = findFirstVideoFile(filePath);
      if (found) return found;
    }
  }

  return null;
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
 * Check if output file needs to be updated
 */
function needsExtraction(inputPath, outputPath) {
  if (!fs.existsSync(outputPath)) {
    return true;
  }

  const inputStats = fs.statSync(inputPath);
  const outputStats = fs.statSync(outputPath);

  return inputStats.mtime > outputStats.mtime;
}

/**
 * Extract first frame from video and convert to WebP
 */
function extractFirstFrame(inputPath, outputPath, videoInfo) {
  return new Promise((resolve, reject) => {
    console.log(`🎬 Extracting first frame from: ${path.basename(inputPath)}`);
    console.log(
      `   Video: ${videoInfo.width}x${
        videoInfo.height
      }, ${videoInfo.duration.toFixed(1)}s`
    );

    // Calculate target height maintaining aspect ratio
    const aspectRatio = videoInfo.width / videoInfo.height;
    const targetHeight = Math.round(TARGET_WIDTH / aspectRatio);

    // Build FFmpeg arguments
    const ffmpegArgs = [
      "-i",
      inputPath,

      // Extract only the first frame
      "-vframes",
      "1",

      // Skip to 0.1 seconds to avoid potential black frames at the very start
      "-ss",
      "0.1",

      // Scale to target width
      "-vf",
      `scale=${TARGET_WIDTH}:${targetHeight}:flags=lanczos`,

      // WebP output settings
      "-c:v",
      "libwebp",
      "-quality",
      WEBP_QUALITY.toString(),
      "-preset",
      "photo",
      "-lossless",
      "0",

      // Remove metadata
      "-map_metadata",
      "-1",

      // Overwrite output file
      "-y",

      outputPath,
    ];

    console.log(`   Target: ${TARGET_WIDTH}x${targetHeight} WebP`);
    console.log(`   Quality: ${WEBP_QUALITY}%`);

    const startTime = Date.now();
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let errorOutput = "";

    ffmpeg.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        // Get output file size
        if (fs.existsSync(outputPath)) {
          const outputStats = fs.statSync(outputPath);

          console.log(`   ✅ Extracted in ${duration}s`);
          console.log(`   📦 Size: ${(outputStats.size / 1024).toFixed(1)}KB`);
          console.log(`   💾 Saved as: ${OUTPUT_FILENAME}`);
          resolve(true);
        } else {
          console.log(`   ❌ Output file was not created`);
          resolve(false);
        }
      } else {
        console.log(`   ❌ FFmpeg failed with code ${code}`);
        if (errorOutput) {
          console.log(`   Error details: ${errorOutput.slice(-300)}`);
        }
        resolve(false);
      }
    });

    ffmpeg.on("error", (error) => {
      console.log(`   ❌ FFmpeg process error: ${error.message}`);
      resolve(false);
    });
  });
}

/**
 * Main extraction function
 */
async function extractVideoThumbnail() {
  console.log("🖼️  Starting first frame extraction from showreel...\n");
  console.log(`📂 Looking for videos in: ${path.resolve(INPUT_DIR)}`);
  console.log(
    `📤 Output will be saved to: ${path.resolve(OUTPUT_DIR, OUTPUT_FILENAME)}`
  );
  console.log(`🎯 Supported formats: ${SUPPORTED_FORMATS.join(", ")}`);
  console.log(`📐 Target resolution: ${TARGET_WIDTH}px width\n`);

  // Check if FFmpeg is available
  console.log("🔧 Checking FFmpeg availability...");
  const hasFFmpeg = await checkFFmpeg();
  if (!hasFFmpeg) {
    console.error("❌ FFmpeg is not installed or not available in PATH!");
    console.log(
      "📦 Please install FFmpeg from https://ffmpeg.org/download.html"
    );
    process.exit(1);
  }
  console.log("✅ FFmpeg is available\n");

  // Check if input directory exists
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory "${INPUT_DIR}" does not exist!`);
    console.log(`   Full path: ${path.resolve(INPUT_DIR)}`);
    process.exit(1);
  }

  // Find the first video file
  console.log("🔍 Searching for video files...");
  const videoFile = findFirstVideoFile(INPUT_DIR);

  if (!videoFile) {
    console.log("📭 No supported video files found in the input directory.");
    console.log(
      `   Make sure you have video files with these extensions: ${SUPPORTED_FORMATS.join(
        ", "
      )}`
    );
    return;
  }

  console.log(`📹 Found video: ${path.relative(INPUT_DIR, videoFile)}\n`);

  // Ensure output directory exists
  ensureDirectoryExists(OUTPUT_DIR);

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILENAME);

  // Check if we need to extract (file doesn't exist or video is newer)
  if (!needsExtraction(videoFile, outputPath)) {
    console.log(`⏭️  First frame already extracted and up-to-date!`);
    console.log(`   File: ${outputPath}`);
    return;
  }

  try {
    // Get video information
    console.log("📊 Analyzing video...");
    const videoInfo = await getVideoInfo(videoFile);
    console.log("");

    // Extract the first frame
    const success = await extractFirstFrame(videoFile, outputPath, videoInfo);

    if (success) {
      console.log("\n🎉 First frame extraction completed successfully!");
      console.log(`📁 Output file: ${path.resolve(outputPath)}`);
      console.log("\n💡 Usage in Astro:");
      console.log('   import firstFrame from "../assets/img/firstframe.webp";');
      console.log('   <Image src={firstFrame} alt="Showreel preview" />');
    } else {
      console.log("\n❌ First frame extraction failed!");
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error processing video: ${error.message}`);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});

// Run the extraction
extractVideoThumbnail().catch((error) => {
  console.error("❌ Extraction failed:", error);
  process.exit(1);
});
