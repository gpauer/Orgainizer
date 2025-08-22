export interface CalendarAction {
  action: 'create' | 'update' | 'delete' | 'recommend' | 'summarize';
  eventData?: {
    summary: string;
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
    recurrence?: string[];
    attendees?: {
      email: string;
      displayName?: string;
    }[];
    reminders?: {
      useDefault: boolean;
      overrides?: {
        method: string;
        minutes: number;
      }[];
    };
  };
  eventId?: string; // for update/delete operations
  queryParameters?: {
    timeMin?: string;
    timeMax?: string;
    duration?: number;
    preferredTimeRanges?: {
      start: string;
      end: string;
    }[];
  };
}