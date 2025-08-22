import React, { useState, useEffect } from 'react';
import axios from 'axios';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

interface CalendarProps {
  token: string;
}

interface GoogleEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

const Calendar: React.FC<CalendarProps> = ({ token }) => {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    if (token) fetchEvents();
  }, [token]);

  const fetchEvents = async () => {
    try {
      const response = await axios.get<GoogleEvent[]>(
        'http://localhost:3001/api/calendar/events',
        { headers: { token } }
      );
  const formattedEvents = response.data.map(event => ({
        id: event.id,
        title: event.summary,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        allDay: !event.start.dateTime,
        extendedProps: {
          description: event.description || '',
          location: event.location || ''
        }
      }));
      setEvents(formattedEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  };

  return (
    <div className="calendar-container">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        }}
        events={events}
        height="100%"
      />
    </div>
  );
};

export default Calendar;
