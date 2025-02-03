/***** DOM ELEMENTS *****/
const video = document.getElementById("video");
const timeline = document.getElementById("timeline");
const fileInput = document.getElementById("file-input");
const videoList = document.getElementById("video-list");
const spikeTriangle = document.getElementById("spike-triangle");
const timelineSpike = document.getElementById("timeline-spike");
const timelineSlider = document.getElementById("player-timeline");
const timeDisplay = document.getElementById("time-display");
const playPauseBtn = document.getElementById("play-pause-btn");

const splitButton = document.getElementById("split-button");
const deleteButton = document.getElementById("delete-button");
const undoButton = document.getElementById("undo-button");

const splitIndicator = document.getElementById("split-indicator");
const hoverIndicator = document.getElementById("hover-indicator");

const exportButton = document.getElementById("export-button");

/***** STATE *****/

// If in "blade" mode => we split segments on timeline click
let splitMode = false;

// Original list of loaded videos (full files)
let videos = []; // each: { name, url, duration, file? }
var globalFileRegistry = {};
let draggingVideoIndex = null;
// videoSegments is a Map of splitted segments (UUID -> { filename, start, end, order })
let videoSegments = new Map();
let currentSegmentUUID = null;

let totalDuration = 0;

// slider modes:
// - global => 0..totalDuration
// - segment => 0..(end-start) of current segment
let sliderIsGlobal = true;

// For capturing / restoring state when we reorder or delete segments
let currentGlobalTime = 0;
let wasPlaying = false;

// Track if we ended the current segment
let segmentEnded = false;

// Track which timeline segment is selected (for highlighting/deletion)
let selectedSegmentUUID = null;

// **Single-video-mode** variables:
let inFullVideoMode = false;        // Are we playing a single original video?
let currentFullVideoIndex = null;   // which index in videos[] are we playing?

/***** UNDO HISTORY *****/
// >>> Added for UNDO <<<
let timelineHistory = [];      // Array of snapshots
let historyIndex = -1;         // Which snapshot we're on
undoButton.style.display = "none"; // Hide by default


function saveTimelineState() {
  const snapshot = {
    videos: videos.map(v => ({
      name: v.name,
      url: v.url,
      duration: v.duration,
      // Add thumbnails so they can be restored
      thumbs: v.thumbs ? [...v.thumbs] : [],
      creationTime: v.creationTime || null
      // and any other metadata you need
    })),
    segments: [...videoSegments.entries()].map(([uuid, seg]) => [uuid, {...seg}]),
    currentSegmentUUID: currentSegmentUUID,
    selectedSegmentUUID: selectedSegmentUUID,
  };

  timelineHistory.push(snapshot);
  historyIndex = timelineHistory.length - 1;

  undoButton.style.display = "inline-flex";
}


function restoreTimelineState(snapshot) {
  // Then on restore:
  videos = snapshot.videos.map(sv => ({
    ...sv,
    file: globalFileRegistry[sv.name] || null
  }));

  videoSegments = new Map(snapshot.segments);

  currentSegmentUUID = snapshot.currentSegmentUUID;
  selectedSegmentUUID = snapshot.selectedSegmentUUID;

  updateTotalDuration();
  drawSegments();
  restoreVideoState();
}



/***** EVENT LISTENERS *****/
deleteButton.addEventListener("click", () => {
  if (selectedSegmentUUID) {
    // >>> Added for UNDO <<<
    // Save timeline *before* deleting
    saveTimelineState();

    deleteSegment(selectedSegmentUUID);
  }
});

// >>> Modified for UNDO <<<
undoButton.addEventListener("click", () => {
  // We want to go back to the previous state if possible
  if (historyIndex > 0) {
    const snapshot = timelineHistory[historyIndex];
    historyIndex--;
    restoreTimelineState(snapshot);
  } else {
    console.log("No earlier states to undo to.");
  }
});

/***** PLAY/PAUSE BUTTON *****/
playPauseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  onVideoPlayPause();
});

video.addEventListener("play", () => {
  playPauseBtn.textContent = "❚ ❚";
});

video.addEventListener("pause", () => {
  playPauseBtn.textContent = "►";
});

/***** FILE INPUT *****/
fileInput.addEventListener("change", async (event) => {
  let files = Array.from(event.target.files);
  await processFilesSequentially(files);
  console.log("All videos loaded.");

  // After all are loaded, automatically play the entire timeline (global)
  playAllSegments();
});

async function processFilesSequentially(files) {
  for (const file of files) {
    if (videos.some((v) => v.name === file.name)) {
      console.log(`File ${file.name} already added, skipping.`);
      continue;
    }
    await processSingleFile(file);
  }
}


async function processSingleFile(file) {
  return new Promise(async (resolve) => {
    globalFileRegistry[file.name] = file; 


    // 1) [Optional] Preserve app state
    saveTimelineState();

    // 2) Create an object URL for playback
    const objectURL = URL.createObjectURL(file);

    // 3) Extract metadata
    let duration = 0;
    let creationTime = null;
    try {
      const meta = await getVideoMetadata(file);
      console.log("Metadata extracted:", meta);
      duration = meta.duration;
      creationTime = meta.creationTime;
    } catch (err) {
      console.error("Error reading metadata:", err);
    }

    // 5) Add file info to global array
    const videoIndex = videos.length;
    videos.push({
      name: file.name,
      url: objectURL,
      duration,
      creationTime,
      file,
      thumb: null // we'll fill this in below
    });
    console.log("Updated videos list: ", videos);

    // 6) Create a single “full” segment for your timeline
    const segmentUUID = generateUUID();
    videoSegments.set(segmentUUID, {
      filename: file.name,
      start: 0,
      end: duration,
      order: videoSegments.size + 1,
    });

    // 7) Generate multiple thumbnails
    let thumbs = [];
    try {
      thumbs = await createThumbnails(file);
    } catch (err) {
      console.warn("createThumbnails failed, fallback to array of 1 fallback image:", err);
      thumbs = [{ time: 0, url: "/static/45x80.png" }];
    }
    videos[videoIndex].thumbs = thumbs;  // store array in your global

    const middleIndex = Math.floor(thumbs.length / 2);
    videos[videoIndex].thumb = thumbs[middleIndex]?.url || "/static/45x80.png";
    
    // 8) Create a div in your video list
    const videoItem = document.createElement("div");
    videoItem.classList.add("video-item");
    videoItem.dataset.videoIndex = videoIndex;

    const titleDiv = document.createElement("div");
    titleDiv.classList.add("video-title");
    titleDiv.textContent = file.name;

    const durationDiv = document.createElement("div");
    durationDiv.classList.add("video-duration");
    durationDiv.textContent = `Duration: ${duration.toFixed(2)}s`;


    const thumbnail = document.createElement("img");
    thumbnail.classList.add("video-thumbnail");
    thumbnail.src = videos[videoIndex].thumb;
    thumbnail.alt = file.name;

    // Disable dragging on the image
    thumbnail.setAttribute("draggable", false);

    videoItem.appendChild(thumbnail);


    videoItem.appendChild(titleDiv);
    videoItem.appendChild(durationDiv);

    // Draggable
    videoItem.setAttribute("draggable", "true");
    videoItem.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", videoIndex.toString());
      draggingVideoIndex = videoIndex;
    });

    // Add to the video-list container
    videoList.appendChild(videoItem);

    // Clicking => single-video mode
    videoItem.addEventListener("click", () => {
      console.log("Clicked on original video:", file.name);
      playFullVideo(videoIndex);
    });

    resolve();
  });
}

/***** SINGLE-VIDEO MODE *****/
function playFullVideo(videoIndex) {
  inFullVideoMode = true;
  sliderIsGlobal = false;
  currentFullVideoIndex = videoIndex;

  spikeTriangle.style.left = "0%";
  timelineSpike.style.left = "0%";

  const fileObj = videos[videoIndex];
  if (!fileObj) return;
  video.src = fileObj.url;
  video.onloadedmetadata = () => {
    video.currentTime = 0;
    video.play().catch((err) => console.log("Play interrupted:", err));
  };
}

/***** RETURN TO NORMAL (SEGMENT) MODE *****/
function returnToSegmentMode() {
  console.log("Exiting single-video mode => returning to normal (global) mode.");
  inFullVideoMode = false;
  sliderIsGlobal = true;
  playAllSegments();
}

/***** PLAYBACK LOGIC FOR SEGMENTS *****/
function playAllSegments() {
  inFullVideoMode = false;
  sliderIsGlobal = true;

  const orderedSegments = getOrderedSegments();
  if (orderedSegments.length === 0) {
    console.log("No segments to play.");
    return;
  }
  currentSegmentUUID = orderedSegments[0][0];
  updateTotalDuration();
  console.log("drawSegments 300");
  drawSegments();
  loadSegment(currentSegmentUUID, null, true);
}

function loadSegment(segmentUUID, seekTime = null, play = true) {
  const seg = videoSegments.get(segmentUUID);
  if (!seg) {
    console.warn("loadSegment: No segment found for", segmentUUID);
    return;
  }
  const fileObj = videos.find((v) => v.name === seg.filename);
  if (!fileObj) {
    console.warn("loadSegment: No file found:", seg.filename);
    return;
  }

  video.src = fileObj.url;
  video.load();
  video.onloadedmetadata = () => {
    video.currentTime = seekTime !== null ? seekTime : seg.start;
    if (play) {
      video.play().catch((err) => console.log("Play interrupted:", err));
    } else {
      playPauseBtn.textContent = "►";
    }
    console.log(
      `Loaded segment ${segmentUUID}, time=${video.currentTime.toFixed(2)}`
    );
  };
}

function playSingleSegment(segmentUUID) {
  currentSegmentUUID = segmentUUID;
  sliderIsGlobal = false;
  const seg = videoSegments.get(segmentUUID);
  const fileObj = videos.find((v) => v.name === seg.filename);
  if (!fileObj) return;

  video.src = fileObj.url;
  video.onloadedmetadata = () => {
    video.currentTime = seg.start;
    video.play().catch((err) => console.log("Play interrupted:", err));
  };
}

/***** VIDEO ENDED *****/
video.addEventListener("ended", () => {
  playPauseBtn.textContent = "►";
  if (inFullVideoMode) {
    console.log("Single full video ended.");
    segmentEnded = false;
    return;
  }
  segmentEnded = true;
  goToNextSegment();
});

function goToNextSegment() {
  const orderedSegments = getOrderedSegments();
  if (orderedSegments.length === 0) return;

  const idx = orderedSegments.findIndex(([uuid]) => uuid === currentSegmentUUID);
  if (idx < 0) return;

  if (idx < orderedSegments.length - 1) {
    const [nextUUID] = orderedSegments[idx + 1];
    currentSegmentUUID = nextUUID;
    loadSegment(nextUUID);
  } else {
    console.log("All segments finished.");
    playPauseBtn.textContent = "►";
  }
}

function handleSegmentEnd() {
  goToNextSegment();
}

/***** DURATION & TIMELINE (SEGMENTS) *****/
function updateTotalDuration() {
  totalDuration = 0;
  for (const seg of videoSegments.values()) {
    totalDuration += seg.end - seg.start;
  }
  console.log("Updated totalDuration:", totalDuration);
}

function drawSegments() {
  if (selectedSegmentUUID) {
    deleteButton.style.display = "inline-flex";
  } else {
    deleteButton.style.display = "none";
  }

  // Clear existing elements
  document.querySelectorAll(".video-segment").forEach((el) => el.remove());

  const sorted = getOrderedSegments();
  let accumulatedTime = 0;

  for (const [uuid, seg] of sorted) {
    const segDur = seg.end - seg.start;
    const segWidth = (segDur / totalDuration) * 100;
    const segLeft = (accumulatedTime / totalDuration) * 100;

    // Create the segment container
    const segDiv = document.createElement("div");
    segDiv.classList.add("video-segment");

    // Position & size in %
    segDiv.style.left = segLeft + "%";
    segDiv.style.width = segWidth + "%";

    segDiv.dataset.uuid = uuid;
    segDiv.setAttribute("draggable", "true");

    // If it's selected
    if (uuid === selectedSegmentUUID) {
      segDiv.classList.add("selected");
    }

    // Append first so we can measure segDiv.offsetWidth
    timeline.appendChild(segDiv);

    // Find the associated video file & thumbnails
    const fileObj = videos.find((v) => v.name === seg.filename);
    while (segDiv.firstChild) segDiv.removeChild(segDiv.firstChild);

    if (fileObj && fileObj.thumbs && fileObj.thumbs.length > 0) {
      const segDuration = segDur;
      if (segDuration <= 0) {
        segDiv.style.backgroundColor = "#808080";
      } else {
        // measure actual pixel width
        const segWidthPx = segDiv.offsetWidth; 
        const PIXELS_PER_SLICE = 50;
        const approxSlices = Math.floor(segWidthPx / PIXELS_PER_SLICE);
        const maxSlices = 10; 
        const sliceCount = Math.max(1, Math.min(approxSlices, maxSlices));

        for (let i = 0; i < sliceCount; i++) {
          const sliceStartFrac = i / sliceCount;
          const sliceEndFrac   = (i + 1) / sliceCount;
          const sliceStart = seg.start + segDuration * sliceStartFrac;
          const sliceEnd   = seg.start + segDuration * sliceEndFrac;
          const sliceMid   = (sliceStart + sliceEnd) / 2;

          // Find the nearest thumbnail to that midpoint
          const chosenThumb = getClosestThumb(fileObj.thumbs, sliceMid);

          const sliceDiv = document.createElement("div");
          sliceDiv.classList.add("segment-slice");

          // Position it within this segment's width
          sliceDiv.style.left   = (sliceStartFrac * 100) + "%";
          sliceDiv.style.width  = ((sliceEndFrac - sliceStartFrac) * 100) + "%";
          sliceDiv.style.top    = 0;
          sliceDiv.style.bottom = 0;

          // Use the thumbnail as background
          sliceDiv.style.backgroundImage    = `url(${chosenThumb.url})`;
          sliceDiv.style.backgroundSize     = "cover";
          sliceDiv.style.backgroundPosition = "center";

          // If first slice, round the left corners
          if (i === 0) {
            sliceDiv.style.borderTopLeftRadius = "10px";
            sliceDiv.style.borderBottomLeftRadius = "10px";
          }
          // If last slice, round the right corners
          if (i === sliceCount - 1) {
            sliceDiv.style.borderTopRightRadius = "10px";
            sliceDiv.style.borderBottomRightRadius = "10px";
          }

          segDiv.appendChild(sliceDiv);
        }
      }
    } else {
      segDiv.style.backgroundColor = "#808080";
    }

    segDiv.addEventListener("click", (e) => {
      selectedSegmentUUID = uuid;
      drawSegments();
    });
    addSegmentDragAndDrop(segDiv);

    accumulatedTime += segDur;
  }
}



function getOrderedSegments() {
  return [...videoSegments.entries()].sort(
    ([, sA], [, sB]) => sA.order - sB.order
  );
}

function onVideoPlayPause() {
  if (inFullVideoMode) {
    if (video.paused) {
      video.play().catch((err) => console.log("Play interrupted:", err));
    } else {
      video.pause();
      playPauseBtn.textContent = "►";
    }
    return;
  }

  if (segmentEnded) {
    playAllSegments();
    segmentEnded = false;
  } else {
    if (video.paused) {
      video.play().catch((err) => console.log("Play interrupted:", err));
    } else {
      video.pause();
      playPauseBtn.textContent = "►";
    }
  }
}

/***** VIDEO CLICK (Play/Pause or restart all) *****/
video.addEventListener("click", () => {
  onVideoPlayPause();
});

/***** TIMELINE SLIDER *****/
timelineSlider.addEventListener("input", (e) => {
  const newValue = parseFloat(e.target.value);

  if (inFullVideoMode) {
    const vid = videos[currentFullVideoIndex];
    if (!vid) return;
    video.currentTime = newValue; 
    return;
  }

  if (sliderIsGlobal) {
    if (totalDuration <= 0) return;
    seekGlobalTime(newValue);
  } else {
    if (!currentSegmentUUID) return;
    const seg = videoSegments.get(currentSegmentUUID);
    video.currentTime = seg.start + newValue;
  }
});

/***** TIMEUPDATE -> Move Spike *****/
video.addEventListener("timeupdate", () => {
  if (inFullVideoMode && currentFullVideoIndex != null) {
    const vid = videos[currentFullVideoIndex];
    const localTime = video.currentTime;
    timelineSlider.min = 0;
    timelineSlider.max = vid.duration;
    timelineSlider.value = localTime;

    timeDisplay.textContent = `${formatTime(localTime)} / ${formatTime(
      vid.duration
    )}`;
    return;
  }

  if (!currentSegmentUUID) return;
  const seg = videoSegments.get(currentSegmentUUID);
  const localTime = video.currentTime - seg.start;
  const segDur = seg.end - seg.start;

  let timeBefore = 0;
  const sorted = getOrderedSegments();
  for (const [uuid, s] of sorted) {
    if (uuid === currentSegmentUUID) break;
    timeBefore += s.end - s.start;
  }
  const globalTime = timeBefore + localTime;
  const globalPercent = (globalTime / totalDuration) * 100;

  spikeTriangle.style.left = `${globalPercent}%`;
  timelineSpike.style.left = `${globalPercent}%`;

  if (sliderIsGlobal) {
    timelineSlider.min = 0;
    timelineSlider.max = totalDuration;
    timelineSlider.value = globalTime;
    timeDisplay.textContent = `${formatTime(globalTime)} / ${formatTime(
      totalDuration
    )}`;
  } else {
    timelineSlider.min = 0;
    timelineSlider.max = segDur;
    timelineSlider.value = localTime;
    timeDisplay.textContent = `${formatTime(localTime)} / ${formatTime(segDur)}`;
  }

  if (video.currentTime >= seg.end) {
    video.pause();
    playPauseBtn.textContent = "►";
    segmentEnded = true;
    handleSegmentEnd();
  }
});

/***** TIMELINE CLICK *****/
timeline.addEventListener("click", (event) => {
  let wasInFullMode = inFullVideoMode;
  if (inFullVideoMode) {
    returnToSegmentMode();
  }

  if (splitMode) {
    handleSplitClick(event);
    return;
  }

  if (totalDuration <= 0) return;
  sliderIsGlobal = true;
  const wasPaused = video.paused;
  const rect = timeline.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const ratio = clickX / timeline.offsetWidth;
  const seekTime = ratio * totalDuration;

  if(wasInFullMode || !wasPaused){
    seekGlobalTime(seekTime, true);
  } else {
    seekGlobalTime(seekTime, false);
  }
});

function seekGlobalTime(globalTime, playImmediately = true) {
  let accumulated = 0;
  const sorted = getOrderedSegments();

  for (const [uuid, seg] of sorted) {
    const segDur = seg.end - seg.start;
    if (globalTime >= accumulated && globalTime < accumulated + segDur) {
      currentSegmentUUID = uuid;
      const localSeek = seg.start + (globalTime - accumulated);
      loadSegment(uuid, localSeek, playImmediately);
      return;
    }
    accumulated += segDur;
  }
}

/***** SPLIT MODE *****/
splitButton.addEventListener("click", () => {
  splitMode = !splitMode;
  if (splitMode) {
    document.body.classList.add("blade-mode");
    splitButton.style.backgroundColor = "#ccc";
  } else {
    document.body.classList.remove("blade-mode");
    splitButton.style.backgroundColor = "";
    splitIndicator.style.display = "none";
  }
  console.log("Split mode:", splitMode);
});

timeline.addEventListener("mousemove", (event) => {
  const rect = timeline.getBoundingClientRect();
  const xPos = event.clientX - rect.left;

  if (splitMode) {
    splitIndicator.style.display = "block";
    splitIndicator.style.left = xPos + "px";
    hoverIndicator.style.display = "none";
  } else {
    hoverIndicator.style.display = "block";
    hoverIndicator.style.left = xPos + "px";
    splitIndicator.style.display = "none";
  }
});

timeline.addEventListener("mouseleave", () => {
  splitIndicator.style.display = "none";
  hoverIndicator.style.display = "none";
});

// Global click => exit split mode / deselect segment if user clicks outside
document.addEventListener("click", (evt) => {
  if (evt.target.closest("button, #split-button, .video-segment")) {
    return;
  }
  if (evt.target === timeline) {
    return; 
  }

  if (splitMode) {
    exitSplitMode();
  }

  if (selectedSegmentUUID) {
    selectedSegmentUUID = null;
    console.log("drawSegments 630");
    drawSegments();
  }
});

function exitSplitMode() {
  splitMode = false;
  document.body.classList.remove("blade-mode");
  splitButton.style.backgroundColor = "";
  splitIndicator.style.display = "none";
  console.log("Exiting split mode");
}

function handleSplitClick(event) {
  if (totalDuration <= 0) return;

  const rect = timeline.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const ratio = clickX / timeline.offsetWidth;
  const globalSplitTime = ratio * totalDuration;

  let accumulated = 0;
  const sorted = getOrderedSegments();
  for (const [uuid, seg] of sorted) {
    const segDur = seg.end - seg.start;
    if (
      globalSplitTime >= accumulated &&
      globalSplitTime < accumulated + segDur
    ) {
      splitSegment(uuid, globalSplitTime, accumulated);
      break;
    }
    accumulated += segDur;
  }
}

function splitSegment(segmentUUID, globalSplitTime, accumulated) {
  const seg = videoSegments.get(segmentUUID);
  if (!seg) return;

  const localSplit = globalSplitTime - accumulated;
  const actualSplitTime = seg.start + localSplit;

  if (
    actualSplitTime <= seg.start + 0.01 ||
    actualSplitTime >= seg.end - 0.01
  ) {
    console.log("Split point too close to boundaries. Ignoring.");
    return;
  }

  // >>> Added for UNDO <<<
  // Save state *after* we actually split
  saveTimelineState();

  // 1) Create new segment
  const newUUID = generateUUID();
  const newSeg = {
    filename: seg.filename,
    start: actualSplitTime,
    end: seg.end,
    order: seg.order + 0.5,
  };

  // 2) Adjust the old segment
  seg.end = actualSplitTime;
  console.log("added segment in splitSegment");
  // 3) Add the new segment
  videoSegments.set(newUUID, newSeg);

  // 4) Reorder
  reOrderSegments();

  // 5) Update
  updateTotalDuration();
  console.log("drawSegments 705");
  drawSegments();
}

/***** DELETING A SEGMENT *****/
document.addEventListener("keydown", (event) => {
  if (!selectedSegmentUUID) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();

    // >>> Added for UNDO <<<
    saveTimelineState();

    deleteSegment(selectedSegmentUUID);
  }
});

function deleteSegment(uuid) {
  captureVideoState();
  selectedSegmentUUID = null;
  videoSegments.delete(uuid);

  reOrderSegments();
  updateTotalDuration();
  console.log("drawSegments 730");
  drawSegments();
  restoreVideoState();
  console.log(`Segment ${uuid} deleted.`);
}

/***** REORDERING SEGMENTS *****/
function reOrderSegments() {
  const sorted = getOrderedSegments();
  let newOrder = 1;
  for (const [uuid, seg] of sorted) {
    seg.order = newOrder++;
  }
  videoSegments = new Map(sorted.map(([uuid, seg]) => [uuid, seg]));
}

function reorderSegment(draggingUUID, targetUUID, insertAfter = false) {
  // 1) Get the current ordered array of segment UUIDs
  const ordered = [...videoSegments.keys()].sort(
    (a, b) => videoSegments.get(a).order - videoSegments.get(b).order
  );
  
  // 2) Find the current indices
  const fromIndex = ordered.indexOf(draggingUUID);
  const toIndex   = ordered.indexOf(targetUUID);
  
  if (fromIndex === -1) {
    // If draggingUUID is completely new (e.g. brand-new segment),
    // it won't be in `ordered` yet. We'll handle that below.
  } else {
    // Remove it from old position
    ordered.splice(fromIndex, 1);
  }

  if (toIndex === -1) {
    // If target not found, just push at end
    ordered.push(draggingUUID);
  } else {
    if (insertAfter) {
      // <<< Insert AFTER the target >>>
      ordered.splice(toIndex + 1, 0, draggingUUID);
    } else {
      // <<< Insert BEFORE the target >>>
      ordered.splice(toIndex, 0, draggingUUID);
    }
  }

  // 3) Reassign .order based on new array index
  ordered.forEach((uuid, idx) => {
    const seg = videoSegments.get(uuid);
    if (seg) seg.order = idx + 1; // 1-based order
  });
}

/***** TIMELINE SEGMENT DRAG & DROP *****/
function addSegmentDragAndDrop(segmentDiv) {
  // Existing segment -> dragstart
  segmentDiv.addEventListener("dragstart", (e) => {
    draggingUUID = segmentDiv.dataset.uuid;
    segmentDiv.classList.add("dragging");
    captureVideoState();
    e.dataTransfer.setData("text/plain", draggingUUID);
  });

  // (Required so drop can happen)
  segmentDiv.addEventListener("dragover", (e) => {
    e.preventDefault();
    segmentDiv.classList.add("drop-target");
  });

  segmentDiv.addEventListener("dragleave", () => {
    segmentDiv.classList.remove("drop-target");
  });

  segmentDiv.addEventListener("drop", (e) => {
    e.preventDefault();
    segmentDiv.classList.remove("drop-target");
  
    const targetUUID = segmentDiv.dataset.uuid;
  
    if (draggingVideoIndex !== null) {
      // 1) This is a brand-new video from the sidebar
      const fileObj = videos[draggingVideoIndex];
      if (!fileObj) return;
  
      saveTimelineState();
  
      // >>> FIX: Identify the last segment BEFORE adding the new one <<<
      const sortedBefore = getOrderedSegments(); // old segments only
      const lastUUID = sortedBefore[sortedBefore.length - 1][0];
      const isDroppingOnLastSegment = (targetUUID === lastUUID);
  
      // 2) Now create the new segment
      const newUUID = generateUUID();
      console.log("added segment in segmentDiv");
      videoSegments.set(newUUID, {
        filename: fileObj.name,
        start: 0,
        end: fileObj.duration,
        order: 999999, // temp large order
      });
  
      // 3) Insert AFTER if user dropped on the old last segment,
      //    else insert BEFORE
      reorderSegment(newUUID, targetUUID, isDroppingOnLastSegment);
      updateTotalDuration();
      console.log("drawSegments 836");
      // 4) Redraw, restore
      drawSegments();
      restoreVideoState();
      
    } else if (draggingUUID !== null) {
      // This is an existing timeline-segment reorder
      if (draggingUUID === targetUUID) {
        // Dropped on itself, no-op
      } else {
        saveTimelineState();
        reorderSegment(draggingUUID, targetUUID, /*insertAfter=*/false);
        console.log("drawSegments 847");
        drawSegments();
        restoreVideoState();
      }
    } 

  
    // Reset
    draggingUUID = null;
    draggingVideoIndex = null;
  });
  
  
}

/***** TIMELINE DRAG OVER / DROP (empty space) *****/
timeline.addEventListener("dragover", (e) => {
  e.preventDefault();
});

timeline.addEventListener("drop", (e) => {
  e.preventDefault();

  // If dropping a new video
  if (draggingVideoIndex !== null) {
    const fileObj = videos[draggingVideoIndex];
    if (fileObj) {
      saveTimelineState();

      // 1) Identify last segment of the old list
      const sortedBefore = getOrderedSegments();
      const lastUUID = sortedBefore.length
        ? sortedBefore[sortedBefore.length - 1][0]
        : null;
      console.log("added segment in timeline drop");
      // 2) Create your new segment
      const newUUID = generateUUID();
      videoSegments.set(newUUID, {
        filename: fileObj.name,
        start: 0,
        end: fileObj.duration,
        order: 999999,
      });

      // 3) If there was a last segment, reorder to insert *after* it
      if (lastUUID) {
        reorderSegment(newUUID, lastUUID, /*insertAfter=*/true);
      }
      console.log("drawSegments 896");
      // 4) Otherwise it's the first segment
      drawSegments();
      restoreVideoState();
    }
  }
  
  // If dropping an existing segment on empty space, etc...
  draggingVideoIndex = null;
  draggingUUID = null;
});



/***** CAPTURE/RESTORE STATE (for playback position) *****/
function captureVideoState() {
  wasPlaying = !video.paused;

  if (inFullVideoMode && currentFullVideoIndex != null) {
    currentGlobalTime = video.currentTime;
    return;
  }

  if (!currentSegmentUUID) return;
  let timeBefore = 0;
  const sorted = getOrderedSegments();
  for (const [uuid, s] of sorted) {
    if (uuid === currentSegmentUUID) break;
    timeBefore += (s.end - s.start);
  }
  const seg = videoSegments.get(currentSegmentUUID);
  currentGlobalTime = timeBefore + (video.currentTime - seg.start);
}

function restoreVideoState() {
  if (videoSegments.size === 0) {
    console.log("No segments left to restore.");
    return;
  }

  updateTotalDuration();
  let t = currentGlobalTime;
  if (t > totalDuration) t = totalDuration;

  let accumulated = 0;
  const sorted = getOrderedSegments();
  for (const [uuid, seg] of sorted) {
    const segDur = seg.end - seg.start;
    if (t >= accumulated && t < accumulated + segDur) {
      currentSegmentUUID = uuid;
      const localTime = seg.start + (t - accumulated);
      loadSegment(uuid, localTime, wasPlaying);
      return;
    }
    accumulated += segDur;
  }

  // If exactly at the end
  const lastEntry = sorted[sorted.length - 1];
  if (lastEntry) {
    const [u, s] = lastEntry;
    currentSegmentUUID = u;
    loadSegment(u, s.end - 0.1, false);
  }
}

/***** EXPORT BUTTON *****/
exportButton.addEventListener("click", (e) => {
  var exportModal = document.getElementById("exportModal");
  exportModal.style.display = "block"; // Show the modal
});

var exportMode = "Export separate";

async function onExport(){
  const sorted = getOrderedSegments();
  console.log("Exporting segments in order:");
  sorted.forEach(([uuid, seg], index) => {
    console.log(`${index + 1}) filename: ${seg.filename}, start: ${seg.start}, end: ${seg.end}`);
  });

  try {
    const segments = sorted.map(([uuid, seg]) => ({
      start: seg.start,
      end: seg.end
    }));

    const videoEntry = videos.find((v) => v.name === sorted[0][1].filename);
    if (!videoEntry || !videoEntry.file) {
      console.error("Original video file for segments not found.");
      alert("Original video file for segments not found.");
      return;
    }
    const videoFile = videoEntry.file;

    if (exportMode === "Export merged") {
      // (Assuming trimAndConcat(...) is available, but not shown here.)
      const concatenatedVideo = await trimAndConcat(videoFile, segments, true);
      if (concatenatedVideo) {
        console.log("Concatenated video created successfully:", concatenatedVideo);
        alert("Video segments have been concatenated and downloaded successfully.");
      } else {
        console.error("Failed to concatenate video segments.");
        alert("Failed to concatenate video segments. Please check the console for details.");
      }
    } else if (exportMode === "Export separate") {
      // (Assuming trimVideo(...) is available, but not shown here.)
      for (let i = 0; i < segments.length; i++) {
        const { start, end } = segments[i];
        console.log(`Trimming segment ${i + 1}: ${start} to ${end} seconds`);
        const trimmedFile = await trimVideo(videoFile, start, end, true);
        if (trimmedFile) {
          console.log(`Segment ${i + 1} trimmed and downloaded successfully:`, trimmedFile);
        } else {
          console.error(`Failed to trim segment ${i + 1}.`);
          alert(`Failed to trim segment ${i + 1}. Please check the console for details.`);
        }
      }
    } else {
      console.error(`Unknown export mode: ${exportMode}`);
      alert(`Unknown export mode: ${exportMode}`);
    }
  } catch (error) {
    console.error("An unexpected error occurred during export:", error);
    alert("An unexpected error occurred during export. Please check the console for details.");
  }
}
