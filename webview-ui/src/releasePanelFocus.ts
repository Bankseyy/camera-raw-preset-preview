type FocusApi = {
  releasePhotoshopFocus?: () => Promise<void> | void;
};

type ReleaseFocusOptions = {
  releaseHost?: boolean;
};

const isEditableElement = (element: Element | null): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  return tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
    || element.isContentEditable
    || !!element.closest("[contenteditable='true']");
};

const shouldPreservePanelFocus = (): boolean => isEditableElement(document.activeElement);

export function releasePanelFocus(api?: FocusApi, options: ReleaseFocusOptions = {}) {
  const shouldReleaseHost = options.releaseHost !== false;

  const blurNow = () => {
    if (shouldPreservePanelFocus()) return false;
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch (_) {}
    try {
      document
        .querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]")
        .forEach(element => {
          if (element === document.activeElement) element.blur();
        });
    } catch (_) {}
    try { window.blur(); } catch (_) {}
    return true;
  };

  const nudgePhotoshop = () => {
    if (shouldPreservePanelFocus()) return;
    if (!shouldReleaseHost) return;
    try { void api?.releasePhotoshopFocus?.(); } catch (_) {}
  };

  blurNow();
  nudgePhotoshop();
  window.setTimeout(() => {
    blurNow();
    nudgePhotoshop();
  }, 0);
  window.setTimeout(() => {
    blurNow();
    nudgePhotoshop();
  }, 50);
  window.setTimeout(() => {
    blurNow();
    nudgePhotoshop();
  }, 350);
}
