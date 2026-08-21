/**
 * Wait for the browser to paint — but never longer than it's worth.
 *
 * Both the converter and the 3D viewer show a status line ("Reading colors & geometry…",
 * "Preparing model…") and then run a long, main-thread-blocking parse. Two animation frames is the
 * reliable way to guarantee that line has actually painted before the thread locks up; one frame
 * isn't enough, because React's commit and the browser's paint are separate.
 *
 * The trap: **requestAnimationFrame does not fire in a hidden tab.** Pick a file, switch tabs, and
 * `await`ing two frames never resolves — so the parse never starts, and the page sits on "Reading
 * colors & geometry…" indefinitely with no error. Found while testing in a non-compositing browser
 * pane, where document.hidden is true and rAF callbacks never ran at all.
 *
 * So: race the frames against a short timeout. If we're visible, the timeout loses and we get a real
 * paint. If we're hidden, there is nothing to paint for and the timeout releases us — correct in both
 * directions, rather than trading a stall for a flicker.
 */
export function nextPaint(timeoutMs = 100): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
  });
}
