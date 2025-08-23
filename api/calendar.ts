import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

export const getCalendarEvents = async (req: Request, res: Response, oAuth2Client: OAuth2Client) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) {
      return res.status(401).json({ error: 'Missing token header' });
    }
    oAuth2Client.setCredentials({ access_token: token });

    const now = new Date();
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString(),
      timeMax: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString(),
      maxResults: 200,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items?.map(event => ({
      id: event.id,
      recurringEventId: event.recurringEventId,
      summary: event.summary,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
      organizer: event.organizer,
      location: event.location,
      description: event.description,
    })) || [];

    res.json(events);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// GET /api/calendar/events?start={date}&end={date}
// POST /api/calendar/events
// PUT /api/calendar/events/:id
// DELETE /api/calendar/events/:id
// GET /api/calendar/summary?period={day|week|month}&date={date}
// GET /api/calendar/recommendations?duration={minutes}&preferred={timeRanges}