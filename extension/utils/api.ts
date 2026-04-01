import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const NMH_HOST = "com.zenodotus.host";

export async function requestGrouping(request: GroupRequest): Promise<GroupResponse | null> {
  try {
    const response = await chrome.runtime.sendNativeMessage(NMH_HOST, request);
    if (response?.error) {
      console.error("[zenodotus] NMH error:", response.error);
      return null;
    }
    return response as GroupResponse;
  } catch (err) {
    console.error("[zenodotus] NMH communication error:", err);
    return null;
  }
}
