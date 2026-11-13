import { after } from "next/server";
import { notifyView, type Audience, type PushPayload } from "@/server/services/notify";

// Sends a push once the response has gone out, so a slow push service never delays the screen. Call it from a server
// action or route handler after the work succeeded. Anywhere `after` isn't available it quietly does nothing.
export function pushAfter(audience: Audience, payload: PushPayload) {
  try {
    after(() => notifyView(audience, payload));
  } catch {
    /* not inside a request: nothing to notify */
  }
}
