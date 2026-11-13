declare module "web-push" {
  export interface PushSubscriptionJson { endpoint: string; keys: { p256dh: string; auth: string } }
  export class WebPushError extends Error { statusCode: number }
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: PushSubscriptionJson, payload?: string, options?: { TTL?: number; urgency?: string; topic?: string }): Promise<unknown>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
