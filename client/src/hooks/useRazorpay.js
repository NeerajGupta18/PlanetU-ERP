const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

/** Loads Razorpay's Checkout script once. Resolves false (never throws) if it cannot be loaded. */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { loading = null; s.remove(); resolve(false); };
    document.body.appendChild(s);
  });
  return loading;
}
