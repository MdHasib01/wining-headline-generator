const { ChatOpenAI } = require("@langchain/openai");
const {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const supabase = require("../lib/supabase");
const { generateEmbedding } = require("./embeddings");

const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.7,
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert marketing analyst specializing in content hooks and viral headlines.
Based on winning headlines and frameworks from the Creator Hooks database, generate a headline suggestion for the user's topic.

Instructions:
1. Search for similar headlines in the database using the provided tool.
2. Analyze the provided winning headlines and their characteristics.
3. Identify patterns in what makes headlines effective.
4. Generate 3 unique headline variations optimized for the given topic.
5. For each headline, briefly explain the framework or principle used from the examples.

IMPORTANT: If no relevant headlines are found in the database, DO NOT fail. Instead, use your own expert knowledge of viral marketing, curiosity gaps, and psychological triggers to generate the best possible headlines for the user's topic. Just mention that these are based on general viral principles.

Provide clear, actionable headline suggestions that could perform well.`;

const tools = [
  {
    type: "function",
    function: {
      name: "search_headlines",
      description:
        "Search for winning headlines from the database to use as context/inspiration.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The topic or theme to search headlines for.",
          },
        },
        required: ["query"],
      },
    },
  },
];

const llmWithTools = llm.bind({
  tools: tools,
});

async function searchSimilarHeadlines(query, limit = 5) {
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc("match_headlines", {
    query_embedding: embedding,
    match_count: limit,
    match_threshold: 0.5, // Increased threshold to ensure relevance
  });

  if (error || !data || data.length === 0) {
    console.log("No relevant headlines found via vector search.");
    return [];
  }

  return data || [];
}

function formatHeadlinesForContext(headlines) {
  return headlines
    .map(
      (h, idx) =>
        `${idx + 1}. "${h.title}"
   - Framework: ${h.framework || "N/A"}
   - Hook Score: ${h.hook_score || "N/A"}
   - Why it works: ${h.why || "N/A"}`,
    )
    .join("\n\n");
}

async function generateHeadlineWithRAG(userQuery) {
  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userQuery),
  ];

  const response = await llmWithTools.invoke(messages);

  // Check if the model decided to call the tool
  if (response.tool_calls && response.tool_calls.length > 0) {
    const toolCall = response.tool_calls[0];

    if (toolCall.name === "search_headlines") {
      const args = toolCall.args;
      const similarHeadlines = await searchSimilarHeadlines(args.query, 5);

      const contextText = formatHeadlinesForContext(similarHeadlines);

      let toolOutputContent = contextText;
      if (!contextText) {
        toolOutputContent =
          "No relevant headlines found in the database. Please generate high-quality viral headlines based on your internal expert knowledge of marketing frameworks instead.";
      }

      // Add the assistant's tool call message
      messages.push(response);

      // Add the tool output message
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id,
          content: toolOutputContent,
          name: "search_headlines",
        }),
      );

      // Generate the final response using the tool output
      const finalResponse = await llm.invoke(messages);

      return {
        headline: finalResponse.content,
        sources: similarHeadlines.map((h) => ({
          title: h.title,
          framework: h.framework,
        })),
      };
    }
  }

  // If no tool was called (unlikely with the system prompt), return the response
  // Or we could force a search if desired.
  return {
    headline: response.content,
    sources: [],
  };
}

module.exports = {
  generateHeadlineWithRAG,
  searchSimilarHeadlines,
};
