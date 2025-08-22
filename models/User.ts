export interface User {
  _id: any; // Replace with ObjectId from driver
  googleId: string;
  email: string;
  displayName: string;
  profilePicture: string;
  accessToken: string; // Encrypted
  refreshToken: string; // Encrypted
  tokenExpiry: Date;
  preferences: {
    defaultView: string; // day, week, month
    notifications: boolean;
    reminderTiming: number[]; // minutes before events
    aiFeatures: {
      scheduleSummaries: boolean;
      slotRecommendations: boolean;
      eventPlanning: boolean;
    }
  };
  createdAt: Date;
  updatedAt: Date;
}