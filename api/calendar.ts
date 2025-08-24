import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

export const getCalendarEvents = async (req: Request, res: Response, oAuth2Client: OAuth2Client) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });

    // Query params: start, end (ISO date or dateTime) OR months (int window each side)
    // Fallback: previous month -> next month (original behavior)
    const { start, end, months, maxResults } = req.query as Record<string, string | undefined>;
    const now = new Date();

    function parseDate(value?: string): Date | undefined {
      if (!value) return undefined;
      const d = new Date(value);
      return isNaN(d.getTime()) ? undefined : d;
    }

    let timeMin: Date;
    let timeMax: Date;

    const startDate = parseDate(start);
    const endDate = parseDate(end);

    if (startDate && endDate) {
      if (endDate < startDate) return res.status(400).json({ error: 'end must be after start' });
      // Cap range to 18 months for safety
      const monthsDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
      if (monthsDiff > 18) return res.status(400).json({ error: 'Range too large (max 18 months)' });
      timeMin = startDate;
      timeMax = endDate;
    } else if (months) {
      const m = Math.min(Math.max(parseInt(months, 10) || 1, 1), 12); // clamp 1..12
      timeMin = new Date(now.getFullYear(), now.getMonth() - m, 1);
      timeMax = new Date(now.getFullYear(), now.getMonth() + m + 1, 0, 23, 59, 59, 999);
    } else {
      // default window +/- 1 month relative to now (inclusive)
      timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999); // end of +1 month
    }

    // Enforce absolute safety cap of 2 years
    if (timeMax.getTime() - timeMin.getTime() > 1000 * 60 * 60 * 24 * 31 * 24) {
      return res.status(400).json({ error: 'Date span exceeds 24 months hard cap' });
    }

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const max = Math.min(Math.max(parseInt(maxResults || '0', 10) || 500, 1), 2500);
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: max,
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

    res.json({
      window: { start: timeMin.toISOString(), end: timeMax.toISOString() },
      count: events.length,
      events
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const createCalendarEvents = async (req: Request, res: Response, oAuth2Client: OAuth2Client) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });
    const body = req.body as any;
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    async function createOne(ev: any) {
      const { summary, description, location, start, end, attendees, recurrence } = ev || {};
      if (!summary || !start || !end) {
        throw new Error('summary, start, and end are required for each event');
      }
      const requestBody: any = {
        summary,
        description,
        location,
        start: { dateTime: start?.dateTime, date: start?.date, timeZone: start?.timeZone ?? 'Africa/Johannesburg' },
        end: { dateTime: end?.dateTime, date: end?.date, timeZone: end?.timeZone ?? 'Africa/Johannesburg' },
        attendees,
      };
      if (Array.isArray(recurrence) && recurrence.length) {
        // Limit recurrence rules (e.g., RRULE:FREQ=DAILY;COUNT=5)
        requestBody.recurrence = recurrence.slice(0, 4);
      }
      const created = await calendar.events.insert({ calendarId: 'primary', requestBody });
      return created.data;
    }

    if (Array.isArray(body)) {
      const results: any[] = [];
      for (const ev of body) {
        try { results.push({ success: true, event: await createOne(ev) }); }
        catch (e: any) { results.push({ success: false, error: e.message }); }
      }
      return res.status(207).json({ results });
    } else {
      const created = await createOne(body);
      return res.status(201).json(created);
    }
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteCalendarEvent = async (req: Request, res: Response, oAuth2Client: OAuth2Client) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing event id' });

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    await calendar.events.delete({ calendarId: 'primary', eventId: id });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// Batch delete: POST /api/calendar/events/batch-delete { ids: string[] }
export const deleteCalendarEventsBatch = async (req: Request, res: Response, oAuth2Client: OAuth2Client) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const results: any[] = [];
    for (const id of ids) {
      if (!id) { results.push({ id, success: false, error: 'empty id' }); continue; }
      try {
        await calendar.events.delete({ calendarId: 'primary', eventId: id });
        results.push({ id, success: true });
      } catch (e: any) {
        results.push({ id, success: false, error: e.message });
      }
    }
    const allOk = results.every(r => r.success);
    res.status(allOk ? 200 : 207).json({ results });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateCalendarEvent = async (req: Request, res: Response, oAuth2Client: OAuth2Client) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });
    const { id } = req.params;
    const { summary, description, location, start, end, attendees, recurrence, sendUpdates } = req.body as any;
    if (!id) return res.status(400).json({ error: 'Missing event id' });
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const requestBody: any = {
      summary,
      description,
      location,
      start: start ? { dateTime: start.dateTime, date: start.date, timeZone: start.timeZone ?? 'Africa/Johannesburg' } : undefined,
      end: end ? { dateTime: end.dateTime, date: end.date, timeZone: end.timeZone ?? 'Africa/Johannesburg' } : undefined,
      attendees,
    };
    if (Array.isArray(recurrence)) requestBody.recurrence = recurrence.slice(0, 4);
    Object.keys(requestBody).forEach(k => requestBody[k] === undefined && delete requestBody[k]);
    const updated = await calendar.events.patch({
      calendarId: 'primary',
      eventId: id,
      requestBody,
      sendUpdates: sendUpdates === 'all' ? 'all' : undefined
    });
    res.json(updated.data);
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