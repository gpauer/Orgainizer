require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Google OAuth client
const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Auth routes
app.get('/api/auth/google', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  });
  res.json({ url: authUrl });
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { tokens } = await oAuth2Client.getToken(req.query.code);
    res.json({ tokens });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Calendar routes
app.get('/api/calendar/events', async (req, res) => {
  try {
    const { token } = req.headers;
    oAuth2Client.setCredentials({ access_token: token });
    
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    res.json(response.data.items);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// AI assistant route
app.post('/api/assistant/query', async (req, res) => {
  try {
    const { query, events } = req.body;
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
      You are a calendar assistant. The user has the following events:
      ${JSON.stringify(events)}
      
      User query: ${query}
      
      Provide a helpful response about their schedule. Only advise on scheduling 
      and research applicable information. Do not create any events directly.
      If they want to add an event, provide the structured event information in 
      JSON format that can be used to create a calendar event.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    res.json({ response: text });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});