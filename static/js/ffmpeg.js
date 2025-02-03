var ffmpeg = null;
var tryMultiThread = false; // currently use false since it's not stable

const CORE_VERSION = "0.12.6"
const FFMPEG_VERSION = "0.12.10"
const baseURLFFMPEG = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd`;
const baseURLCore = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
const baseURLCoreMT = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd`;
const CORE_SIZE = {
  [`https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`]: 114673,
  [`https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`]: 32129114,
  [`https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.js`]: 132680,
  [`https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`]: 32609891,
  [`https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.worker.js`]: 2915,
  [`https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/814.ffmpeg.js`]: 2648,
};

const toBlobURLPatched = async (url, mimeType, patcher) => {
    var resp = await fetch(url);
    var body = await resp.text();
    if (patcher) body = patcher(body);
    var blob = new Blob([body], {
        type: mimeType
    });
    return URL.createObjectURL(blob);
};

const toBlobURL = async (url, mimeType, cb) => {
    const resp = await fetch(url);
    let buf;
    if (!resp.ok) {
        throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const total = CORE_SIZE[url];
    let loaded = 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        const delta = value ? value.length : 0;
        if (done) {
            if (total != -1 && total !== received) throw new Error(`Incompleted download!`);
            cb && cb({ url, total, received, delta, done });
            break;
        }
        chunks.push(value);
        received += delta;
        cb && cb({ url, total, received, delta, done });
    }
    const data = new Uint8Array(received);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.length;
    }
    const stream = data.buffer;
    const body = await new Response(stream).blob();
    const blob = new Blob([body], { type: mimeType });
    return URL.createObjectURL(blob);
};

// Store logs in an array
let ffmpegLogs = [];

// Function to log and store FFmpeg output
function captureLog(message) {
    console.log(message);  // Print to console
    ffmpegLogs.push(message);  // Store in array
}

// Initialize FFmpeg with logging
const load = async (threadMode, cb) => {
    tryMultiThread = threadMode;
    const ffmpegBlobURL = await toBlobURLPatched(
        `${baseURLFFMPEG}/ffmpeg.js`,
        'text/javascript',
        (js) => js.replace('new URL(e.p+e.u(814),e.b)', 'r.workerLoadURL')
    );
    await import(ffmpegBlobURL);
    ffmpeg = new FFmpegWASM.FFmpeg();

    // Capture logs from FFmpeg
    ffmpeg.on('log', ({ message }) => {
        captureLog(message);
    });

    console.log("crossOriginIsolated ", window.crossOriginIsolated);
    if (tryMultiThread && window.crossOriginIsolated) {
        console.log("multi-threaded");
        await ffmpeg.load({
            workerLoadURL: await toBlobURL(`${baseURLFFMPEG}/814.ffmpeg.js`, 'text/javascript', cb),
            coreURL: await toBlobURL(`${baseURLCoreMT}/ffmpeg-core.js`, 'text/javascript', cb),
            wasmURL: await toBlobURL(`${baseURLCoreMT}/ffmpeg-core.wasm`, 'application/wasm', cb),
            workerURL: await toBlobURL(`${baseURLCoreMT}/ffmpeg-core.worker.js`, 'application/javascript', cb),
        });
    } else {
        console.log("single-threaded");
        await ffmpeg.load({
            workerLoadURL: await toBlobURL(`${baseURLFFMPEG}/814.ffmpeg.js`, 'text/javascript', cb),
            coreURL: await toBlobURL(`${baseURLCore}/ffmpeg-core.js`, 'text/javascript', cb),
            wasmURL: await toBlobURL(`${baseURLCore}/ffmpeg-core.wasm`, 'application/wasm', cb),
        });
    }
    console.log('ffmpeg load success');
}


function downloadFileByBlob(blobUrl, filename) {
    const eleLink = document.createElement('a')
    eleLink.download = filename
    eleLink.style.display = 'none'
    eleLink.href = blobUrl
    document.body.appendChild(eleLink)
    eleLink.click()
    document.body.removeChild(eleLink)
}

async function initializeFFmpeg() {
    try {
        console.log("Initializing FFmpeg...");
        await load(false, progress => {
            console.log(`Loading FFmpeg: ${Math.round((progress.received / progress.total) * 100)}%`);
        });
        console.log("FFmpeg loaded successfully");
    } catch (error) {
        console.error("Failed to load FFmpeg:", error);
        alert("Error loading FFmpeg.");
    }
}

async function splitVideo(videoFile, splitTimes, download = false) {
    const inputDir = '/input';
    const inputFile = `${inputDir}/${videoFile.name}`;
    const outputFiles = [];

    // Extract filename without extension and the original extension
    const fileNameWithoutExt = videoFile.name.substring(0, videoFile.name.lastIndexOf('.'));
    const fileExtension = videoFile.name.substring(videoFile.name.lastIndexOf('.'));

    try {
        // Create directory and mount the file
        await ffmpeg.createDir(inputDir);
        await ffmpeg.mount('WORKERFS', { files: [videoFile] }, inputDir);

        // Iterate over split times to create segments
        for (let i = 0; i < splitTimes.length; i++) {
            const [start, end] = splitTimes[i].split('-');
            const outputFile = `/${fileNameWithoutExt}_${start}_${end}${fileExtension}`;

            const args = [
                '-i', inputFile,
                '-ss', start,
                '-to', end,
                '-c', 'copy',
                outputFile
            ];

            const err = await ffmpeg.exec(args);
            if (err !== 0) {
                console.error(`Error creating segment ${start}-${end}. Check logs for details.`);
                continue;
            }

            console.log(`Segment ${start}-${end} created successfully.`);

            // Read the output file into memory
            const fileData = await ffmpeg.readFile(outputFile);
            const blob = new Blob([fileData.buffer], { type: `video/${fileExtension.slice(1)}` });
            const file = new File([blob], `${fileNameWithoutExt}_${start}_${end}${fileExtension}`, { type: `video/${fileExtension.slice(1)}` });
            
            await ffmpeg.deleteFile(outputFile);

            outputFiles.push(file);

            if (download) {
                downloadFileByBlob(URL.createObjectURL(blob), `${fileNameWithoutExt}_${start}_${end}${fileExtension}`);
            }
        }

        // Clean up
        await ffmpeg.unmount(inputDir);
        await ffmpeg.deleteDir(inputDir);


        return outputFiles;
    } catch (error) {
        console.error(error);
        alert("Error splitting video. See console for details.");
        return [];
    }
}

// Example function to print logs after processing
function printCapturedLogs() {
    console.log("Captured FFmpeg Logs:");
    console.log(ffmpegLogs.join('\n'));
}

async function getVideoMetadata(videoFile) {
    const inputDir = '/input';
    const inputFile = `${inputDir}/${videoFile.name}`;

    // Clear logs
    ffmpegLogs = [];

    try {
        captureLog(`Processing file for metadata: ${videoFile.name}`);

        await ffmpeg.createDir(inputDir);
        await ffmpeg.mount('WORKERFS', { files: [videoFile] }, inputDir);

        // Get the stream info
        const args = ['-i', inputFile];
        captureLog(`Running FFmpeg command: ${args.join(" ")}`);
        await ffmpeg.exec(args);

        const logString = ffmpegLogs.join('\n');
        captureLog("FFmpeg metadata output:\n" + logString);

        // 1) Parse duration
        const durationMatch = logString.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        let durationInSeconds = 0;
        if (durationMatch) {
            const hours = parseInt(durationMatch[1], 10);
            const minutes = parseInt(durationMatch[2], 10);
            const seconds = parseFloat(durationMatch[3]);
            durationInSeconds = hours * 3600 + minutes * 60 + seconds;
        }

        // 2) Parse creation_time
        let creationTime = 'N/A';
        const creationMatch = logString.match(/creation_time\s*:\s*([\d\-T:.]+Z?)/);
        if (creationMatch) {
            creationTime = creationMatch[1].trim();
            // Keep only 3 digits after decimal in ISO
            creationTime = creationTime.replace(/(\.\d{3})\d+/, '$1');
        } else {
            // fallback: use file's lastModified
            const fileStat = videoFile.lastModified;
            creationTime = new Date(fileStat).toISOString().replace(/(\.\d{3})\d+/, '$1');
        }

        // 3) Resolution
        const resolutionMatch = logString.match(/Stream.*Video:.*\s(\d+)x(\d+)/);
        let width = 0, height = 0;
        if (resolutionMatch) {
            width = parseInt(resolutionMatch[1], 10);
            height = parseInt(resolutionMatch[2], 10);
        }

        // 4) Frame rate
        const fpsMatch = logString.match(/(\d+(?:\.\d+)?)\s*fps/);
        let fps = 0;
        if (fpsMatch) {
            fps = parseFloat(fpsMatch[1]);
        }

        await ffmpeg.unmount(inputDir);
        await ffmpeg.deleteDir(inputDir);

        console.log(`Metadata extracted -> Duration: ${durationInSeconds}, ` +
                    `Creation: ${creationTime}, Size: ${width}x${height}, `);

        return {
            duration: durationInSeconds,
            creationTime,
            width,
            height,
            fps
        };
    } catch (error) {
        console.log(`Error fetching metadata: ${error}`);
        alert("Error fetching metadata. See console for details.");

        await ffmpeg.unmount(inputDir).catch(console.error);
        await ffmpeg.deleteDir(inputDir).catch(console.error);

        return {
            duration: 0,
            creationTime: 'N/A',
            width: 0,
            height: 0,
            fps: 0
        };
    }
}

/**
 * Converts seconds to "HH:MM:SS" format.
 *
 * @param {number} seconds - The time in seconds.
 * @returns {string} - The formatted time string.
 */
function secondsToHHMMSS(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return [hrs, mins, secs]
        .map(v => v < 10 ? '0' + v : v)
        .join(':');
}

/**
 * Formats seconds to a filename-friendly string.
 *
 * @param {number} seconds - The time in seconds.
 * @returns {string} - The formatted string.
 */
function formatSecondsForFilename(seconds) {
    return seconds.toFixed(3).replace('.', '-'); // e.g., 90.500 -> "90-500"
}



async function trimVideo(videoFile, start, end, download = false) {
    const inputDir = '/trim-input';
    const outputDir = '/trim-output';
    const outputFiles = [];

    // Generate unique filename based on current datetime and start/end times
    const now = new Date();
    const datetimeString = now.toISOString().replace(/[:.]/g, '-');
    const startFormatted = formatSecondsForFilename(start);
    const endFormatted = formatSecondsForFilename(end);
    const outputFilename = `trimmed_${datetimeString}_${startFormatted}_${endFormatted}.mp4`;
    const outputFilePath = `${outputDir}/${outputFilename}`;

    try {
        captureLog("Starting video trimming process...");
        captureLog(`Start time: ${start} seconds, End time: ${end} seconds`);

        // Create input and output directories
        await ffmpeg.createDir(inputDir).catch(() => {
            captureLog(`Directory ${inputDir} already exists.`);
        });
        await ffmpeg.createDir(outputDir).catch(() => {
            captureLog(`Directory ${outputDir} already exists.`);
        });

        // Mount the video file into FFmpeg's filesystem
        await ffmpeg.mount('WORKERFS', { files: [videoFile] }, inputDir);
        captureLog(`Mounted video file at ${inputDir}/${videoFile.name}`);

        // Convert seconds to "HH:MM:SS" format for FFmpeg
        const startTimeStr = secondsToHHMMSS(start);
        const endTimeStr = secondsToHHMMSS(end);

        // Define FFmpeg arguments for trimming without re-encoding
        const args = [
            '-i', `${inputDir}/${videoFile.name}`, // Input file
            '-ss', startTimeStr,                  // Start time
            '-to', endTimeStr,                    // End time
            '-c', 'copy',                         // Copy codec (no re-encoding)
            outputFilePath                        // Output file
        ];

        captureLog(`Executing FFmpeg command: ffmpeg ${args.join(" ")}`);

        // Execute FFmpeg command
        const exitCode = await ffmpeg.exec(args);
        if (exitCode !== 0) {
            captureLog(`FFmpeg failed with exit code ${exitCode}.`);
            console.error(`Error trimming video from ${start} to ${end} seconds. Exit code: ${exitCode}`);
            return null;
        }

        captureLog(`Video trimmed successfully from ${start} to ${end} seconds.`);

        // Read the trimmed output file into memory
        const trimmedData = await ffmpeg.readFile(outputFilePath);
        const blob = new Blob([trimmedData.buffer], { type: 'video/mp4' });
        const trimmedFile = new File(
            [blob],
            outputFilename,
            { type: 'video/mp4' }
        );

        outputFiles.push(trimmedFile);

        // Optionally download the trimmed video
        if (download) {
            downloadFileByBlob(URL.createObjectURL(blob), trimmedFile.name);
            captureLog(`Trimmed video downloaded as ${trimmedFile.name}`);
        }

        // Cleanup: Delete the output file and unmount the input directory
        await ffmpeg.deleteFile(outputFilePath);
        await ffmpeg.unmount(inputDir);
        await ffmpeg.deleteDir(inputDir).catch(() => {
            captureLog(`Could not remove directory ${inputDir}. It might not exist.`);
        });
        await ffmpeg.deleteDir(outputDir).catch(() => {
            captureLog(`Could not remove directory ${outputDir}. It might not exist.`);
        });

        return trimmedFile;
    } catch (error) {
        captureLog(`An error occurred while trimming the video: ${error.message}`);
        console.error(error);
        alert("Error trimming video. Please check the console for more details.");

        // Attempt cleanup in case of error
        try {
            await ffmpeg.unmount(inputDir);
            await ffmpeg.deleteDir(inputDir).catch(() => {});
            await ffmpeg.deleteDir(outputDir).catch(() => {});
        } catch (cleanupError) {
            captureLog(`Error during cleanup: ${cleanupError.message}`);
        }

        return null;
    }
}


//Warning: doesn't work with output files larger than 3-4 GB. Works with files of any input size.

/**
 * Trims multiple segments from a video and concatenates them into a single video without re-encoding.
 * Trimming is performed at the nearest keyframe to prevent corruption.
 *
 * @param {File} videoFile - The original video File object.
 * @param {Array<{start: number, end: number}>} segments - Array of segment objects with start and end times in seconds.
 * @param {boolean} [download=false] - Whether to automatically download the concatenated video.
 * @returns {Promise<File|null>} - The concatenated video file or null if an error occurs.
 */
async function trimAndConcat(videoFile, segments, download = false) {
    const inputDir = '/trim-input';
    const trimmedDir = '/trimmed-segments';
    const concatenatedDir = '/concatenated-output';
    const outputFiles = [];

    // Generate unique filename based on current datetime
    const now = new Date();
    const datetimeString = now.toISOString().replace(/[:.]/g, '-');
    const concatenatedFilename = `concatenated_${datetimeString}.mp4`;
    const concatenatedFilePath = `${concatenatedDir}/${concatenatedFilename}`;

    try {
        captureLog("Starting trim and concatenation process...");

        // Step 1: Create Necessary Directories
        await ffmpeg.createDir(inputDir).catch(() => {
            captureLog(`Directory ${inputDir} already exists.`);
        });
        await ffmpeg.createDir(trimmedDir).catch(() => {
            captureLog(`Directory ${trimmedDir} already exists.`);
        });
        await ffmpeg.createDir(concatenatedDir).catch(() => {
            captureLog(`Directory ${concatenatedDir} already exists.`);
        });

        // Step 2: Mount the Original Video File
        await ffmpeg.mount('WORKERFS', { files: [videoFile] }, inputDir);
        const originalFilePath = `${inputDir}/${videoFile.name}`;
        captureLog(`Mounted original video at ${originalFilePath}`);

        // Step 3: Trim Each Segment and Mount Trimmed Segments
        const trimmedSegments = [];
        for (let i = 0; i < segments.length; i++) {
            const { start, end } = segments[i];
            const trimmedFilename = `trimmed_${i}.mp4`;
            const trimmedFilePath = `${trimmedDir}/${trimmedFilename}`;

            captureLog(`Trimming segment ${i + 1}: ${start} to ${end} seconds`);

            // Calculate duration
            const duration = end - start;
            if (duration <= 0) {
                captureLog(`Invalid duration for segment ${i + 1}: start time is after end time.`);
                console.error(`Invalid duration for segment ${i + 1}. Skipping this segment.`);
                continue; // Skip invalid segment
            }

            // Define FFmpeg arguments for trimming with increased verbosity
            const argsTrim = [
                '-loglevel', 'verbose',             // Enhanced logging
                '-ss', secondsToHHMMSS(start),      // Start time (input seeking)
                '-i', originalFilePath,             // Input file
                '-t', secondsToHHMMSS(duration),    // Duration
                '-c', 'copy',                       // Copy codec (no re-encoding)
                trimmedFilePath                     // Output trimmed file
            ];

            captureLog(`Executing FFmpeg command for trimming: ffmpeg ${argsTrim.join(" ")}`);

            // Execute FFmpeg trimming command and capture logs
            const { stdout, stderr } = await ffmpeg.exec(argsTrim);
            captureLog(`FFmpeg stdout for trimming segment ${i + 1}: ${stdout}`);
            captureLog(`FFmpeg stderr for trimming segment ${i + 1}: ${stderr}`);


            // Verify that the trimmed file was created successfully
            try {
                await ffmpeg.readFile(trimmedFilePath);
                captureLog(`Segment ${i + 1} trimmed successfully and saved as ${trimmedFilename}`);
                trimmedSegments.push(trimmedFilePath);
            } catch (readError) {
                captureLog(`Trimmed segment ${trimmedFilePath} does not exist or is corrupted.`);
                console.error(`Trimmed segment ${trimmedFilePath} does not exist or is corrupted.`);
                continue; // Skip this segment
            }
        }

        if (trimmedSegments.length === 0) {
            captureLog("No segments were successfully trimmed. Aborting concatenation.");
            alert("No segments were successfully trimmed. Aborting concatenation.");
            return null;
        }

        // Step 4: Create Concat List File
        const concatListPath = `${concatenatedDir}/concat_list.txt`;
        let concatListContent = '';
        for (const trimmedPath of trimmedSegments) {
            concatListContent += `file '${trimmedPath}'\n`;
        }

        // Write the concat list file
        await ffmpeg.writeFile(concatListPath, concatListContent);
        captureLog(`Created concat list file at ${concatListPath} with content:\n${concatListContent}`);

        // Step 5: Define FFmpeg Arguments Using the Concat Demuxer
        const argsConcat = [
            '-loglevel', 'verbose',   // Enhanced logging
            '-f', 'concat',           // Specify concat demuxer
            '-safe', '0',             // Allow unsafe file paths
            '-i', concatListPath,     // Input list file
            '-c', 'copy',             // Copy codec (no re-encoding)
            concatenatedFilePath      // Output file
        ];

        captureLog(`Executing FFmpeg command for concatenation: ffmpeg ${argsConcat.join(" ")}`);

        // Execute FFmpeg concatenation command and capture logs
        const { stdout: concatStdout, stderr: concatStderr } = await ffmpeg.exec(argsConcat);
        captureLog(`FFmpeg stdout for concatenation: ${concatStdout}`);
        captureLog(`FFmpeg stderr for concatenation: ${concatStderr}`);


        captureLog("Video segments concatenated successfully.");

        // Step 6: Read the Concatenated Output File into Memory
        const concatenatedData = await ffmpeg.readFile(concatenatedFilePath);
        const blob = new Blob([concatenatedData.buffer], { type: 'video/mp4' });
        const concatenatedFile = new File(
            [blob],
            concatenatedFilename,
            { type: 'video/mp4' }
        );

        outputFiles.push(concatenatedFile);

        // Optionally Download the Concatenated Video
        if (download) {
            downloadFileByBlob(URL.createObjectURL(blob), concatenatedFile.name);
            captureLog(`Concatenated video downloaded as ${concatenatedFile.name}`);
        }

        // Step 7: Cleanup - Delete Temporary Files and Directories
        // Delete the concat list file
        await ffmpeg.deleteFile(concatListPath).catch(() => {
            captureLog(`Could not remove concat list file ${concatListPath}. It might not exist.`);
        });

        // Delete all trimmed segments
        for (let i = 0; i < segments.length; i++) {
            const trimmedPath = `${trimmedDir}/trimmed_${i}.mp4`;
            await ffmpeg.deleteFile(trimmedPath).catch(() => {
                captureLog(`Could not remove ${trimmedPath}. It might not exist.`);
            });
            captureLog(`Removed trimmed_${i}.mp4 from FFmpeg filesystem.`);
        }

        // Unmount and delete directories
        await ffmpeg.unmount(inputDir).catch(() => {
            captureLog(`Could not unmount directory ${inputDir}. It might not exist.`);
        });
        await ffmpeg.unmount(trimmedDir).catch(() => {
            captureLog(`Could not unmount directory ${trimmedDir}. It might not exist.`);
        });
        await ffmpeg.unmount(concatenatedDir).catch(() => {
            captureLog(`Could not unmount directory ${concatenatedDir}. It might not exist.`);
        });

        await ffmpeg.deleteDir(inputDir).catch(() => {
            captureLog(`Could not remove directory ${inputDir}. It might not exist.`);
        });
        await ffmpeg.deleteDir(trimmedDir).catch(() => {
            captureLog(`Could not remove directory ${trimmedDir}. It might not exist.`);
        });
        await ffmpeg.deleteDir(concatenatedDir).catch(() => {
            captureLog(`Could not remove directory ${concatenatedDir}. It might not exist.`);
        });

        return concatenatedFile;
    } catch (error) {
        captureLog(`An error occurred during concatenation: ${error.message}`);
        console.error(error);
        alert("Error concatenating video segments. Please check the console for more details.");

        // Attempt Cleanup in Case of Error
        try {
            // Delete all trimmed segments
            for (let i = 0; i < segments.length; i++) {
                const trimmedPath = `${trimmedDir}/trimmed_${i}.mp4`;
                await ffmpeg.deleteFile(trimmedPath).catch(() => {
                    captureLog(`Could not remove ${trimmedPath}. It might not exist.`);
                });
                captureLog(`Removed trimmed_${i}.mp4 from FFmpeg filesystem.`);
            }

            // Unmount directories
            await ffmpeg.unmount(inputDir).catch(() => {
                captureLog(`Could not unmount directory ${inputDir}. It might not exist.`);
            });
            await ffmpeg.unmount(trimmedDir).catch(() => {
                captureLog(`Could not unmount directory ${trimmedDir}. It might not exist.`);
            });
            await ffmpeg.unmount(concatenatedDir).catch(() => {
                captureLog(`Could not unmount directory ${concatenatedDir}. It might not exist.`);
            });

            // Delete directories
            await ffmpeg.deleteDir(inputDir).catch(() => {
                captureLog(`Could not remove directory ${inputDir}. It might not exist.`);
            });
            await ffmpeg.deleteDir(trimmedDir).catch(() => {
                captureLog(`Could not remove directory ${trimmedDir}. It might not exist.`);
            });
            await ffmpeg.deleteDir(concatenatedDir).catch(() => {
                captureLog(`Could not remove directory ${concatenatedDir}. It might not exist.`);
            });
        } catch (cleanupError) {
            captureLog(`Error during cleanup: ${cleanupError.message}`);
        }

        return null;
    }
}

/**
 * Creates a thumbnail from a target time in the video (fast keyframe approach).
 *
 * @param {File} videoFile   The input video File.
 * @param {number} timeSec   Approx time in seconds to grab a keyframe.
 * @param {number} width     Width to scale the image (optional).
 * @param {number} height    Height to scale the image (optional).
 * @returns {Promise<string>} A Blob URL for the thumbnail image.
 */
async function createThumbnailAtTime(videoFile, timeSec, width = 192, height = 108) {
    const inputDir = "/thumb-in";
    const outputDir = "/thumb-out";
    const inputPath = `${inputDir}/${videoFile.name}`;
    const outputPath = `${outputDir}/thumb-${timeSec}.jpg`;
  
    // We REMOVE the local fallback usage here ("/static/45x80.png").
    // Instead, we throw if something fails.
  
    // 1) Prepare directories and mount
    await ffmpeg.createDir(inputDir).catch(() => {});
    await ffmpeg.createDir(outputDir).catch(() => {});
    await ffmpeg.mount("WORKERFS", { files: [videoFile] }, inputDir);
  
    // 2) Build the FFmpeg command for a *fast keyframe*:
    const args = [
      "-ss", `${timeSec.toFixed(2)}`,
      "-noaccurate_seek",
      "-skip_frame", "nokey",
      "-i", inputPath,
      "-frames:v", "1",
      `-vf`, `scale=${width}:${height}`,
      "-q:v", "2",
      "-y",
      outputPath
    ];
  
    console.log("FFmpeg thumbnail command:", args.join(" "));
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error("FFmpeg returned nonzero exit code " + exitCode);
    }
  
    // 3) Read the output file into a Blob
    const data = await ffmpeg.readFile(outputPath);
    const blob = new Blob([data.buffer], { type: "image/jpeg" });
    const thumbUrl = URL.createObjectURL(blob);
  
    // 4) Cleanup
    await ffmpeg.deleteFile(outputPath).catch(() => {});
    await ffmpeg.unmount(inputDir).catch(() => {});
    await ffmpeg.deleteDir(inputDir).catch(() => {});
    await ffmpeg.deleteDir(outputDir).catch(() => {});
  
    return thumbUrl;
  }
  
/**
 * Creates multiple thumbnails for a video, up to 10, 
 * with at least 5 seconds covered by each thumbnail.
 *
 * @param {File} videoFile - The input video File.
 * @returns {Promise<Array<{ time: number, url: string }>>}
 *          An array of { time, url } for each generated thumbnail.
 */
async function createThumbnails(videoFile) {
    // First get the duration
    const meta = await getVideoMetadata(videoFile);
    const durationSec = meta?.duration || 0;
    
    // If we truly cannot get a duration, handle that as an "all-failed" scenario
    if (durationSec <= 0) {
      // We'll let the caller decide what to do with this error,
      // or we can directly return a fallback here:
      throw new Error("Could not determine video duration, so no thumbnails.");
    }
  
    // Calculate how many thumbs we want:
    // e.g. 1 thumbnail per 5sec, up to 10 max:
    const approximateCount = Math.floor(durationSec / 5);
    const count = Math.max(1, Math.min(10, approximateCount));
  
    const step = durationSec / count;
    
    let thumbnails = [];
    for (let i = 0; i < count; i++) {
      const t = i * step;
      try {
        // Attempt to create a thumbnail at time t
        const url = await createThumbnailAtTime(videoFile, t);
        thumbnails.push({ time: t, url });
      } catch (err) {
        console.warn("Thumbnail failed at time", t, err);
        // We skip it and do NOT insert any fallback image here
      }
    }
  
    // If *all* attempts failed, we have an empty array
    if (thumbnails.length === 0) {
      // Return one fallback object so we have at least something
      return [{ time: 0, url: "/static/45x80.png" }];
    }
  
    return thumbnails;
  }
  
/**
 * Creates a thumbnail from (about) the middle keyframe of the video,
 * avoiding accurate seek or decoding all frames. Much faster than
 * decoding from the exact half-second mark.
 *
 * @param {File} videoFile  The input video.
 * @param {string} outName  Optional output filename in FFmpeg FS.
 * @returns {Promise<string>}  A Blob URL for the thumbnail image.
 */
async function createThumbnail(videoFile, outName = "thumb.jpg") {
    const inputDir = "/thumb-in";
    const outputDir = "/thumb-out";
    const inputPath = `${inputDir}/${videoFile.name}`;
    const outputPath = `${outputDir}/${outName}`;
    const fallback = "/static/45x80.png"; // fallback if thumbnail fails
  
    try {
      // 1) Get video duration
      const meta = await getVideoMetadata(videoFile);
      const durationSec = meta?.duration || 0;
      // "middle" (roughly). If 0, we effectively grab the first keyframe
      const halfTime = durationSec > 0 ? (durationSec / 2).toFixed(2) : 0;
  
      // 2) Prepare directories and mount
      await ffmpeg.createDir(inputDir).catch(() => {});
      await ffmpeg.createDir(outputDir).catch(() => {});
      await ffmpeg.mount("WORKERFS", { files: [videoFile] }, inputDir);
  
      // 3) Build our *fast keyframe* FFmpeg command:
      //    -noaccurate_seek + -skip_frame nokey => jump near halfTime, then skip all non-keyframes,
      //    so the very next frame is an I-frame. Then scale/crop as needed.
      const args = [
        "-ss", `${halfTime}`,
        "-noaccurate_seek",
        "-skip_frame", "nokey",
        "-i", inputPath,
        "-frames:v", "1",
        // Optionally do scaling or cropping. Here we scale to 192×108.
        // If you want to preserve aspect ratio, you could do e.g. scale=192:-1 or similar
        // or a crop+scale filter. But here's a simple scale to 192×108 for demonstration.
        "-vf", "scale=192:108",
        "-q:v", "2",       // Good quality
        "-y",              // Overwrite output
        outputPath
      ];
  
      console.log("FFmpeg thumbnail command:", args.join(" "));
      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        throw new Error("FFmpeg failed, exit code " + exitCode);
      }
  
      // 4) Read the output file into a Blob
      const data = await ffmpeg.readFile(outputPath);
      const blob = new Blob([data.buffer], { type: "image/jpeg" });
      const thumbUrl = URL.createObjectURL(blob);
  
      // 5) Cleanup
      await ffmpeg.deleteFile(outputPath).catch(() => {});
      await ffmpeg.unmount(inputDir).catch(() => {});
      await ffmpeg.deleteDir(inputDir).catch(() => {});
      await ffmpeg.deleteDir(outputDir).catch(() => {});
  
      console.log("Keyframe thumbnail created successfully.");
      return thumbUrl;
    } catch (err) {
      console.warn("Keyframe thumbnail failed:", err);
  
      // Attempt minimal cleanup
      try {
        await ffmpeg.unmount(inputDir).catch(() => {});
        await ffmpeg.deleteDir(inputDir).catch(() => {});
        await ffmpeg.deleteDir(outputDir).catch(() => {});
      } catch (cleanupErr) {
        console.warn("Cleanup error after thumbnail failure:", cleanupErr);
      }
  
      return fallback; // Return a placeholder or fallback image on error
    }
  }
  


initializeFFmpeg();
