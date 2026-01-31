/*
  # Create Headlines Table with Vector Embeddings

  1. New Tables
    - `headlines`
      - `id` (uuid, primary key)
      - `title` (text) - The headline title
      - `framework` (text) - The marketing framework used
      - `hook_score` (integer) - Numerical score of the hook effectiveness
      - `why` (text) - Analysis of why the hook works
      - `embedding` (vector) - OpenAI embeddings for RAG
      - `source_url` (text) - Source URL from CreatorHooks
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Extensions
    - Enable pgvector extension for vector operations

  3. Indexes
    - Vector index on embedding column for efficient similarity search
    - Index on created_at for temporal queries

  4. Security
    - Enable RLS on headlines table
    - Add policies for public read access to headlines data
*/

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS headlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  framework text,
  hook_score integer,
  why text,
  embedding vector(1536),
  source_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_headlines_embedding ON headlines USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_headlines_created_at ON headlines (created_at DESC);

ALTER TABLE headlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Headlines are publicly readable"
  ON headlines
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Headlines can be inserted by authenticated users"
  ON headlines
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Headlines can be updated by authenticated users"
  ON headlines
  FOR UPDATE
  TO authenticated
  WITH CHECK (true);