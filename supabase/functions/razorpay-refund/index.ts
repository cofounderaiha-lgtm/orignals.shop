/* ============================================================
   ORIGNALS · razorpay-refund — executes a REAL refund.  (⚠ FROZEN — NOT DEPLOYED)
   Pairs with migration 0015_finance_refunds_coupling.sql. Deploy only after that
   migration is staged + verified. The key secret never leaves the server.

   Flow (money is only ever moved server-side, and only for a real captured payment):
     1) refund_open(p_order, p_device, p_reason)  — device-scoped ownership check;
        finds the VERIFIED payment; refuses COD/unpaid ('nothing_to_refund');
        idempotent (one refund per order). Also voids the seller settlement.
     2) if not already succeeded → POST Razorpay /v1/payments/:id/refund (Basic auth).
     3) _refund_apply(p_order, rzp_refund_id, ok)  — service-role only; marks the
        refund succeeded/failed and writes the immutable finance_event.
   ============================================================ */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const REST = () => Deno.env.get("SUPABASE_URL") + "/rest/v1";
function srHeaders() {
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" };
}
async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${REST()}/rpc/${fn}`, { method: "POST", headers: srHeaders(), body: JSON.stringify(body) });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { orderRef, device, reason } = await req.json();
    if (!orderRef || !device) return json({ error: "missing fields" }, 400);

    const keyId = Deno.env.get("RZP_KEY_ID");
    const keySecret = Deno.env.get("RZP_KEY_SECRET");
    if (!keyId || !keySecret) return json({ error: "payments not configured" }, 503);

    // 1) open/validate the refund (ownership + verified-payment + idempotency, voids settlement)
    const opened = await rpc("refund_open", { p_order: orderRef, p_device: device, p_reason: reason || "" });
    if (!opened || opened.ok !== true) {
      return json({ ok: false, reason: (opened && opened.reason) || "cannot_refund" }, 400);
    }

    // already refunded? don't double-call the provider
    const st = await rpc("refund_status", { p_order: orderRef, p_device: device });
    if (st && st.status === "succeeded") return json({ ok: true, already: true });

    const paymentId = opened.payment;
    const amountPaise = Number(opened.amount_paise || 0);
    if (!paymentId || amountPaise <= 0) return json({ ok: false, reason: "no_captured_payment" }, 400);

    // 2) execute the refund at Razorpay (Basic auth: keyId:keySecret)
    const auth = "Basic " + btoa(`${keyId}:${keySecret}`);
    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, speed: "normal", notes: { orderRef } }),
    });
    const rzp = await rzpRes.json().catch(() => ({}));

    // 3) record the outcome (service role; _refund_apply is not anon-callable)
    if (rzpRes.ok && rzp && rzp.id) {
      await rpc("_refund_apply", { p_order: orderRef, p_rzp_refund: rzp.id, p_ok: true });
      return json({ ok: true, refundId: rzp.id, amount_paise: amountPaise });
    } else {
      await rpc("_refund_apply", { p_order: orderRef, p_rzp_refund: null, p_ok: false });
      return json({ ok: false, reason: (rzp && rzp.error && rzp.error.description) || "provider_error" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
