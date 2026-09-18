let counter = 0;

export function nextTransactionId() {
  counter = (counter % 2_000_000_000) + 1;
  return counter;
}
