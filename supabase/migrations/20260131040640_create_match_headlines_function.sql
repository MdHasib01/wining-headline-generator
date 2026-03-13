/*
  # Create Vector Similarity Search Function

  1. New Functions
    - `match_headlines` - RPC function for searching similar headlines using vector similarity

  Description: This function performs cosine similarity search on headline embeddings to find the most relevant headlines for a given query embedding.
*/

CREATE OR REPLACE FUNCTION match_headlines (
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  match_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  title text,
  framework text,
  hook_score integer,
  why text,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    headlines.id,
    headlines.title,
    headlines.framework,
    headlines.hook_score,
    headlines.why,
    1 - (headlines.embedding <=> query_embedding) AS similarity
  FROM headlines
  WHERE headlines.embedding <=> query_embedding < 1 - match_threshold
  ORDER BY headlines.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
