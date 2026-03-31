import { checkHealth } from "@/utils/api";

const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const checkBtn = document.getElementById("check-btn")!;
const organizeBtn = document.getElementById("organize-btn") as HTMLButtonElement;
const autoToggle = document.getElementById("auto-toggle") as HTMLInputElement;
const modelInput = document.getElementById("model-input") as HTMLInputElement;
const thinkingToggle = document.getElementById("thinking-toggle") as HTMLInputElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const saveSettingsBtn = document.getElementById("save-settings-btn")!;
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

function setOrganizing(active: boolean): void {
  organizeBtn.disabled = active;
  organizeBtn.classList.toggle("loading", active);
  organizeBtn.textContent = active ? "Organizing..." : "Organize Tabs";
}

checkBtn.addEventListener("click", checkConnection);

organizeBtn.addEventListener("click", () => {
  setOrganizing(true);
  errorMsg.textContent = "";
  chrome.runtime.sendMessage({ action: "organize" });
});

chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.organizeStatus) {
    const status = changes.organizeStatus.newValue;
    if (status === "done") {
      setOrganizing(false);
      chrome.storage.local.remove(["organizeStatus", "organizeError"]);
    } else if (status === "error") {
      setOrganizing(false);
      chrome.storage.local.get({ organizeError: "" }).then((data) => {
        showError(data.organizeError || "Unknown error");
        chrome.storage.local.remove(["organizeStatus", "organizeError"]);
      });
    } else if (status === "organizing") {
      setOrganizing(true);
    }
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

chrome.storage.local
  .get({ prompt: "", model: "", thinking: false, organizeStatus: null })
  .then((data) => {
    promptInput.value = data.prompt;
    modelInput.value = data.model;
    thinkingToggle.checked = data.thinking;
    if (data.organizeStatus === "organizing") {
      setOrganizing(true);
    }
  });

saveSettingsBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    prompt: promptInput.value,
    model: modelInput.value,
    thinking: thinkingToggle.checked,
  });
});

checkConnection();
