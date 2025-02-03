/***** UTILITIES *****/
function generateUUID() {
    // Minimal random UUID
    return (
      Math.random().toString(36).substring(2, 8) +
      "-" +
      Math.random().toString(36).substring(2, 8)
    );
  }
  
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

function showModal(message = "Please press OK") {
    var modal = document.getElementById("myModal");
    var messageParagraph = document.getElementById("modalMessage");
    messageParagraph.textContent = message;
    modal.style.display = "block"; // Show the modal
}


document.addEventListener("DOMContentLoaded", function() {
  
  function getBrowserName() {
      let userAgent = navigator.userAgent;
      if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
          return "Chrome";
      } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
          return "Safari";
      } else if (userAgent.includes("Edg")) {
          return "Edge";
      } else if (userAgent.includes("Firefox")) {
          return "Firefox";
      } else {
          return "Other";
      }
  }

  // List of allowed browsers
  const allowedBrowsers = ["Chrome", "Safari"];
  
  // Check if the user's browser is in the allowed list
  if (!allowedBrowsers.includes(getBrowserName())) {
      showModal("We've noticed you are not using Chrome or Safari. Beware that the website functions properly only with these 2 browsers.");
  }
});

// Event listener for the modal's "OK" button
var okButton = document.getElementById("okButton");
okButton.onclick = function() {
    var modal = document.getElementById("myModal");
    modal.style.display = "none"; // Hide the modal
}


// Event listener for closing the modal (if you have a close button)
var closeButton = document.getElementsByClassName("close")[0];
closeButton.onclick = function() {
    var modal = document.getElementById("myModal");
    modal.style.display = "none"; // Hide the modal
}

// Handling clicking outside of the modal to close it
window.onclick = function(event) {
    var modal = document.getElementById("myModal");
    if (event.target == modal) {
        modal.style.display = "none";
    }
    var exportModal = document.getElementById("exportModal");
    if (event.target == exportModal) {
      exportModal.style.display = "none";
    }
}

const exportSeparateBtn = document.getElementById("export-separate");
const exportMergedBtn = document.getElementById("export-merged");

// Event Listeners for Export Options
exportSeparateBtn.addEventListener("click", () => {
  exportMode = "Export separate";
  let exportModal = document.getElementById("exportModal");
  exportModal.style.display = "none";
  onExport();
});

exportMergedBtn.addEventListener("click", () => {
  exportMode = "Export merged";
  let exportModal = document.getElementById("exportModal");
  exportModal.style.display = "none";
  onExport();
});

function getClosestThumb(thumbs, targetTime) {
  // thumbs is an array: [ { time, url }, { time, url }, ... ]
  let closest = thumbs[0];
  let minDiff = Math.abs(targetTime - closest.time);
  for (let i = 1; i < thumbs.length; i++) {
    const diff = Math.abs(targetTime - thumbs[i].time);
    if (diff < minDiff) {
      closest = thumbs[i];
      minDiff = diff;
    }
  }
  return closest;
}

