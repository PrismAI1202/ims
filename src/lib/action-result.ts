/** What a server action hands back to its form when a rule is broken: the message, and the input names it is about. */
export interface ActionFailure { error: string; fields: string[] }

/** The shape of a server action a `<Form>` can run. Success redirects, so a returned value is always a failure. */
export type FormAction = (formData: FormData) => void | ActionFailure | undefined | Promise<void | ActionFailure | undefined>;

/** Set by `components/form.tsx` while it submits, to say "answer a rule violation in place; don't navigate". */
export const INLINE_COOKIE = "ims-inline";
