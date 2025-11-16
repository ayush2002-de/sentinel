// /api/src/index.ts
import { app } from './app.js';

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`🚀 API Server listening on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server shut down');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);