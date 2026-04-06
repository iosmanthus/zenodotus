export interface TabInfo {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  description?: string;
}

export interface ExistingGroup {
  groupId: number;
  name: string;
  tabIds: number[];
}

export interface GroupRequest {
  tabs: TabInfo[];
  existingGroups?: ExistingGroup[];
  prompt?: string;
  model?: string;
  debug?: boolean;
  provider?: string;
}

export interface GroupAssignment {
  groupId?: number;
  name?: string;
  tabIds: number[];
}

export interface GroupResponse {
  groups: GroupAssignment[];
}
