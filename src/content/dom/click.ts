type ClickOptions = {
  root?: ParentNode;
  timeoutMs?: number;
};

const CLICKABLE_SELECTOR = "button, a, [role='button'], .ut-tab-bar-item, .tile";

const isVisible = (el: Element) => {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const resolveClickable = (el: Element) => {
  if (el instanceof HTMLElement && el.matches(CLICKABLE_SELECTOR)) return el;
  return (el.closest(CLICKABLE_SELECTOR) as HTMLElement | null) ?? (el as HTMLElement);
};

const dispatchMouseSequence = (el: HTMLElement) => {
  const eventInit: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  if (typeof PointerEvent !== "undefined") {
    el.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    el.dispatchEvent(new PointerEvent("pointerup", eventInit));
  }
  el.dispatchEvent(new MouseEvent("mousedown", eventInit));
  el.dispatchEvent(new MouseEvent("mouseup", eventInit));
  el.dispatchEvent(new MouseEvent("click", eventInit));
};

const waitFor = async (fn: () => boolean, timeoutMs: number) => {
  const start = Date.now();

  return new Promise<boolean>((resolve) => {
    const tick = () => {
      if (fn()) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      requestAnimationFrame(tick);
    };
    tick();
  });
};

export const clickBySelector = async (selector: string, opts: ClickOptions = {}) => {
  const { root = document, timeoutMs = 5000 } = opts;

  const ok = await waitFor(() => {
    const el = root.querySelector(selector);
    if (!el) return false;
    const clickable = resolveClickable(el);
    if (!isVisible(clickable)) return false;

    clickable.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    dispatchMouseSequence(clickable);
    clickable.click();
    return true;
  }, timeoutMs);

  if (!ok) console.warn("[FC Helper] element not found/visible:", selector);
  return ok;
};

export const clickBySelectors = async (selectors: readonly string[], opts: ClickOptions = {}) => {
  for (const selector of selectors) {
    const ok = await clickBySelector(selector, opts);
    if (ok) return true;
  }
  console.warn("[FC Helper] none of selectors matched:", selectors);
  return false;
};
