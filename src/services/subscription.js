const supabaseAdmin = require("../lib/supabase-admin");

function getCurrentPeriodBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function getPlanForUser(userId) {
  const { data: subs, error: subsError } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("current_period_end", { ascending: false })
    .limit(1);

  if (subsError) {
    console.error("Error loading subscriptions:", subsError);
  }

  const subscription = subs && subs.length > 0 ? subs[0] : null;
  let plan = null;

  if (subscription) {
    const { data: planData, error: planError } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("id", subscription.plan_id)
      .limit(1);

    if (planError) {
      console.error("Error loading plan for subscription:", planError);
    }

    if (planData && planData.length > 0) {
      plan = planData[0];
    }
  }

  if (!plan) {
    const { data: fallbackPlans, error: fallbackError } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("name", "free")
      .eq("is_active", true)
      .limit(1);

    if (fallbackError) {
      console.error("Error loading fallback plan:", fallbackError);
    }

    if (fallbackPlans && fallbackPlans.length > 0) {
      plan = fallbackPlans[0];
    }
  }

  return { plan, subscription };
}

async function getOrCreateUsage(userId) {
  const { startDate, endDate } = getCurrentPeriodBounds();

  const { data: existingRows, error: findError } = await supabaseAdmin
    .from("usage_tracking")
    .select("*")
    .eq("user_id", userId)
    .eq("period_start", startDate)
    .limit(1);

  if (findError) {
    console.error("Error loading usage_tracking:", findError);
  }

  if (existingRows && existingRows.length > 0) {
    return existingRows[0];
  }

  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from("usage_tracking")
    .insert({
      user_id: userId,
      period_start: startDate,
      period_end: endDate,
      conversations_used: 0,
      messages_used: 0,
    })
    .select()
    .limit(1);

  if (insertError) {
    console.error("Error inserting usage_tracking:", insertError);
    throw insertError;
  }

  return insertedRows[0];
}

async function checkAndIncrementUsage(userId, options) {
  const isNewConversation = options.isNewConversation || false;
  const messagesDelta = options.messagesDelta || 0;

  const { plan } = await getPlanForUser(userId);
  const usage = await getOrCreateUsage(userId);

  if (plan && isNewConversation) {
    if (
      typeof plan.conversation_limit === "number" &&
      usage.conversations_used >= plan.conversation_limit
    ) {
      return {
        allowed: false,
        reason: "conversation_limit_reached",
        plan,
        usage,
      };
    }
  }

  const newConversationsUsed =
    usage.conversations_used + (isNewConversation ? 1 : 0);
  const newMessagesUsed = usage.messages_used + messagesDelta;

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("usage_tracking")
    .update({
      conversations_used: newConversationsUsed,
      messages_used: newMessagesUsed,
    })
    .eq("id", usage.id)
    .select()
    .limit(1);

  if (updateError) {
    console.error("Error updating usage_tracking:", updateError);
    throw updateError;
  }

  const updatedUsage =
    updatedRows && updatedRows.length > 0 ? updatedRows[0] : usage;

  return {
    allowed: true,
    reason: null,
    plan,
    usage: updatedUsage,
  };
}

module.exports = {
  getPlanForUser,
  getOrCreateUsage,
  checkAndIncrementUsage,
};

s;
