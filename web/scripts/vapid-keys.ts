// Mint a fresh VAPID keypair for the Web Push pipeline and print an .env block ready
// to paste. One-command onboarding for the push feature:
//
//   bun run vapid:keys
//
// The keypair never expires; you only need a new one if you want to invalidate every
// existing push subscription (rotating keys disconnects all subscribers, since the
// browser tied each subscription to the previous publicKey).
import webpush from "web-push";

const subject = process.argv[2] ?? "mailto:ops@renown.local";
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("# Generated VAPID keypair. Paste into your .env (or set as deploy env vars).");
console.log("# Subject must be an https:// URL or mailto: identifying you to push services.");
console.log("# Override the default subject by passing it as argv[1].");
console.log("");
console.log(`RENOWN_VAPID_SUBJECT=${subject}`);
console.log(`RENOWN_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`RENOWN_VAPID_PRIVATE_KEY=${privateKey}`);
