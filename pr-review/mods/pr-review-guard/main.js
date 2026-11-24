// pr-review-guard: the always-on half of pr-review, a kept 1x1 window nobody sees.
//
// It turns Ctrl-Cmd-R into "open or select the board tab" and keeps the Dock badge at the Needs-you
// count. The board lives in ../pr-review; engine.js and rules.js here are identical copies of its files
// (a mod cannot import outside its folder).

import { View, div } from "gpui-kit";
import { checking, nextCommand, run, setBadge, spaces } from "herdr";
import { engineBin, makeEngine } from "./engine.js";
import { findTab, needsCount } from "./rules.js";

const GUARD_MS = 120000;

export default class PrReviewGuard extends View {
  init(_props, cx) {
    if (checking()) return;
    this.engine = makeEngine(engineBin());
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") this.openBoard();
      }
    });
    const tick = (cx) =>
      cx.spawn(async () => {
        const r = await this.engine.read();
        // A failed or too-old read leaves the badge as it was: missing data is not zero.
        if (r.snap) {
          const n = needsCount(r.snap);
          setBadge(n > 0 ? String(n) : null);
        }
      });
    tick(cx);
    cx.timer.every(GUARD_MS, tick);
  }

  openBoard() {
    const tab = findTab(spaces(), "PR review");
    if (tab) run("tab.select", { id: tab.id });
    else run("tab.new", { name: "PR review", mod: "pr-review", props: { role: "board" } });
  }

  render() {
    return div().size_full();
  }
}
