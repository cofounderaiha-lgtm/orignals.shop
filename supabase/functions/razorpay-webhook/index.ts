/* ============================================================
   ORIGNALS · razorpay-webhook — Razorpay calls this endpoint on
   payment.captured / payment.failed. The HMAC-SHA256 signature is
   checked with RZP_WEBHOOK_SECRET (independent of the API key
   secret), then the payment is written to the ledger. This is the
   server-side source of truth for keyless (direct) checkout.
   ============================================================ */
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  const secret = Deno.env.get("RZP_WEBHOOK_SECRET");
  if (!secret) return json({ error: "webhook not configured" }, 503);

  const body = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";
  const expected = await hmacHex(secret, body);
  if (expected !== sig) return json({ error: "bad signature" }, 401);

  try {
    const evt = JSON.parse(body);
    const type = String(evt.event || "");
    const p = evt.payload?.payment?.entity;
    if (p && p.id) {
      const notes = p.notes || {};
      const row = {
        rzp_order_id: p.order_id || `direct_${p.id}`,
        rzp_payment_id: p.id,
        amount_paise: p.amount,
        purpose: String(notes.purpose || "order").slice(0, 30),
        ref: String(notes.ref || "").slice(0, 60),
        device_key: String(notes.device || "").slice(0, 60),
        status: type === "payment.captured" ? "verified" : type === "payment.failed" ? "failed" : "created",
        verified_at: type === "payment.captured" ? new Date().toISOString() : null,
        raw: { event: type, method: p.method || null, email: p.email || null, contact: p.contact || null },
      };
      const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/payments?on_conflict=rzp_order_id`, {
        method: "POST",
        headers: {
          apikey: sr, Authorization: `Bearer ${sr}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(row),
      });
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
