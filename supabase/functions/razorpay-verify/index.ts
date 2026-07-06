/* ============================================================
   ORIGNALS · razorpay-verify — verifies the payment signature
   (HMAC-SHA256 of "order_id|payment_id" with the key secret) and
   marks the ledger row verified. Money is only trusted after this.
   ============================================================ */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { orderId, paymentId, signature } = await req.json();
    if (!orderId || !paymentId || !signature) return json({ error: "missing fields" }, 400);
    const keySecret = Deno.env.get("RZP_KEY_SECRET");
    if (!keySecret) return json({ error: "payments not configured" }, 503);

    const expected = await hmacHex(keySecret, `${orderId}|${paymentId}`);
    const ok = expected === String(signature);

    const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/payments?rzp_order_id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          ok
            ? { status: "verified", rzp_payment_id: paymentId, verified_at: new Date().toISOString() }
            : { status: "failed", rzp_payment_id: paymentId },
        ),
      },
    );

    return ok ? json({ verified: true }) : json({ verified: false, error: "signature mismatch" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
