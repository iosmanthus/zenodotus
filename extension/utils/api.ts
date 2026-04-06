import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";

const NMH_HOST = "com.zenodotus.host";

export async function requestGrouping(request: GroupRequest): Promise<GroupResponse> {
  const response = await chrome.runtime.sendNativeMessage(NMH_HOST, request);
  if (response?.error) {
    throw new Error(response.error);
  }
  return response as GroupResponse;
}
