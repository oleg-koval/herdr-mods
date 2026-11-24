const clean = (value) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim() : "";

export function resumeNote({ space, tab, folder, branch, context }) {
  const session = [clean(space), clean(tab)].filter(Boolean).join(" / ");
  return [
    "Resume this session",
    session && `Session: ${session}`,
    clean(folder) && `Folder: ${clean(folder)}`,
    clean(branch) && `Branch: ${clean(branch)}`,
    clean(context) ? `Recorded context: ${clean(context)}` : "Recorded context: unavailable",
  ].filter(Boolean).join("\n");
}
