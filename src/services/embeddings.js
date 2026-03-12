const axios = require("axios");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-5-sonnet-latest";
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

  const response = await axios.post(
    ANTHROPIC_API_URL,
    {
      model: MODEL,
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
  const textContent = content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && block.type === "text") return block.text || "";
      return "";
    })
    .join("")
    .trim();

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
