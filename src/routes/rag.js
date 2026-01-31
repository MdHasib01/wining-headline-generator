const express = require('express');
const { generateHeadlineWithRAG } = require('../services/rag');

const router = express.Router();

router.post('/generate', async (req, res) => {
  const { topic } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Topic must be a non-empty string',
    });
  }

  const cleanedTopic = topic.trim();

  if (cleanedTopic.length > 500) {
    return res.status(400).json({
      error: 'Input too long',
      message: 'Topic must be less than 500 characters',
    });
  }

  try {
    const result = await generateHeadlineWithRAG(cleanedTopic);

    return res.status(200).json({
      success: true,
      topic: cleanedTopic,
      suggestion: result.headline,
      sources: result.sources,
    });
  } catch (error) {
    console.error('Error generating headline:', error.message);

    if (error.message.includes('No relevant headlines')) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'No headlines found in database. Please run the sync script first.',
      });
    }

    return res.status(500).json({
      error: 'Generation failed',
      message: 'Failed to generate headline. Please try again.',
    });
  }
});

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'rag-api',
  });
});

module.exports = router;
