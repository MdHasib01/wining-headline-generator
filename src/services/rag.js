const { ChatOpenAI } = require('@langchain/openai');
const { PromptTemplate } = require('@langchain/core/prompts');
const supabase = require('../lib/supabase');
const { generateEmbedding } = require('./embeddings');

const llm = new ChatOpenAI({
  modelName: 'gpt-4o-mini',
  temperature: 0.7,
  apiKey: process.env.OPENAI_API_KEY,
});

const RAG_PROMPT_TEMPLATE = `You are an expert marketing analyst specializing in content hooks and viral headlines.
Based on the following winning headlines and frameworks from the Creator Hooks database, generate a headline suggestion for the user's topic.

Context (winning headlines from database):
{context}

User Topic/Prompt: {query}

Instructions:
1. Analyze the provided winning headlines and their characteristics
2. Identify patterns in what makes headlines effective
3. Generate 3 unique headline variations optimized for the given topic
4. For each headline, briefly explain the framework or principle used from the examples

Provide clear, actionable headline suggestions that could perform well.`;

const ragPrompt = PromptTemplate.fromTemplate(RAG_PROMPT_TEMPLATE);

async function searchSimilarHeadlines(query, limit = 5) {
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc('match_headlines', {
    query_embedding: embedding,
    match_count: limit,
    match_threshold: 0.7,
  });

  if (error) {
    const fallbackData = await supabase
      .from('headlines')
      .select('title, framework, why, hook_score')
      .limit(limit)
      .order('created_at', { ascending: false });

    if (fallbackData.error) {
      console.error('Error fetching headlines:', fallbackData.error.message);
      return [];
    }

    return fallbackData.data || [];
  }

  return data || [];
}

function formatHeadlinesForContext(headlines) {
  return headlines
    .map(
      (h, idx) =>
        `${idx + 1}. "${h.title}"
   - Framework: ${h.framework || 'N/A'}
   - Hook Score: ${h.hook_score || 'N/A'}
   - Why it works: ${h.why || 'N/A'}`,
    )
    .join('\n\n');
}

async function generateHeadlineWithRAG(userQuery) {
  const similarHeadlines = await searchSimilarHeadlines(userQuery, 5);

  if (similarHeadlines.length === 0) {
    throw new Error('No relevant headlines found in the database. Please ensure headlines are synced.');
  }

  const contextText = formatHeadlinesForContext(similarHeadlines);

  const formattedPrompt = await ragPrompt.format({
    context: contextText,
    query: userQuery,
  });

  const response = await llm.invoke(formattedPrompt);

  return {
    headline: response.content,
    sources: similarHeadlines.map((h) => ({
      title: h.title,
      framework: h.framework,
    })),
  };
}

module.exports = {
  generateHeadlineWithRAG,
  searchSimilarHeadlines,
};
