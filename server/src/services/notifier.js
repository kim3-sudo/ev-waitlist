// Stand-in notification channel. Swap the body of `notify` for a real
// SMS/email/push provider -- the rest of the app only depends on this
// function's signature.
export async function notify(contact, message) {
  console.log(`[notify -> ${contact}] ${message}`);
}
