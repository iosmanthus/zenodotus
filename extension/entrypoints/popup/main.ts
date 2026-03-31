import { checkHealth } from "@/utils/api";

const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const checkBtn = document.getElementById("check-btn")!;
const organizeBtn = document.getElementById("organize-btn") as HTMLButtonElement;
const autoToggle = document.getElementById("auto-toggle") as HTMLInputElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const savePromptBtn = document.getElementById("save-prompt-btn")!;
const errorMsg = document.getElementById("error-msg")!;

let connected = false;
let errorClearTimer: ReturnType<typeof setTimeout> | null = null;

async function checkConnection(): Promise<void> {
  statusDot.className = "";
  statusText.textContent = "Checking...";

  connected = await checkHealth();

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

function showError(message: string): void {
  errorMsg.textContent = message;
  if (errorClearTimer != null) {
    clearTimeout(errorClearTimer);
  }
  errorClearTimer = setTimeout(() => {
    errorMsg.textContent = "";
    errorClearTimer = null;
  }, 5000);
}

checkBtn.addEventListener("click", checkConnection);

organizeBtn.addEventListener("click", async () => {
  organizeBtn.disabled = true;
  organizeBtn.classList.add("loading");
  organizeBtn.textContent = "Organizing...";
  errorMsg.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({ action: "organize" });
    if (response?.success === false && response.error) {
      showError(response.error);
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : "Unknown error");
  } finally {
    organizeBtn.disabled = false;
    organizeBtn.classList.remove("loading");
    organizeBtn.textContent = "Organize Tabs";
  }
});

autoToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    action: "setAutoGroup",
    enabled: autoToggle.checked,
  });
});

chrome.runtime.sendMessage({ action: "getAutoGroup" }).then((response) => {
  if (response) autoToggle.checked = response.autoGroupEnabled;
});

chrome.storage.local.get({ prompt: "" }).then((data) => {
  promptInput.value = data.prompt;
});

savePromptBtn.addEventListener("click", () => {
  chrome.storage.local.set({ prompt: promptInput.value });
});

checkConnection();
