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
const OUTPUT_BASE_FILENAME = "firstframe"; // Base filename without extension
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
function needsExtraction(inputPath, outputDir) {
  // Check if any file with the base filename exists in the output directory
  if (!fs.existsSync(outputDir)) {
    return true;
  }

  const files = fs.readdirSync(outputDir);
  const existingFiles = files.filter(
    (file) => file.startsWith(OUTPUT_BASE_FILENAME) && file.endsWith(".webp")
  );

  if (existingFiles.length === 0) {
    return true; // No existing files, needs extraction
  }

  // Check if input is newer than any existing files
  const inputStats = fs.statSync(inputPath);

  for (const file of existingFiles) {
    const filePath = path.join(outputDir, file);
    const fileStats = fs.statSync(filePath);

    if (inputStats.mtime <= fileStats.mtime) {
      console.log(`   ⏭️  Found existing frame: ${file} (up-to-date)`);
      return false; // At least one file is up-to-date
    }
  }

  return true; // All existing files are older than input
}

/**
 * Analyze motion between consecutive frames to find stable frames
 */
function analyzeMotion(inputPath, startTime, endTime, videoInfo) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, "temp_frames");
    ensureDirectoryExists(tempDir);

    console.log(`   🔍 Analyzing motion from ${startTime}s to ${endTime}s...`);

    // Extract frames for motion analysis (low quality, small size for speed)
    const ffmpegArgs = [
      "-i",
      inputPath,
      "-ss",
      startTime.toString(),
      "-t",
      (endTime - startTime).toString(),
      "-vf",
      "scale=320:240,fps=2", // Low res, 2 fps for analysis
      "-q:v",
      "10", // Low quality for speed
      "-y",
      path.join(tempDir, "frame_%03d.jpg"),
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let errorOutput = "";
    ffmpeg.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code === 0) {
        try {
          // Analyze extracted frames for motion
          const frameFiles = fs
            .readdirSync(tempDir)
            .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
            .sort();

          if (frameFiles.length < 2) {
            // Clean up and fallback
            fs.rmSync(tempDir, { recursive: true, force: true });
            resolve(startTime + 0.5); // Fallback to middle of range
            return;
          }

          const motionScores = [];

          // Calculate motion between consecutive frames
          for (let i = 1; i < frameFiles.length; i++) {
            const prevFrame = path.join(tempDir, frameFiles[i - 1]);
            const currFrame = path.join(tempDir, frameFiles[i]);

            const motionScore = await calculateFrameDifference(
              prevFrame,
              currFrame
            );
            const timestamp = startTime + i * 0.5; // 0.5s intervals at 2fps

            motionScores.push({ timestamp, score: motionScore, frameIndex: i });
          }

          // Find frame with lowest motion score (most stable)
          const stableFrame = motionScores.reduce((min, current) =>
            current.score < min.score ? current : min
          );

          console.log(
            `   📊 Analyzed ${motionScores.length} frame transitions`
          );
          console.log(
            `   🎯 Most stable frame found at ${
              stableFrame.timestamp
            }s (motion score: ${stableFrame.score.toFixed(2)})`
          );

          // Clean up temporary files
          fs.rmSync(tempDir, { recursive: true, force: true });

          resolve(stableFrame.timestamp);
        } catch (error) {
          // Clean up and fallback
          fs.rmSync(tempDir, { recursive: true, force: true });
          reject(error);
        }
      } else {
        // Clean up and fallback
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`   ⚠️  Motion analysis failed, using fallback timestamp`);
        resolve(startTime + 1); // Fallback
      }
    });

    ffmpeg.on("error", (error) => {
      // Clean up and fallback
      fs.rmSync(tempDir, { recursive: true, force: true });
      reject(error);
    });
  });
}

/**
 * Calculate difference between two frames using FFmpeg
 */
function calculateFrameDifference(frame1Path, frame2Path) {
  return new Promise((resolve, reject) => {
    // Use FFmpeg to calculate SSIM (structural similarity) between frames
    // Lower SSIM = more difference/motion
    const ffmpegArgs = [
      "-i",
      frame1Path,
      "-i",
      frame2Path,
      "-lavfi",
      "[0:v][1:v]ssim=stats_file=-",
      "-f",
      "null",
      "-",
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let output = "";
    ffmpeg.stderr.on("data", (data) => {
      output += data.toString();
    });

    ffmpeg.on("close", (code) => {
      try {
        // Extract SSIM score from output
        const ssimMatch = output.match(/All:([0-9.]+)/);
        if (ssimMatch) {
          const ssim = parseFloat(ssimMatch[1]);
          const motionScore = 1 - ssim; // Convert to motion score (higher = more motion)
          resolve(motionScore);
        } else {
          resolve(0.5); // Fallback score
        }
      } catch (error) {
        resolve(0.5); // Fallback score
      }
    });

    ffmpeg.on("error", () => {
      resolve(0.5); // Fallback score
    });
  });
}

/**
 * Extract stable frame from video and convert to WebP
 */
async function extractStableFrame(inputPath, outputPath, videoInfo) {
  console.log(`🎬 Finding stable frame from: ${path.basename(inputPath)}`);
  console.log(
    `   Video: ${videoInfo.width}x${
      videoInfo.height
    }, ${videoInfo.duration.toFixed(1)}s`
  );

  try {
    // Analyze the first 10 seconds (or entire video if shorter) for stable frames
    const analysisEndTime = Math.min(10, videoInfo.duration * 0.3); // First 30% or 10s max
    const stableTimestamp = await analyzeMotion(
      inputPath,
      0.5,
      analysisEndTime,
      videoInfo
    );

    console.log(`   ⏱️  Selected timestamp: ${stableTimestamp.toFixed(1)}s`);

    // Create filename with timestamp
    const timestampFormatted = stableTimestamp.toFixed(1).replace(".", "-"); // 4.2 becomes 4-2
    const outputFilename = `${OUTPUT_BASE_FILENAME}--${timestampFormatted}s.webp`;
    const finalOutputPath = path.join(path.dirname(outputPath), outputFilename);

    // Calculate target height maintaining aspect ratio
    const aspectRatio = videoInfo.width / videoInfo.height;
    const targetHeight = Math.round(TARGET_WIDTH / aspectRatio);

    // Build FFmpeg arguments for final extraction
    const ffmpegArgs = [
      "-i",
      inputPath,

      // Extract frame at the stable timestamp
      "-vframes",
      "1",
      "-ss",
      stableTimestamp.toString(),

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

      finalOutputPath,
    ];

    console.log(`   Target: ${TARGET_WIDTH}x${targetHeight} WebP`);
    console.log(`   Quality: ${WEBP_QUALITY}%`);
    console.log(`   Output: ${outputFilename}`);

    const startTime = Date.now();
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let errorOutput = "";

    ffmpeg.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    return new Promise((resolve) => {
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          const endTime = Date.now();
          const duration = ((endTime - startTime) / 1000).toFixed(1);

          // Get output file size
          if (fs.existsSync(finalOutputPath)) {
            const outputStats = fs.statSync(finalOutputPath);

            console.log(`   ✅ Extracted stable frame in ${duration}s`);
            console.log(
              `   📦 Size: ${(outputStats.size / 1024).toFixed(1)}KB`
            );
            console.log(`   💾 Saved as: ${outputFilename}`);
            resolve({
              success: true,
              filename: outputFilename,
              timestamp: stableTimestamp,
            });
          } else {
            console.log(`   ❌ Output file was not created`);
            resolve({ success: false });
          }
        } else {
          console.log(`   ❌ FFmpeg failed with code ${code}`);
          if (errorOutput) {
            console.log(`   Error details: ${errorOutput.slice(-300)}`);
          }
          resolve({ success: false });
        }
      });

      ffmpeg.on("error", (error) => {
        console.log(`   ❌ FFmpeg process error: ${error.message}`);
        resolve({ success: false });
      });
    });
  } catch (error) {
    console.log(`   ⚠️  Motion analysis failed: ${error.message}`);
    console.log(`   📌 Falling back to frame at 2 seconds`);

    // Fallback to a simple extraction at 2 seconds
    return extractSimpleFrame(inputPath, outputPath, videoInfo, 2.0);
  }
}

/**
 * Simple frame extraction fallback
 */
function extractSimpleFrame(inputPath, outputPath, videoInfo, timestamp) {
  return new Promise((resolve) => {
    const aspectRatio = videoInfo.width / videoInfo.height;
    const targetHeight = Math.round(TARGET_WIDTH / aspectRatio);

    // Create filename with timestamp
    const timestampFormatted = timestamp.toFixed(1).replace(".", "-");
    const outputFilename = `${OUTPUT_BASE_FILENAME}--${timestampFormatted}s.webp`;
    const finalOutputPath = path.join(path.dirname(outputPath), outputFilename);

    const ffmpegArgs = [
      "-i",
      inputPath,
      "-vframes",
      "1",
      "-ss",
      timestamp.toString(),
      "-vf",
      `scale=${TARGET_WIDTH}:${targetHeight}:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      WEBP_QUALITY.toString(),
      "-preset",
      "photo",
      "-lossless",
      "0",
      "-map_metadata",
      "-1",
      "-y",
      finalOutputPath,
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(finalOutputPath)) {
        const outputStats = fs.statSync(finalOutputPath);
        console.log(`   ✅ Fallback extraction successful`);
        console.log(`   📦 Size: ${(outputStats.size / 1024).toFixed(1)}KB`);
        console.log(`   💾 Saved as: ${outputFilename}`);
        resolve({
          success: true,
          filename: outputFilename,
          timestamp: timestamp,
        });
      } else {
        console.log(`   ❌ Fallback extraction failed`);
        resolve({ success: false });
      }
    });

    ffmpeg.on("error", () => resolve({ success: false }));
  });
}

/**
 * Main extraction function
 */
async function extractVideoThumbnail() {
  console.log("🖼️  Starting stable frame extraction from showreel...\n");
  console.log(`📂 Looking for videos in: ${path.resolve(INPUT_DIR)}`);
  console.log(`📤 Output will be saved to: ${path.resolve(OUTPUT_DIR)}`);
  console.log(`📝 Filename format: ${OUTPUT_BASE_FILENAME}--{timestamp}s.webp`);
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

  // Check if we need to extract (no files exist or video is newer)
  if (!needsExtraction(videoFile, OUTPUT_DIR)) {
    console.log(`✨ Frame already extracted and up-to-date!`);
    return;
  }

  try {
    // Get video information
    console.log("📊 Analyzing video...");
    const videoInfo = await getVideoInfo(videoFile);
    console.log("");

    // Extract the stable frame
    const tempOutputPath = path.join(OUTPUT_DIR, "temp.webp"); // Temporary path for function
    const result = await extractStableFrame(
      videoFile,
      tempOutputPath,
      videoInfo
    );

    if (result.success) {
      console.log("\n🎉 Stable frame extraction completed successfully!");
      console.log(
        `📁 Output file: ${path.resolve(OUTPUT_DIR, result.filename)}`
      );
      console.log(
        `⏱️  Extracted from timestamp: ${result.timestamp.toFixed(1)}s`
      );
      console.log("\n💡 Usage in Astro:");
      console.log(
        `   import firstFrame from "../assets/img/${result.filename}";`
      );
      console.log('   <Image src={firstFrame} alt="Showreel preview" />');
    } else {
      console.log("\n❌ Stable frame extraction failed!");
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
