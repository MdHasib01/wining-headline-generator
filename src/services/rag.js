const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const supabase = require("../lib/supabase");

const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.7,
  apiKey: process.env.OPENAI_API_KEY,
});

async function getWinningHeadlines(limit = 30) {
  const { data, error } = await supabase
    .from("headlines")
    .select("*")
    .order("hook_score", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching headlines:", error);
    return [];
  }
  return data || [];
}

async function generateDraftHeadlines(topic) {
  const prompt = `You are a viral marketing expert. Generate 3 draft headlines for the topic: "${topic}".
Focus on high click-through rate.
Return them as a JSON array of strings. Do not include markdown formatting.`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  try {
    let content = response.content.trim();
    if (content.startsWith("```json")) {
      content = content.replace(/^```json/, "").replace(/```$/, "");
    } else if (content.startsWith("```")) {
      content = content.replace(/^```/, "").replace(/```$/, "");
    }
    return JSON.parse(content);
  } catch (e) {
    console.error("Error parsing draft headlines:", e);
    // Fallback simple parsing if JSON fails
    return response.content
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.replace(/^\d+\.\s*/, "").replace(/"/g, ""));
  }
}

async function classifyTopic(topic) {
  const prompt = `Classify the following topic into one of these viral frameworks: List, Curiosity, Timeliness, Desire, Fear, Polarizing.
Topic: "${topic}"
Return only the framework name. If unsure, choose Curiosity.`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  return response.content.trim();
}

function filterAndSelectExamples(examples, category, targetCount = 5) {
  // Map user categories to DB frameworks
  const keywords = [category];
  if (category === "Fear") keywords.push("Negativity", "Fear");
  if (category === "Polarizing")
    keywords.push("Negativity", "Controversy", "Extreme");
  if (category === "Timeliness") keywords.push("Time Frame");

  const matches = examples.filter((h) => {
    if (!h.framework) return false;
    return keywords.some((k) =>
      h.framework.toLowerCase().includes(k.toLowerCase()),
    );
  });

  // If we have enough matches, pick from them
  let selected = [];
  if (matches.length >= targetCount) {
    // Randomly pick targetCount from matches
    selected = matches.sort(() => 0.5 - Math.random()).slice(0, targetCount);
  } else {
    // Take all matches and fill the rest with random high-scoring ones
    selected = [...matches];
    const remainingNeeded = targetCount - selected.length;
    const remainingPool = examples.filter((h) => !selected.includes(h));
    const randomFill = remainingPool
      .sort(() => 0.5 - Math.random())
      .slice(0, remainingNeeded);
    selected = [...selected, ...randomFill];
  }

  return selected;
}

async function generateFinalHeadlines(drafts, examples, category, topic) {
  const draftsText = drafts.map((d, i) => `${i + 1}. ${d}`).join("\n");
  const examplesText = examples
    .map(
      (h, i) =>
        `${i + 1}. "${h.title}"
   - Framework: ${h.framework}
   - Why it works: ${h.why}`,
    )
    .join("\n\n");

  const prompt = `You are an expert headline writer.
The user's topic is: "${topic}"
The predicted viral framework is: ${category}

Here are some initial draft headlines:
${draftsText}

Here are proven winning headlines (Hooks) that performed well, and why they worked:
${examplesText}

Your task:
Rewrite the draft headlines into 5-10 optimized viral headlines.
Apply the principles and styles from the winning examples.
You can mix and match frameworks, but lean towards the "${category}" style if appropriate.
Focus on:
- Psychological triggers (Curiosity, Gap, Negative Bias, etc.)
- Punchiness
- Clarity

Return the result as a valid JSON array of objects with keys: "headline", "framework_used", "explanation".
Do not include markdown formatting.`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  try {
    let content = response.content.trim();
    if (content.startsWith("```json")) {
      content = content.replace(/^```json/, "").replace(/```$/, "");
    } else if (content.startsWith("```")) {
      content = content.replace(/^```/, "").replace(/```$/, "");
    }
    return JSON.parse(content);
  } catch (e) {
    console.error("Error parsing final headlines:", e);
    return [
      {
        headline: "Error parsing headlines",
        framework_used: "Error",
        explanation: "Please try again.",
      },
    ];
  }
}

async function generateHeadlineWithRAG(userQuery) {
  console.log(`Generating headlines for topic: ${userQuery}`);

  // 1. Draft Generation
  const drafts = await generateDraftHeadlines(userQuery);
  console.log(`Generated ${drafts.length} drafts.`);

  // 2. Retrieve Examples
  const allExamples = await getWinningHeadlines(30);
  console.log(`Retrieved ${allExamples.length} examples.`);

  // 3. Classification
  const category = await classifyTopic(userQuery);
  console.log(`Classified as: ${category}`);

  // 4. Filter and Random Selection (Target 5-10, let's say 5 for context length)
  const selectedExamples = filterAndSelectExamples(allExamples, category, 5);
  console.log(`Selected ${selectedExamples.length} examples for context.`);

  // 5. Final Generation
  const finalHeadlines = await generateFinalHeadlines(
    drafts,
    selectedExamples,
    category,
    userQuery,
  );

  return {
    headline: finalHeadlines, // Returning the array of objects directly
    sources: selectedExamples.map((h) => ({
      title: h.title,
      framework: h.framework,
    })),
  };
}

module.exports = {
  generateHeadlineWithRAG,
};
