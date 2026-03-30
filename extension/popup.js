const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const checkBtn = document.getElementById("check-btn");
const organizeBtn = document.getElementById("organize-btn");
const autoToggle = document.getElementById("auto-toggle");
const promptInput = document.getElementById("prompt-input");
const savePromptBtn = document.getElementById("save-prompt-btn");

let connected = false;

async function checkConnection() {
  statusDot.className = "";
  statusText.textContent = "Checking...";

  try {
    const res = await fetch("http://localhost:18080/health", {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    connected = data.ok === true;
  } catch {
    connected = false;
  }

  if (connected) {
    statusDot.className = "connected";
    statusText.textContent = "Connected";
    organizeBtn.disabled = false;
  } else {
    statusDot.className = "disconnected";
    statusText.textContent = "Service disconnected";
    organizeBtn.disabled = true;
  }
}

checkBtn.addEventListener("click", checkConnection);

organizeBtn.addEventListener("click", async () => {
  organizeBtn.disabled = true;
  organizeBtn.classList.add("loading");
  organizeBtn.textContent = "Organizing...";

  chrome.runtime.sendMessage({ action: "organize" }, (response) => {
    organizeBtn.disabled = false;
    organizeBtn.classList.remove("loading");
    organizeBtn.textContent = "Organize Tabs";
  });
});

autoToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    action: "setAutoGroup",
    enabled: autoToggle.checked,
  });
});

// Load saved state
chrome.runtime.sendMessage({ action: "getAutoGroup" }, (response) => {
  if (response) autoToggle.checked = response.autoGroupEnabled;
});

chrome.storage.local.get({ prompt: "" }, (data) => {
  promptInput.value = data.prompt;
});

savePromptBtn.addEventListener("click", () => {
  chrome.storage.local.set({ prompt: promptInput.value });
});

// Initial connection check
checkConnection();
