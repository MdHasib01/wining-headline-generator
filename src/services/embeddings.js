const OpenAI = require('openai').default;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'text-embedding-3-small';

async function generateEmbedding(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text input is required and must be a string');
  }

  const sanitizedText = text.slice(0, 8000);

  const response = await openai.embeddings.create({
    model: MODEL,
    input: sanitizedText,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error('No embedding data returned from OpenAI');
  }

  return response.data[0].embedding;
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
