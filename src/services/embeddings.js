const axios = require("axios");

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
const EMBEDDING_DIMENSIONS = 1536;

async function generateEmbedding(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Text input is required and must be a string");
  }

  const sanitizedText = text.slice(0, 8000);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const modelsToTry = buildModelCandidates();
  let textContent = "";

  for (let i = 0; i < modelsToTry.length; i += 1) {
    const model = modelsToTry[i];
    try {
      const response = await axios.post(
        ANTHROPIC_API_URL,
        {
          model,
          max_tokens: 4096,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: `Create a JSON array of ${EMBEDDING_DIMENSIONS} floating point numbers between -1 and 1 that represents a semantic embedding for the following text. Return only the JSON array, no markdown, no extra text.\n\nText: "${sanitizedText.replace(/"/g, '\\"')}"`,
            },
          ],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );

      const content = response?.data?.content || [];
      textContent = content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block && block.type === "text") return block.text || "";
          return "";
        })
        .join("")
        .trim();
      break;
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

  if (!textContent) {
    throw new Error("Anthropic request failed for all configured models");
  }

  let embedding;
  try {
    embedding = JSON.parse(textContent);
  } catch (error) {
    throw new Error("Invalid embedding JSON returned from Anthropic");
  }

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Embedding has unexpected dimensions");
  }

  return embedding;
}

async function generateBatchEmbeddings(texts) {
  const embeddings = [];

  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }

  return embeddings;
}

module.exports = {
  generateEmbedding,
  generateBatchEmbeddings,
};
