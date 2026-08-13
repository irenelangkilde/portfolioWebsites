/**
 * Session provisioning claim — the race guard shared by the two paths that grant
 * membership: stripeWebhook (server-to-server) and provisionFromSession (called by
 * purchased.html on redirect).
 *
 * Both are wanted. The webhook is authoritative but can be delayed or retried; the client
 * call means a customer is not left staring at an unprovisioned account. What is not
 * wanted is both of them granting the same session, which is what happened: they arrive
 * within about a second of each other, so neither saw the other's work, and hosting_until
 * — which stacks rather than assigns — doubled.
 *
 * claimSession returns true to exactly one caller per session id. The database primary
 * key does the arbitration, so it holds under any interleaving and across retries.
 */

/**
 * @returns {Promise<boolean>} true if THIS caller may provision the session.
 */
export async function claimSession(supabase, sessionId, userId, source) {
  if (!sessionId) return true;   // nothing to key on; caller decides as before

  try {
    // .select() matters: without it there is no way to distinguish "I inserted" from
    // "someone already had it". ignoreDuplicates makes the conflict silent rather than
    // an error, and the returned rows are the evidence of who won.
    const { data, error } = await supabase
      .from("provisioned_sessions")
      .upsert(
        { stripe_session_id: sessionId, user_id: userId || null, source: source || null },
        { onConflict: "stripe_session_id", ignoreDuplicates: true }
      )
      .select("stripe_session_id");

    if (error) {
      // Fail OPEN. If the claim mechanism is broken, the alternative is refusing to
      // provision someone who has paid — a far worse failure than an extra month of
      // hosting. Logged loudly because it silently reintroduces the double-grant.
      console.error(`[claim] could not claim ${sessionId} (${source}):`, error.message);
      return true;
    }

    const won = Array.isArray(data) && data.length > 0;
    console.log(won
      ? `[claim] ${source} provisioning ${sessionId}`
      : `[claim] ${source} skipping ${sessionId} — already provisioned`);
    return won;
  } catch (err) {
    console.error(`[claim] threw for ${sessionId} (${source}):`, err?.message);
    return true;   // same reasoning as above
  }
}
