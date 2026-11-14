"use client";

import { useRef, useState, useTransition, type FormHTMLAttributes } from "react";
import { INLINE_COOKIE, type FormAction } from "@/lib/action-result";

// A form that keeps what the user typed when something is missing or wrong.
//
// A plain `<form action={serverAction}>` is wiped when the action fails: React resets the fields, and redirecting to `?error=…`
// makes Next rebuild the whole page (a new search string is a new page), taking every field and open panel with it. This wrapper
//  - checks required fields in the browser first and highlights the empty ones (red outline, message under the form),
//  - sends the form itself, so React never resets it,
//  - asks the server to answer a broken rule in place (the cookie below; `runAction` then returns the message instead of
//    redirecting), so the page is never rebuilt: every field, open panel and added row stays,
//  - highlights the fields a server rule names (`DomainError(message, [inputNames])`) and shows its message by the button, and
//  - makes the form inert while the request runs, so a double tap cannot post twice.
// A submit button may say which of several actions was meant: `name="intent" value="delete"` plus `intents={{ delete: … }}`.

const fieldsOf = (form: HTMLFormElement) =>
  Array.from(form.elements).filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement);

const mark = (el: Element) => { el.setAttribute("aria-invalid", "true"); };
const unmark = (form: HTMLFormElement) => form.querySelectorAll("[aria-invalid='true']").forEach((el) => el.removeAttribute("aria-invalid"));

/** The visible label of a field, for "Fill in: Vehicle no., Invoice no.". */
function labelOf(el: HTMLElement): string {
  const own = el.getAttribute("aria-label");
  const label = el.closest("label") ?? el.parentElement;
  // The label's own words: its text, and any caption span beside the control (not a span that wraps the control itself).
  const text = Array.from(label?.childNodes ?? [])
    .filter((n) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.tagName === "SPAN" && !n.querySelector("input,select,textarea")))
    .map((n) => n.textContent).join(" ").trim();
  return (own || text || humanize(el.getAttribute("name"))).replace(/[.:\s]+$/, "");
}

/** "itemId" -> "Item", "qty_cm12ab" -> "Qty", for a field with no visible label. */
function humanize(name: string | null): string {
  const base = (name ?? "").replace(/_[a-z0-9]{8,}$/i, "").replace(/Id$/, "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "A field";
}

function focusFirst(els: HTMLElement[]) {
  const first = els[0];
  if (!first) return;
  first.scrollIntoView({ block: "center", behavior: "smooth" });
  first.focus({ preventScroll: true });
}

const setInline = (on: boolean) => { document.cookie = `${INLINE_COOKIE}=${on ? "1" : ""}; path=/; max-age=${on ? 30 : 0}; samesite=lax`; };

export function Form({
  action, intents, children, ...rest
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> & {
  action: FormAction;
  /** Other actions a submit button can ask for with `name="intent" value="…"` (Reset, Delete, Put back in service). */
  intents?: Record<string, FormAction>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <form
      {...rest}
      ref={ref}
      noValidate
      aria-busy={pending}
      inert={pending}  // no fieldset around the fields (it would break `space-y` and grid layouts); inert blocks a second tap just the same
      className={`${rest.className ?? ""} ${pending ? "opacity-70" : ""}`.trim() || undefined}
      onInput={(e) => (e.target as HTMLElement).removeAttribute?.("aria-invalid")}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        unmark(form);
        if (!submitter?.formNoValidate) {
          const bad = fieldsOf(form).filter((el) => el.willValidate && !el.checkValidity());
          if (bad.length) {
            bad.forEach(mark);
            const names = [...new Set(bad.map(labelOf))];
            setProblem(`Fill in the highlighted field${bad.length === 1 ? "" : "s"}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}.`);
            focusFirst(bad);
            return;
          }
        }
        setProblem(null);
        const data = new FormData(form, submitter ?? undefined);
        const run = (submitter?.name === "intent" && intents?.[submitter.value]) || action;
        start(async () => {
          setInline(true);
          try {
            const result = await run(data); // success redirects; a value coming back is a broken rule
            if (result && typeof result === "object" && "error" in result) {
              setProblem(result.error);
              // A name shared by repeated rows (every row's price) marks only the blank ones when some are blank, not the whole column.
              const hit = result.fields.flatMap((n) => {
                const els = fieldsOf(form).filter((el) => el.name === n);
                const blank = els.filter((el) => !el.value.trim());
                return els.length > 1 && blank.length ? blank : els;
              });
              hit.forEach(mark);
              setTimeout(() => focusFirst(hit), 60); // after the fields are enabled again
            }
          } finally {
            setInline(false);
          }
        });
      }}
    >
      {children}
      {problem && <p role="alert" className="col-span-full mt-3 rounded-xl bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">{problem}</p>}
    </form>
  );
}
