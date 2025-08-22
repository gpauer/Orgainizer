interface CalendarEvent {
  id: string;
  googleEventId: string;
  title: string;
  description: string;
  location: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  recurrence: string[];
  attendees: {
    email: string;
    displayName: string;
    responseStatus: string;
  }[];
  reminders: {
    useDefault: boolean;
    overrides: {
      method: string;
      minutes: number;
    }[];
  };
  status: string;
  created: string;
  updated: string;
}