// Pure: the side panel in a layout tree. The panel is the column "panel"; what it shows is the
// child of the stack "panel-body" named by its `active`.

export function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

export function hasPanel(root, child) {
  const body = findNode(root, "panel-body");
  return Array.isArray(body?.children) && body.children.some((entry) => entry.id === child);
}

export function panelShows(root, child) {
  const panel = findNode(root, "panel");
  return Boolean(panel && !panel.hidden && findNode(root, "panel-body")?.active === child);
}
