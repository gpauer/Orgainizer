interface AIInteraction {
  _id: ObjectId;
  userId: ObjectId;
  sessionId: string;
  query: string;
  response: string;
  actions: {
    type: string; // 'create', 'modify', 'delete', 'recommend', etc.
    status: string; // 'pending', 'completed', 'failed'
    calendarActionData: any; // JSON payload for calendar action
  }[];
  timestamp: Date;
}