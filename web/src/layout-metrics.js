export const BOARD_TARGET_WIDTH = 1040;
export const BOARD_PANEL_PADDING = 28;
export const APP_WINDOW_PADDING = 24;
export const WORKSPACE_GAP = 10;
export const HUD_COLUMN_WIDTH = 320;

export function minimumAppWindowWidth() {
  return BOARD_TARGET_WIDTH + BOARD_PANEL_PADDING + APP_WINDOW_PADDING + WORKSPACE_GAP + HUD_COLUMN_WIDTH;
}
