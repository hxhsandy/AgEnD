// #2347: one save model for Settings. A section's edits are its draft from the first keystroke: the draft is kept while
// the person moves between sections, staged as soon as it differs from what is saved (the sticky bar counts it and offers
// Save), and dropped on Save or Discard. Nothing is written until Save.
import { useEffect, useMemo, useState } from "/assets/app-html.js";
import { sameValue } from "./settings-model.js";

/**
 * #2347 (leader's default, for the user to confirm): over the temporary public link the Fleet sections are read-only —
 * the bar never offers Save there, and the page says why. One switch to flip. It is the page's policy: the server
 * refuses Web, Guests and Web authority writes over the link, and takes the other fleet writes from an admin's session,
 * so every Settings write the page makes checks it (settings-confirm.js api, settings-apply.js startOperation).
 */
export const FLEET_READ_ONLY_OVER_PUBLIC_LINK = true;
export const overPublicLink = () => globalThis.document?.body?.dataset?.publicLink === "1";
export const fleetReadOnly = () => FLEET_READ_ONLY_OVER_PUBLIC_LINK && overPublicLink();

/** The fields of `form` that differ from `saved` (a draft is only what was edited). */
export function editsOf(form, saved) {
  const out = {};
  for (const k of Object.keys(form)) if (!sameValue(form[k], saved[k])) out[k] = form[k];
  return out;
}

/**
 * A section's form, kept in the panel's drafts by `key` while it differs from what is saved: leaving the section and
 * coming back shows the same edits (they are still staged). `saved` builds the form from the saved configuration;
 * `init` (default: `saved`) is the form a section starts from when no draft is kept.
 *
 * #2367 review: the draft is the edited fields only, put back over what is saved when the section is shown again — a
 * field never touched follows the configuration as it is now (another admin's change since), never a stale copy of it.
 */
export function useDraft(ctx, key, saved, init = saved) {
  const base = useMemo(saved, []);
  const [form, setForm] = useState(() => (ctx.drafts && ctx.drafts.has(key) ? { ...base, ...ctx.drafts.get(key) } : init()));
  useEffect(() => {
    if (!ctx.drafts) return;
    const edits = editsOf(form, base);
    if (Object.keys(edits).length) ctx.drafts.set(key, edits);
    else ctx.drafts.delete(key);
  }, [form]);
  return [form, setForm];
}

/**
 * Bring the staged change `key` in line with a section's draft: staged (quietly — the bar says it) when there is one,
 * unstaged when the draft equals what is saved. An invalid draft is staged as `{ label, invalid }` with no request: it
 * counts as unsaved, and Save waits until it is fixed (its message is shown at the field).
 */
export function syncStage(ctx, key, change) {
  if (change) ctx.stage(key, change, true);
  else ctx.unstage(key);
}
