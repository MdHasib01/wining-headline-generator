const axios = require("axios");
const supabase = require("../lib/supabase");

const ANTHROPIC_API_URL =
  process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
const FALLBACK_MODELS = [
  "claude-3-5-sonnet-20241022",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
];

function buildModelCandidates() {
  const candidates = [];
  if (process.env.ANTHROPIC_MODEL) {
    candidates.push(process.env.ANTHROPIC_MODEL);
  }
  if (MODEL && !candidates.includes(MODEL)) {
    candidates.push(MODEL);
  }
  for (const model of FALLBACK_MODELS) {
    if (!candidates.includes(model)) {
      candidates.push(model);
    }
  }
  return candidates;
}

async function createMessage(
  prompt,
  { temperature = 0.7, maxTokens = 4096, system = "" } = {},
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const modelsToTry = buildModelCandidates();

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    try {
      const body = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      };
      if (system) {
        body.system = system;
      }

      const response = await axios.post(ANTHROPIC_API_URL, body, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      });

      const content = response?.data?.content || [];
      const text = content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block && block.type === "text") return block.text || "";
          return "";
        })
        .join("");

      return text.trim();
    } catch (error) {
      const status = error?.response?.status;
      const hasMoreModels = i < modelsToTry.length - 1;
      if (status === 404 && hasMoreModels) {
        continue;
      }
      if (status) {
        const details =
          error?.response?.data?.error ||
          error?.response?.data?.message ||
          error.message;
        throw new Error(
          `Anthropic request failed (${status}) for model "${model}": ${details}`,
        );
      }
      throw error;
    }
  }

  throw new Error("Anthropic request failed for all configured models");
}

function extractJSON(text) {
  try {
    const trimmed = text.trim();
    // Try simple parse first
    return JSON.parse(trimmed);
  } catch (e) {
    // Look for first [ or { and last ] or }
    const startBracket = text.indexOf("[");
    const endBracket = text.lastIndexOf("]");
    const startBrace = text.indexOf("{");
    const endBrace = text.lastIndexOf("}");

    let start = -1;
    let end = -1;

    // Determine if it's an array or an object
    if (
      startBracket !== -1 &&
      (startBrace === -1 || startBracket < startBrace)
    ) {
      start = startBracket;
      end = endBracket;
    } else if (startBrace !== -1) {
      start = startBrace;
      end = endBrace;
    }

    if (start !== -1 && end !== -1 && end > start) {
      const jsonStr = text.substring(start, end + 1);
      try {
        return JSON.parse(jsonStr);
      } catch (innerError) {
        throw new Error(
          `Failed to parse extracted JSON: ${innerError.message}`,
        );
      }
    }
    throw e;
  }
}

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
  const system =
    "You are a viral marketing expert. You must respond ONLY with a JSON array of strings. Do not include any introductory or concluding text.";
  const prompt = `Generate 3 draft headlines for the topic: "${topic}". Focus on high click-through rate.`;

  const response = await createMessage(prompt, {
    temperature: 0.6,
    maxTokens: 1024,
    system,
  });
  try {
    return extractJSON(response);
  } catch (e) {
    console.error("Error parsing draft headlines:", e);
    // Fallback simple parsing if JSON fails
    return response
      .split("\n")
      .filter(
        (l) => l.trim() && !l.trim().startsWith("[") && !l.trim().endsWith("]"),
      )
      .map((l) =>
        l
          .replace(/^\d+\.\s*/, "")
          .replace(/"/g, "")
          .replace(/^-/, "")
          .trim(),
      )
      .filter((l) => l.length > 0);
  }
}

async function classifyTopic(topic) {
  const prompt = `Classify the following topic into one of these viral frameworks: List, Curiosity, Timeliness, Desire, Fear, Polarizing.
Topic: "${topic}"
Return only the framework name. If unsure, choose Curiosity.`;

  const response = await createMessage(prompt, {
    temperature: 0.2,
    maxTokens: 100,
  });
  return response.trim();
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

  const system = `You are an expert headline writer. You must respond ONLY with a JSON array of objects.
Each object must have these keys: "headline", "framework_used", "explanation".
Do not include any introductory or concluding text.`;

  const prompt = `The user's topic is: "${topic}"
The predicted viral framework is: ${category}

Here are some initial draft headlines:
${draftsText}

Here are proven winning headlines (Hooks) that performed well, and why they worked:
${examplesText}

Your task:
Rewrite the draft headlines into optimized viral headlines.
Follow these rules for the number of headlines:
1. If the user specifies a number in their topic (e.g., "10 headlines about..."), generate exactly that number.
2. If no number is specified, generate between 5 and 20 headlines.
3. Minimum headlines generated must always be at least 5.
4. IMPORTANT: Do not include the user's requested headline count (e.g., "9") in the headline text itself. The headlines should be natural and not forced by the number of headlines requested.

Apply the principles and styles from the winning examples.
You can mix and match frameworks, but lean towards the "${category}" style if appropriate.
Focus on:
- Psychological triggers (Curiosity, Gap, Negative Bias, etc.)
- Punchiness
- Clarity`;

  const response = await createMessage(prompt, {
    temperature: 0.7,
    maxTokens: 4096,
    system,
  });
  try {
    return extractJSON(response);
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
