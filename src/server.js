require('dotenv').config();
const express = require('express');
const ragRoutes = require('./routes/rag');

const PORT = process.env.PORT || 3000;

const app = express();

app.use(express.json());

app.use('/api/rag', ragRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'creator-hooks-rag-api',
    timestamp: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  });
});

app.listen(PORT, () => {
  console.log(`RAG API server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`RAG endpoint: POST http://localhost:${PORT}/api/rag/generate`);
});
