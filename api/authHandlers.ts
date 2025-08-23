import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

export function googleAuthUrlHandler(oAuth2Client: OAuth2Client) {
  return (_req: Request, res: Response) => {
    try {
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}

export function googleAuthCallbackHandler(oAuth2Client: OAuth2Client) {
  return async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const { tokens } = await oAuth2Client.getToken(code);
      res.json({ tokens });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
