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

let connected = false;

async function checkConnection(): Promise<void> {
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

  chrome.runtime.sendMessage({ action: "organize" }, () => {
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
