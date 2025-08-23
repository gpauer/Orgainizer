import serverless from 'serverless-http';
import { createApp } from '../../api/app';

// Wrap the express app for Netlify Functions
const app = createApp();

export const handler = serverless(app);
