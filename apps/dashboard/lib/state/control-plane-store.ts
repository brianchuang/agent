"use client";

import { create } from "zustand";

type ControlPlaneUiState = {
  workspaceId: string;
  setWorkspaceId: (workspaceId: string) => void;
};

export const useControlPlaneUiStore = create<ControlPlaneUiState>((set) => ({
  workspaceId: "personal",
  setWorkspaceId: (workspaceId) => set({ workspaceId })
}));
