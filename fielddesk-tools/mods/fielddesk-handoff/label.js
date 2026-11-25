// Pure: which terminal label holds a session's one-line context. Herdr's settings() carries only
// the look, so herdr_context_label is read from settings.json itself. Each mod keeps its own copy
// because a mod folder is installed on its own; fielddesk-queue's test keeps the copies equal.

export const DEFAULT_CONTEXT_LABEL = "herdr.context";

export function contextLabelFrom(settingsText) {
  try {
    const value = JSON.parse(settingsText ?? "")?.herdr_context_label;
    return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_CONTEXT_LABEL;
  } catch {
    return DEFAULT_CONTEXT_LABEL;
  }
}
