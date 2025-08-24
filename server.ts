import dotenv from 'dotenv';
import { createApp } from './api/app';

dotenv.config();

const { PORT } = process.env as Record<string,string|undefined>;
const app = createApp();
const port = PORT || '3001';
app.listen(port, () => console.log(`Server running on port ${port}`));
