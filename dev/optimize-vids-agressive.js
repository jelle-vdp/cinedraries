import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const INPUT_DIR = './vid';
const OUTPUT_DIR = '../src/assets/vid/';
const SUPPORTED_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv'];
const TARGET_WIDTH = 1920;

// Video compression settings optimized for web (extra compressed)
const COMPRESSION_SETTINGS = {
    // H.264 settings for maximum compatibility with aggressive compression
    codec: 'libx264',
    crf: 28, // Higher CRF = more compression (was 23)
    preset: 'slow', // Better compression efficiency (was medium)
    profile: 'high',
    level: '4.1',
    maxBitrate: '2000k', // Much lower max bitrate (was 5000k)
    bufferSize: '4000k', // Buffer size (2x max bitrate)
    audioCodec: 'aac',
    audioBitrate: '96k', // Lower audio bitrate (was 128k)
    audioSampleRate: '44100',
    // Additional compression options
    tune: 'film', // Optimize for film content
    motionEstimation: 'hex', // Better motion estimation
    subpixelRefinement: 8, // Higher quality motion vectors
    bFrames: 8, // More B-frames for better compression
    weightedPrediction: true // Better prediction for compression
};

/**
 * Check if FFmpeg is available
 */
function checkFFmpeg() {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version']);
        ffmpeg.on('error', () => resolve(false));
        ffmpeg.on('close', (code) => resolve(code === 0));
    });
}

/**
 * Get video information using FFprobe
 */
function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            inputPath
        ]);

        let output = '';
        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.on('close', (code) => {
            if (code === 0) {
                try {
                    const info = JSON.parse(output);
                    const videoStream = info.streams.find(stream => stream.codec_type === 'video');
                    resolve({
                        format: info.format,
                        video: videoStream,
                        duration: parseFloat(info.format.duration),
                        size: parseInt(info.format.size),
                        width: videoStream ? videoStream.width : 0,
                        height: videoStream ? videoStream.height : 0
                    });
                } catch (error) {
                    reject(new Error(`Failed to parse video info: ${error.message}`));
                }
            } else {
                reject(new Error(`FFprobe failed with code ${code}`));
            }
        });

        ffprobe.on('error', (error) => {
            reject(new Error(`FFprobe error: ${error.message}`));
        });
    });
}

/**
 * Recursively get all video files from a directory
 */
function getAllVideoFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    console.log(`🔍 Scanning directory: ${dir}`);
    console.log(`   Found ${files.length} items: ${files.join(', ')}`);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            console.log(`📁 Entering subdirectory: ${file}`);
            getAllVideoFiles(filePath, fileList);
        } else {
            const ext = path.extname(file).toLowerCase();
            console.log(`📄 File: ${file} (extension: ${ext})`);
            if (SUPPORTED_FORMATS.includes(ext)) {
                console.log(`   ✅ Supported format - adding to compression list`);
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
 * Check if output file needs to be updated
 */
function needsCompression(inputPath, outputPath) {
    if (!fs.existsSync(outputPath)) {
        return true;
    }
    
    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);
    
    return inputStats.mtime > outputStats.mtime;
}

/**
 * Compress video using FFmpeg
 */
function compressVideo(inputPath, outputPath, videoInfo) {
    return new Promise((resolve, reject) => {
        console.log(`🎬 Processing: ${path.basename(inputPath)}`);
        console.log(`   Original: ${videoInfo.width}x${videoInfo.height}, ${(videoInfo.size / 1024 / 1024).toFixed(1)}MB`);
        
        // Calculate target height maintaining aspect ratio
        const aspectRatio = videoInfo.width / videoInfo.height;
        const targetHeight = Math.round(TARGET_WIDTH / aspectRatio);
        
        // Build FFmpeg arguments
        const ffmpegArgs = [
            '-i', inputPath,
            
            // Video settings
            '-c:v', COMPRESSION_SETTINGS.codec,
            '-crf', COMPRESSION_SETTINGS.crf.toString(),
            '-preset', COMPRESSION_SETTINGS.preset,
            '-profile:v', COMPRESSION_SETTINGS.profile,
            '-level', COMPRESSION_SETTINGS.level,
            '-maxrate', COMPRESSION_SETTINGS.maxBitrate,
            '-bufsize', COMPRESSION_SETTINGS.bufferSize,
            
            // Scale video to target width
            '-vf', `scale=${TARGET_WIDTH}:${targetHeight}:flags=lanczos`,
            
            // Audio settings
            '-c:a', COMPRESSION_SETTINGS.audioCodec,
            '-b:a', COMPRESSION_SETTINGS.audioBitrate,
            '-ar', COMPRESSION_SETTINGS.audioSampleRate,
            
            // Advanced H.264 settings for better compression
            '-tune', COMPRESSION_SETTINGS.tune,
            '-me_method', COMPRESSION_SETTINGS.motionEstimation,
            '-subq', COMPRESSION_SETTINGS.subpixelRefinement.toString(),
            '-bf', COMPRESSION_SETTINGS.bFrames.toString(),
            '-weightp', COMPRESSION_SETTINGS.weightedPrediction ? '2' : '0',
            
            // Additional compression optimizations
            '-refs', '5', // More reference frames
            '-mixed-refs', '1', // Mixed reference frames
            '-trellis', '2', // Trellis quantization
            '-8x8dct', '1', // 8x8 DCT transform
            '-fast-pskip', '0', // Don't skip prediction
            '-partitions', '+parti8x8+parti4x4+partp8x8+partb8x8', // More partition types
            
            // Remove metadata
            '-map_metadata', '-1',
            
            // Optimize for web streaming
            '-movflags', '+faststart',
            
            // Overwrite output file
            '-y',
            
            outputPath
        ];
        
        console.log(`   Target: ${TARGET_WIDTH}x${targetHeight}`);
        console.log(`   Settings: CRF=${COMPRESSION_SETTINGS.crf}, Preset=${COMPRESSION_SETTINGS.preset}, MaxBitrate=${COMPRESSION_SETTINGS.maxBitrate}`);
        
        const startTime = Date.now();
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        let errorOutput = '';
        
        ffmpeg.stderr.on('data', (data) => {
            const line = data.toString();
            errorOutput += line;
            
            // Extract progress info
            if (line.includes('time=')) {
                const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
                if (timeMatch) {
                    const hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2]);
                    const seconds = parseInt(timeMatch[3]);
                    const currentTime = hours * 3600 + minutes * 60 + seconds;
                    const progress = ((currentTime / videoInfo.duration) * 100).toFixed(1);
                    process.stdout.write(`\r   Progress: ${progress}%`);
                }
            }
        });
        
        ffmpeg.on('close', (code) => {
            process.stdout.write('\n'); // New line after progress
            
            if (code === 0) {
                const endTime = Date.now();
                const duration = ((endTime - startTime) / 1000).toFixed(1);
                
                // Get output file size
                const outputStats = fs.statSync(outputPath);
                const compressionRatio = ((videoInfo.size - outputStats.size) / videoInfo.size * 100).toFixed(1);
                
                console.log(`   ✅ Compressed in ${duration}s`);
                console.log(`   📦 Size: ${(videoInfo.size / 1024 / 1024).toFixed(1)}MB → ${(outputStats.size / 1024 / 1024).toFixed(1)}MB (${compressionRatio}% smaller)`);
                resolve(true);
            } else {
                console.log(`   ❌ FFmpeg failed with code ${code}`);
                if (errorOutput) {
                    console.log(`   Error details: ${errorOutput.slice(-200)}`); // Last 200 chars
                }
                resolve(false);
            }
        });
        
        ffmpeg.on('error', (error) => {
            console.log(`   ❌ FFmpeg process error: ${error.message}`);
            resolve(false);
        });
    });
}

/**
 * Main compression function
 */
async function compressVideos() {
    console.log('🎥 Starting EXTRA COMPRESSED video conversion for web...\n');
    console.log(`📂 Looking for videos in: ${path.resolve(INPUT_DIR)}`);
    console.log(`📤 Output directory will be: ${path.resolve(OUTPUT_DIR)}`);
    console.log(`🎯 Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
    console.log(`📐 Target resolution: ${TARGET_WIDTH}px width`);
    console.log(`🗜️  EXTRA COMPRESSION: CRF ${COMPRESSION_SETTINGS.crf}, Max ${COMPRESSION_SETTINGS.maxBitrate} bitrate\n`);
    
    // Check if FFmpeg is available
    console.log('🔧 Checking FFmpeg availability...');
    const hasFFmpeg = await checkFFmpeg();
    if (!hasFFmpeg) {
        console.error('❌ FFmpeg is not installed or not available in PATH!');
        console.log('📦 Please install FFmpeg from https://ffmpeg.org/download.html');
        process.exit(1);
    }
    console.log('✅ FFmpeg is available\n');
    
    // Check if input directory exists
    if (!fs.existsSync(INPUT_DIR)) {
        console.error(`❌ Input directory "${INPUT_DIR}" does not exist!`);
        console.log(`   Full path: ${path.resolve(INPUT_DIR)}`);
        process.exit(1);
    }
    
    // Ensure output directory exists
    ensureDirectoryExists(OUTPUT_DIR);
    
    // Get all video files
    const videoFiles = getAllVideoFiles(INPUT_DIR);
    
    if (videoFiles.length === 0) {
        console.log('📭 No supported video files found in the input directory.');
        return;
    }
    
    // Filter files that need compression
    const filesToProcess = [];
    const skippedFiles = [];
    
    for (const inputPath of videoFiles) {
        const relativePath = path.relative(INPUT_DIR, inputPath);
        const parsedPath = path.parse(relativePath);
        
        // Output as .mp4 with --extra-compressed suffix for maximum web compatibility
        const outputRelativePath = path.join(parsedPath.dir, parsedPath.name + '--extra-compressed.mp4');
        const outputPath = path.join(OUTPUT_DIR, outputRelativePath);
        
        if (needsCompression(inputPath, outputPath)) {
            filesToProcess.push({ inputPath, outputPath });
        } else {
            skippedFiles.push(inputPath);
        }
    }
    
    console.log(`\n📋 Found ${videoFiles.length} video(s) total:`);
    console.log(`📝 ${filesToProcess.length} file(s) need compression`);
    console.log(`⏭️  ${skippedFiles.length} file(s) already up-to-date (skipped)\n`);
    
    if (skippedFiles.length > 0) {
        console.log('⏭️  Skipped files (already compressed and up-to-date):');
        skippedFiles.forEach(file => {
            console.log(`   • ${path.relative(INPUT_DIR, file)}`);
        });
        console.log('');
    }
    
    if (filesToProcess.length === 0) {
        console.log('✨ All videos are already compressed and up-to-date!');
        return;
    }
    
    console.log('🔄 Compressing videos:\n');
    
    let successCount = 0;
    let failureCount = 0;
    
    // Process each video that needs compression
    for (const { inputPath, outputPath } of filesToProcess) {
        try {
            // Get video information
            const videoInfo = await getVideoInfo(inputPath);
            
            // Ensure output subdirectory exists
            const outputDir = path.dirname(outputPath);
            ensureDirectoryExists(outputDir);
            
            // Compress the video
            const success = await compressVideo(inputPath, outputPath, videoInfo);
            
            if (success) {
                successCount++;
            } else {
                failureCount++;
            }
            
            console.log(''); // Add spacing between files
        } catch (error) {
            console.error(`❌ Error processing ${inputPath}: ${error.message}`);
            failureCount++;
            console.log('');
        }
    }
    
    // Summary
    console.log('📊 Compression Summary:');
    console.log(`✅ Successfully compressed: ${successCount} files`);
    if (failureCount > 0) {
        console.log(`❌ Failed compressions: ${failureCount} files`);
    }
    console.log(`📁 Output directory: ${path.resolve(OUTPUT_DIR)}`);
    
    console.log('\n🎉 Video compression completed!');
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});

// Run the compression
compressVideos().catch(error => {
    console.error('❌ Compression failed:', error);
    process.exit(1);
});