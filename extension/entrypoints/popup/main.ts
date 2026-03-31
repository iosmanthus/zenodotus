import { checkHealth } from "@/utils/api";

const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const checkBtn = document.getElementById("check-btn")!;
const organizeBtn = document.getElementById(
  "organize-btn",
) as HTMLButtonElement;
const autoToggle = document.getElementById("auto-toggle") as HTMLInputElement;
const promptInput = document.getElementById(
  "prompt-input",
) as HTMLTextAreaElement;
const savePromptBtn = document.getElementById("save-prompt-btn")!;
const errorMsg = document.getElementById("error-msg")!;

let connected = false;
let errorClearTimer: ReturnType<typeof setTimeout> | null = null;

// I3: use checkHealth() from utils/api
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

// S8: show error in the error element, auto-clear after 5s
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
  // S8: clear error before organizing
  errorMsg.textContent = "";

  chrome.runtime.sendMessage(
    { action: "organize" },
    (response: { success: boolean; error?: string }) => {
      organizeBtn.disabled = false;
      organizeBtn.classList.remove("loading");
      organizeBtn.textContent = "Organize Tabs";

      // S8: check response.success and show error if failed
      if (response && response.success === false && response.error) {
        showError(response.error);
      }
    },
  );
});

autoToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    action: "setAutoGroup",
    enabled: autoToggle.checked,
  });
});

chrome.runtime.sendMessage(
  { action: "getAutoGroup" },
  (response: { autoGroupEnabled: boolean }) => {
    if (response) autoToggle.checked = response.autoGroupEnabled;
  },
);

chrome.storage.local.get({ prompt: "" }, (data: { prompt: string }) => {
  promptInput.value = data.prompt;
});

savePromptBtn.addEventListener("click", () => {
  chrome.storage.local.set({ prompt: promptInput.value });
});

checkConnection();
