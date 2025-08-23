import React, { useState, useEffect } from 'react';
import api from '../api/http';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useToasts } from './Notifications';

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
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
}

const Calendar: React.FC<CalendarProps> = ({ token }) => {
  const { push } = useToasts();
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({
    summary: '',
    date: '', // YYYY-MM-DD
    startTime: '', // HH:MM
    endTime: '', // HH:MM
    location: '',
    description: '',
    attendees: '' // comma separated emails
  });
  const [editing, setEditing] = useState(false);
  const [editEvent, setEditEvent] = useState<any | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (token) fetchEvents();
  }, [token]);

  // Listen for external refresh requests (e.g., ChatAssistant actions)
  useEffect(() => {
    const refresh = () => { if (token) fetchEvents(); };
    window.addEventListener('calendar:refresh', refresh);
    return () => window.removeEventListener('calendar:refresh', refresh);
  }, [token]);

  const fetchEvents = async () => {
    try {
  const response = await api.get<GoogleEvent[]>('/calendar/events');
      const formattedEvents = response.data.map(event => ({
        id: event.id,
        title: event.summary,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        allDay: !event.start.dateTime,
        extendedProps: {
          description: event.description || '',
          location: event.location || '',
          organizer: event.organizer || null,
          attendees: event.attendees || [],
          raw: event
        }
      }));
      setEvents(formattedEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
      push({ type: 'error', message: 'Failed to load events' });
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;
    if (!window.confirm('Delete this event?')) return;
    try {
      const deleting = selectedEvent;
  await api.delete(`/calendar/events/${deleting.id}`);
      setEvents(prev => prev.filter(e => e.id !== deleting.id));
      setSelectedEvent(null);
      let undone = false;
      push({
        type: 'success',
        message: 'Event deleted',
        actionLabel: 'Undo',
        duration: 6000,
        onAction: async () => {
          if (undone) return;
          undone = true;
          try {
            const response = await api.post('/calendar/events', {
              summary: deleting.title,
              description: deleting.description,
              location: deleting.location,
              start: deleting.allDay && deleting.start ? { date: new Date(deleting.start).toISOString().slice(0,10) } : { dateTime: new Date(deleting.start).toISOString() },
              end: deleting.allDay && deleting.end ? { date: new Date(deleting.end).toISOString().slice(0,10) } : { dateTime: new Date(deleting.end).toISOString() },
              attendees: (deleting.attendees || []).map((a: any) => ({ email: a.email }))
            });
            const ev = response.data;
            setEvents(prev => ([...prev, {
              id: ev.id,
              title: ev.summary,
              start: ev.start?.dateTime || ev.start?.date,
              end: ev.end?.dateTime || ev.end?.date,
              allDay: !ev.start?.dateTime,
              extendedProps: {
                description: ev.description || '',
                location: ev.location || '',
                organizer: ev.organizer || null,
                attendees: ev.attendees || [],
                raw: ev
              }
            }]));
            push({ type: 'info', message: 'Event restored' });
          } catch (err) {
            console.error('Undo failed', err);
            push({ type: 'error', message: 'Failed to restore event' });
          }
        }
      });
    } catch (err) {
      console.error('Delete failed', err);
      push({ type: 'error', message: 'Failed to delete event' });
    }
  };

  const handleCopy = async () => {
    if (!selectedEvent) return;
    const text = JSON.stringify({
      summary: selectedEvent.title,
      description: selectedEvent.description,
      location: selectedEvent.location,
      start: selectedEvent.start,
      end: selectedEvent.end,
      attendees: selectedEvent.attendees
    }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const openEdit = () => {
    if (!selectedEvent) return;
    const start = selectedEvent.start instanceof Date ? selectedEvent.start : new Date(selectedEvent.start);
    const end = selectedEvent.end instanceof Date ? selectedEvent.end : new Date(selectedEvent.end);
    setEditEvent({
      id: selectedEvent.id,
      summary: selectedEvent.title,
      date: start.toISOString().slice(0,10),
      startTime: start.toISOString().slice(11,16),
      endTime: end.toISOString().slice(11,16),
      location: selectedEvent.location || '',
      description: selectedEvent.description || '',
      attendees: (selectedEvent.attendees || []).map((a: any) => a.email).join(', ')
    });
    setEditing(true);
  };

  const validateTimes = (startDate: string, startTime: string, endTime: string) => {
    if (!startDate || !startTime || !endTime) return true;
    const s = new Date(`${startDate}T${startTime}:00`);
    const e = new Date(`${startDate}T${endTime}:00`);
    return e > s;
  };

  return (
    <div className="calendar-container">
      <div className="calendar-actions">
        <button className="mini-btn" onClick={() => setShowCreate(true)}>＋ Add Event</button>
      </div>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        }}
        editable={true}
        eventDurationEditable={true}
        dragScroll={true}
        events={events}
        height="100%"
        eventClassNames={(arg) => {
          const classes: string[] = [];
          if (updatingId && arg.event.id === updatingId) classes.push('updating');
          return classes;
        }}
        eventClick={(clickInfo) => {
          const e = clickInfo.event;
          const ext: any = e.extendedProps || {};
          setSelectedEvent({
            id: e.id,
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: e.allDay,
            description: ext.description,
            location: ext.location,
            organizer: ext.organizer,
            attendees: ext.attendees,
            raw: ext.raw
          });
        }}
        eventDrop={async (info) => {
          const e = info.event;
          if (!e.start || !e.end) return;
          setUpdatingId(e.id);
          try {
            await api.put(`/calendar/events/${e.id}` , {
              summary: e.title,
              start: e.allDay ? { date: e.start.toISOString().slice(0,10) } : { dateTime: e.start.toISOString() },
              end: e.allDay ? { date: e.end.toISOString().slice(0,10) } : { dateTime: e.end.toISOString() }
            });
          } catch (err) {
            console.error('Move failed', err);
            info.revert();
            alert('Could not move event');
          } finally {
            setUpdatingId(null);
          }
        }}
        eventResize={async (info) => {
          const e = info.event;
            if (!e.start || !e.end) return;
            setUpdatingId(e.id);
            try {
              await api.put(`/calendar/events/${e.id}` , {
                summary: e.title,
                start: e.allDay ? { date: e.start.toISOString().slice(0,10) } : { dateTime: e.start.toISOString() },
                end: e.allDay ? { date: e.end.toISOString().slice(0,10) } : { dateTime: e.end.toISOString() }
              });
            } catch (err) {
              console.error('Resize failed', err);
              info.revert();
              alert('Could not resize event');
            } finally {
              setUpdatingId(null);
            }
        }}
      />
      {selectedEvent && (
        <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedEvent.title || 'Event Details'}</h2>
              <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                <button className="mini-btn" onClick={openEdit} title="Edit" aria-label="Edit">✎</button>
                <button className="mini-btn" onClick={handleCopy} title="Copy JSON" aria-label="Copy JSON">⧉</button>
                <button className="mini-btn danger" onClick={handleDelete} title="Delete" aria-label="Delete">🗑</button>
                <button className="close-btn" onClick={() => setSelectedEvent(null)} aria-label="Close">×</button>
              </div>
            </div>
            <div className="modal-body">
              <dl className="event-meta">
                <dt>When</dt>
                <dd>{formatDateRange(selectedEvent.start, selectedEvent.end, selectedEvent.allDay)}</dd>
                {selectedEvent.location && (
                  <>
                    <dt>Location</dt>
                    <dd>{selectedEvent.location}</dd>
                  </>
                )}
                {selectedEvent.organizer && (
                  <>
                    <dt>Organizer</dt>
                    <dd>{selectedEvent.organizer.displayName || selectedEvent.organizer.email}</dd>
                  </>
                )}
                {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                  <>
                    <dt>Attendees</dt>
                    <dd>
                      <ul className="attendee-list">
                        {selectedEvent.attendees.map((a: any, i: number) => (
                          <li key={i} className={`attendee status-${(a.responseStatus || 'needsAction').toLowerCase()}`}> {a.displayName || a.email} <span className="status">{a.responseStatus}</span></li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
                {selectedEvent.description && (
                  <>
                    <dt>Description</dt>
                    <dd className="description-text">{selectedEvent.description}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>
      )}
      {showCreate && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Event</h2>
              <button className="close-btn" onClick={() => !creating && setShowCreate(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <form className="event-form" onSubmit={async e => {
                e.preventDefault();
                if (!newEvent.summary || !newEvent.date || !newEvent.startTime || !newEvent.endTime) return;
  if (!validateTimes(newEvent.date, newEvent.startTime, newEvent.endTime)) { push({ type: 'warn', message: 'End time must be after start time' }); return; }
                setCreating(true);
                try {
                  const startISO = new Date(`${newEvent.date}T${newEvent.startTime}:00`).toISOString();
                  const endISO = new Date(`${newEvent.date}T${newEvent.endTime}:00`).toISOString();
                  const response = await api.post('/calendar/events', {
                    summary: newEvent.summary,
                    description: newEvent.description,
                    location: newEvent.location,
          attendees: newEvent.attendees.split(',').map(a => a.trim()).filter(Boolean).map(email => ({ email })),
                    start: { dateTime: startISO },
                    end: { dateTime: endISO }
                  });
                  const ev = response.data;
                  setEvents(prev => ([...prev, {
                    id: ev.id,
                    title: ev.summary,
                    start: ev.start?.dateTime || ev.start?.date,
                    end: ev.end?.dateTime || ev.end?.date,
                    allDay: !ev.start?.dateTime,
                    extendedProps: {
                      description: ev.description || '',
                      location: ev.location || '',
                      organizer: ev.organizer || null,
                      attendees: ev.attendees || [],
                      raw: ev
                    }
                  }]));
                  setShowCreate(false);
                  setNewEvent({ summary: '', date: '', startTime: '', endTime: '', location: '', description: '', attendees: '' });
                } catch (err) {
                  console.error('Create failed', err);
                  push({ type: 'error', message: 'Failed to create event' });
                } finally {
                  setCreating(false);
                }
              }}>
                <div className="form-grid">
                  <label>
                    <span>Title *</span>
                    <input required disabled={creating} value={newEvent.summary} onChange={e => setNewEvent(v => ({ ...v, summary: e.target.value }))} />
                  </label>
                  <label>
                    <span>Date *</span>
                    <input type="date" required disabled={creating} value={newEvent.date} onChange={e => setNewEvent(v => ({ ...v, date: e.target.value }))} />
                  </label>
                  <label>
                    <span>Start *</span>
                    <input type="time" required disabled={creating} value={newEvent.startTime} onChange={e => setNewEvent(v => ({ ...v, startTime: e.target.value }))} />
                  </label>
                  <label>
                    <span>End *</span>
                    <input type="time" required disabled={creating} value={newEvent.endTime} onChange={e => setNewEvent(v => ({ ...v, endTime: e.target.value }))} />
                  </label>
                  <label className="full">
                    <span>Location</span>
                    <input disabled={creating} value={newEvent.location} onChange={e => setNewEvent(v => ({ ...v, location: e.target.value }))} />
                  </label>
                  <label className="full">
                    <span>Description</span>
                    <textarea rows={4} disabled={creating} value={newEvent.description} onChange={e => setNewEvent(v => ({ ...v, description: e.target.value }))} />
                  </label>
                  <label className="full">
                    <span>Attendees (emails, comma separated)</span>
                    <input disabled={creating} value={newEvent.attendees} onChange={e => setNewEvent(v => ({ ...v, attendees: e.target.value }))} placeholder="person1@example.com, person2@example.com" />
                  </label>
                </div>
                <div className="form-actions">
                  <button type="button" className="mini-btn" disabled={creating} onClick={() => setShowCreate(false)}>Cancel</button>
                  <button type="submit" className="mini-btn primary" disabled={creating}> {creating ? 'Creating…' : 'Create'} </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {editing && editEvent && (
        <div className="modal-overlay" onClick={() => !creating && setEditing(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Event</h2>
              <button className="close-btn" onClick={() => setEditing(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <form className="event-form" onSubmit={async e => {
                e.preventDefault();
                if (!editEvent.summary || !editEvent.date || !editEvent.startTime || !editEvent.endTime) return;
                if (!validateTimes(editEvent.date, editEvent.startTime, editEvent.endTime)) { push({ type: 'warn', message: 'End time must be after start time' }); return; }
                setCreating(true);
                try {
                  const startISO = new Date(`${editEvent.date}T${editEvent.startTime}:00`).toISOString();
                  const endISO = new Date(`${editEvent.date}T${editEvent.endTime}:00`).toISOString();
                  const response = await api.put(`/calendar/events/${editEvent.id}`, {
                    summary: editEvent.summary,
                    description: editEvent.description,
                    location: editEvent.location,
                    attendees: editEvent.attendees.split(',').map((a: string) => a.trim()).filter(Boolean).map((email: string) => ({ email })),
                    start: { dateTime: startISO },
                    end: { dateTime: endISO }
                  });
                  const ev = response.data;
                  setEvents(prev => prev.map(ei => ei.id === ev.id ? {
                    id: ev.id,
                    title: ev.summary,
                    start: ev.start?.dateTime || ev.start?.date,
                    end: ev.end?.dateTime || ev.end?.date,
                    allDay: !ev.start?.dateTime,
                    extendedProps: {
                      description: ev.description || '',
                      location: ev.location || '',
                      organizer: ev.organizer || null,
                      attendees: ev.attendees || [],
                      raw: ev
                    }
                  } : ei));
                  setEditing(false);
                  setSelectedEvent(null);
                } catch (err) {
                  console.error('Update failed', err);
                  push({ type: 'error', message: 'Failed to update event' });
                } finally {
                  setCreating(false);
                }
              }}>
                <div className="form-grid">
                  <label>
                    <span>Title *</span>
                    <input required disabled={creating} value={editEvent.summary} onChange={e => setEditEvent((v: any) => ({ ...v, summary: e.target.value }))} />
                  </label>
                  <label>
                    <span>Date *</span>
                    <input type="date" required disabled={creating} value={editEvent.date} onChange={e => setEditEvent((v: any) => ({ ...v, date: e.target.value }))} />
                  </label>
                  <label>
                    <span>Start *</span>
                    <input type="time" required disabled={creating} value={editEvent.startTime} onChange={e => setEditEvent((v: any) => ({ ...v, startTime: e.target.value }))} />
                  </label>
                  <label>
                    <span>End *</span>
                    <input type="time" required disabled={creating} value={editEvent.endTime} onChange={e => setEditEvent((v: any) => ({ ...v, endTime: e.target.value }))} />
                  </label>
                  <label className="full">
                    <span>Location</span>
                    <input disabled={creating} value={editEvent.location} onChange={e => setEditEvent((v: any) => ({ ...v, location: e.target.value }))} />
                  </label>
                  <label className="full">
                    <span>Description</span>
                    <textarea rows={4} disabled={creating} value={editEvent.description} onChange={e => setEditEvent((v: any) => ({ ...v, description: e.target.value }))} />
                  </label>
                  <label className="full">
                    <span>Attendees (emails, comma separated)</span>
                    <input disabled={creating} value={editEvent.attendees} onChange={e => setEditEvent((v: any) => ({ ...v, attendees: e.target.value }))} />
                  </label>
                </div>
                <div className="form-actions">
                  <button type="button" className="mini-btn" disabled={creating} onClick={() => setEditing(false)}>Cancel</button>
                  <button type="submit" className="mini-btn primary" disabled={creating}> {creating ? 'Saving…' : 'Save'} </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helpers
function formatDateRange(start: Date | null, end: Date | null, allDay: boolean) {
  if (!start) return 'Unknown';
  const optsDate: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  const optsTime: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const startStr = start.toLocaleDateString(undefined, optsDate) + (allDay ? '' : ' ' + start.toLocaleTimeString(undefined, optsTime));
  if (!end) return startStr;
  const sameDay = start.toDateString() === end.toDateString();
  const endStr = sameDay
    ? (allDay ? '' : end.toLocaleTimeString(undefined, optsTime))
    : end.toLocaleDateString(undefined, optsDate) + (allDay ? '' : ' ' + end.toLocaleTimeString(undefined, optsTime));
  return sameDay ? `${startStr} – ${endStr}` : `${startStr} → ${endStr}`;
}

export default Calendar;
