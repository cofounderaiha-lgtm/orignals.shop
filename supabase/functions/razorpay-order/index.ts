/* ============================================================
   ORIGNALS · razorpay-order — creates a Razorpay order server-side.
   The Razorpay KEY SECRET lives only in Supabase secrets, never in
   the app. Returns { orderId, keyId, amount } for Checkout.
   ============================================================ */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { amount, purpose, ref, device } = await req.json();
    if (!Number.isInteger(amount) || amount < 100 || amount > 50000000) {
      return json({ error: "amount must be 100–50000000 paise" }, 400);
    }
    const keyId = Deno.env.get("RZP_KEY_ID");
    const keySecret = Deno.env.get("RZP_KEY_SECRET");
    if (!keyId || !keySecret) return json({ error: "payments not configured" }, 503);

    const rr = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: String(ref || "orignals").slice(0, 40),
        notes: { purpose: String(purpose || "order").slice(0, 30), device: String(device || "").slice(0, 60) },
      }),
    });
    const order = await rr.json();
    if (!rr.ok) return json({ error: order?.error?.description || "razorpay order failed" }, 502);

    // ledger row (service role, injected automatically)
    await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/payments`, {
      method: "POST",
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        rzp_order_id: order.id,
        amount_paise: amount,
        purpose: String(purpose || "order").slice(0, 30),
        ref: String(ref || "").slice(0, 60),
        device_key: String(device || "").slice(0, 60),
        status: "created",
      }),
    });

    return json({ orderId: order.id, keyId, amount });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
